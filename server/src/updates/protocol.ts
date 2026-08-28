import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Request, Response } from 'express';
import FormData from 'form-data';
import mime from 'mime';
import { serializeDictionary, type Dictionary } from 'structured-headers';

export const OTA_UPDATES_DIR = path.resolve(process.env.OTA_UPDATES_DIR || 'data/updates');

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;
const updateCache = new Map<string, Promise<BuiltUpdate>>();

type UpdatePlatform = 'android' | 'ios';

type ExportedAsset = {
  path: string;
  ext: string;
};

type ExportedPlatformMetadata = {
  bundle: string;
  assets: ExportedAsset[];
};

type ExportedMetadata = {
  fileMetadata: Partial<Record<UpdatePlatform, ExportedPlatformMetadata>>;
};

type ExpoAsset = {
  hash: string;
  key: string;
  fileExtension: string;
  contentType: string;
  url: string;
};

type BuiltUpdate = {
  releaseDirectory: string;
  manifest: {
    id: string;
    createdAt: string;
    runtimeVersion: string;
    assets: ExpoAsset[];
    launchAsset: ExpoAsset;
    metadata: Record<string, never>;
    extra: { expoClient: unknown };
  };
};

class OtaRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const asSingleHeader = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? undefined : value;

const requireSafeSegment = (value: string | undefined, label: string): string => {
  if (!value || value === '.' || value === '..' || !SAFE_SEGMENT.test(value)) {
    throw new OtaRequestError(`Invalid ${label}.`, 400);
  }
  return value;
};

const requirePlatform = (value: string | undefined): UpdatePlatform => {
  if (value !== 'android' && value !== 'ios') {
    throw new OtaRequestError('Unsupported platform. Expected android or ios.', 400);
  }
  return value;
};

const safeFilePath = (root: string, relativePath: string): string => {
  const normalized = relativePath.replace(/\\/g, '/');
  if (
    !normalized ||
    path.posix.isAbsolute(normalized) ||
    normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new OtaRequestError('Invalid update asset path.', 400);
  }

  const resolvedRoot = path.resolve(root);
  const resolvedFile = path.resolve(resolvedRoot, ...normalized.split('/'));
  if (!resolvedFile.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new OtaRequestError('Invalid update asset path.', 400);
  }
  return resolvedFile;
};

const portableAssetPath = (relativePath: string): string => relativePath.replace(/\\/g, '/');

const base64Url = (value: Buffer): string =>
  crypto.createHash('sha256').update(value).digest('base64url');

const uuidFromHex = (value: string): string =>
  `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;

const publicBaseUrl = (req: Request): string => {
  const configured = (process.env.OTA_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || '').trim();
  if (configured) return configured.replace(/\/+$/, '');

  const forwardedProtocol = req.header('x-forwarded-proto')?.split(',')[0]?.trim();
  const protocol = forwardedProtocol || req.protocol;
  const host = req.header('host');
  if (!host) throw new OtaRequestError('Unable to determine update server host.', 500);
  return `${protocol}://${host}`;
};

const latestReleaseId = async (runtimeVersion: string): Promise<string> => {
  const runtimeDirectory = path.join(OTA_UPDATES_DIR, runtimeVersion);
  let entries;
  try {
    entries = await readdir(runtimeDirectory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new OtaRequestError(`No update exists for runtime ${runtimeVersion}.`, 404);
    }
    throw error;
  }

  const releases = entries
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => Number(right) - Number(left));

  if (!releases[0]) {
    throw new OtaRequestError(`No update exists for runtime ${runtimeVersion}.`, 404);
  }
  return releases[0];
};

const releaseDirectoryOf = (runtimeVersion: string, releaseId: string): string => {
  requireSafeSegment(runtimeVersion, 'runtime version');
  requireSafeSegment(releaseId, 'release id');
  if (!/^\d+$/.test(releaseId)) throw new OtaRequestError('Invalid release id.', 400);
  return path.join(OTA_UPDATES_DIR, runtimeVersion, releaseId);
};

const readExportMetadata = async (
  releaseDirectory: string,
  platform: UpdatePlatform
): Promise<{
  metadataBuffer: Buffer;
  metadata: ExportedMetadata;
  platformMetadata: ExportedPlatformMetadata;
}> => {
  let metadataBuffer: Buffer;
  try {
    metadataBuffer = await readFile(path.join(releaseDirectory, 'metadata.json'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new OtaRequestError('Update metadata is missing.', 404);
    }
    throw error;
  }

  const metadata = JSON.parse(metadataBuffer.toString('utf8')) as ExportedMetadata;
  const platformMetadata = metadata.fileMetadata?.[platform];
  if (!platformMetadata?.bundle || !Array.isArray(platformMetadata.assets)) {
    throw new OtaRequestError(`Update has no ${platform} bundle.`, 404);
  }
  return { metadataBuffer, metadata, platformMetadata };
};

const assetUrl = (
  baseUrl: string,
  runtimeVersion: string,
  releaseId: string,
  platform: UpdatePlatform,
  relativePath: string
): string => {
  const url = new URL(`${baseUrl}/api/v1/updates/assets`);
  url.searchParams.set('runtimeVersion', runtimeVersion);
  url.searchParams.set('releaseId', releaseId);
  url.searchParams.set('platform', platform);
  url.searchParams.set('asset', portableAssetPath(relativePath));
  return url.toString();
};

const buildAsset = async (args: {
  baseUrl: string;
  runtimeVersion: string;
  releaseId: string;
  platform: UpdatePlatform;
  releaseDirectory: string;
  relativePath: string;
  extension: string | null;
  launchAsset: boolean;
}): Promise<ExpoAsset> => {
  const filePath = safeFilePath(args.releaseDirectory, args.relativePath);
  let contents: Buffer;
  try {
    contents = await readFile(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new OtaRequestError(`Update asset ${args.relativePath} is missing.`, 404);
    }
    throw error;
  }

  const extension = (args.extension || 'bundle').replace(/^\./, '');
  return {
    hash: base64Url(contents),
    key: crypto.createHash('md5').update(contents).digest('hex'),
    fileExtension: `.${extension}`,
    contentType: args.launchAsset
      ? 'application/javascript'
      : mime.getType(extension) || 'application/octet-stream',
    url: assetUrl(
      args.baseUrl,
      args.runtimeVersion,
      args.releaseId,
      args.platform,
      args.relativePath
    ),
  };
};

const buildUpdate = async (
  req: Request,
  runtimeVersion: string,
  releaseId: string,
  platform: UpdatePlatform
): Promise<BuiltUpdate> => {
  const baseUrl = publicBaseUrl(req);
  const cacheKey = `${OTA_UPDATES_DIR}\0${baseUrl}\0${runtimeVersion}\0${releaseId}\0${platform}`;
  const cached = updateCache.get(cacheKey);
  if (cached) return cached;

  const buildPromise = (async () => {
    const releaseDirectory = releaseDirectoryOf(runtimeVersion, releaseId);
    const { metadataBuffer, platformMetadata } = await readExportMetadata(
      releaseDirectory,
      platform
    );
    const expoConfigBuffer = await readFile(path.join(releaseDirectory, 'expoConfig.json'));
    const expoClient = JSON.parse(expoConfigBuffer.toString('utf8')) as unknown;

    let createdAt = (await stat(path.join(releaseDirectory, 'metadata.json'))).birthtime.toISOString();
    try {
      const releaseInfo = JSON.parse(
        await readFile(path.join(releaseDirectory, 'release.json'), 'utf8')
      ) as { createdAt?: string };
      if (releaseInfo.createdAt && !Number.isNaN(Date.parse(releaseInfo.createdAt))) {
        createdAt = new Date(releaseInfo.createdAt).toISOString();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    const idHex = crypto
      .createHash('sha256')
      .update(metadataBuffer)
      .update(expoConfigBuffer)
      .update(releaseId)
      .digest('hex');

    const assets = await Promise.all(
      platformMetadata.assets.map((asset) =>
        buildAsset({
          baseUrl,
          runtimeVersion,
          releaseId,
          platform,
          releaseDirectory,
          relativePath: asset.path,
          extension: asset.ext,
          launchAsset: false,
        })
      )
    );
    const launchAsset = await buildAsset({
      baseUrl,
      runtimeVersion,
      releaseId,
      platform,
      releaseDirectory,
      relativePath: platformMetadata.bundle,
      extension: null,
      launchAsset: true,
    });

    return {
      releaseDirectory,
      manifest: {
        id: uuidFromHex(idHex),
        createdAt,
        runtimeVersion,
        assets,
        launchAsset,
        metadata: {},
        extra: { expoClient },
      },
    };
  })();

  updateCache.set(cacheKey, buildPromise);
  try {
    return await buildPromise;
  } catch (error) {
    updateCache.delete(cacheKey);
    throw error;
  }
};

const privateKey = async (): Promise<string | null> => {
  const keyPath = (process.env.OTA_PRIVATE_KEY_PATH || '').trim();
  if (!keyPath) return null;
  try {
    return await readFile(path.resolve(keyPath), 'utf8');
  } catch (error) {
    throw new OtaRequestError(
      `OTA signing key cannot be read: ${(error as Error).message}`,
      503
    );
  }
};

const signatureHeader = async (payload: string, requested: boolean): Promise<string | null> => {
  if (!requested) return null;
  const key = await privateKey();
  if (!key) {
    throw new OtaRequestError('Client requires a signed update, but OTA_PRIVATE_KEY_PATH is unset.', 503);
  }
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(payload, 'utf8');
  signer.end();
  const signature = signer.sign(key, 'base64');
  const dictionary: Dictionary = new Map([
    ['sig', [signature, new Map()]],
    ['keyid', ['main', new Map()]],
  ]);
  return serializeDictionary(dictionary);
};

const sendMultipart = async (args: {
  req: Request;
  res: Response;
  protocolVersion: number;
  partName: 'manifest' | 'directive';
  payload: unknown;
  includeExtensions?: boolean;
}): Promise<void> => {
  const payload = JSON.stringify(args.payload);
  const signature = await signatureHeader(payload, Boolean(args.req.header('expo-expect-signature')));
  const form = new FormData();
  form.append(args.partName, payload, {
    contentType: 'application/json',
    header: {
      'content-type': 'application/json; charset=utf-8',
      ...(signature ? { 'expo-signature': signature } : {}),
    },
  });
  if (args.includeExtensions) {
    form.append('extensions', JSON.stringify({ assetRequestHeaders: {} }), {
      contentType: 'application/json',
    });
  }

  args.res.status(200);
  args.res.setHeader('expo-protocol-version', String(args.protocolVersion));
  args.res.setHeader('expo-sfv-version', '0');
  args.res.setHeader('cache-control', 'private, no-store');
  args.res.setHeader('content-type', `multipart/mixed; boundary=${form.getBoundary()}`);
  args.res.end(form.getBuffer());
};

const protocolVersionOf = (req: Request): number => {
  const raw = asSingleHeader(req.headers['expo-protocol-version']);
  const protocolVersion = raw === undefined ? 0 : Number(raw);
  if (protocolVersion !== 0 && protocolVersion !== 1) {
    throw new OtaRequestError('Unsupported Expo Updates protocol version.', 400);
  }
  return protocolVersion;
};

export const serveManifest = async (req: Request, res: Response): Promise<void> => {
  try {
    const protocolVersion = protocolVersionOf(req);
    const platform = requirePlatform(
      asSingleHeader(req.headers['expo-platform']) ||
        (typeof req.query.platform === 'string' ? req.query.platform : undefined)
    );
    const runtimeVersion = requireSafeSegment(
      asSingleHeader(req.headers['expo-runtime-version']) ||
        (typeof req.query.runtimeVersion === 'string' ? req.query.runtimeVersion : undefined),
      'runtime version'
    );
    const releaseId = await latestReleaseId(runtimeVersion);
    const releaseDirectory = releaseDirectoryOf(runtimeVersion, releaseId);

    try {
      await access(path.join(releaseDirectory, 'rollback'));
      if (protocolVersion === 0) {
        throw new OtaRequestError('Rollback requires Expo Updates protocol version 1.', 400);
      }
      const embeddedId = asSingleHeader(req.headers['expo-embedded-update-id']);
      const currentId = asSingleHeader(req.headers['expo-current-update-id']);
      if (!embeddedId) throw new OtaRequestError('Missing embedded update id.', 400);
      if (currentId === embeddedId) {
        await sendMultipart({
          req,
          res,
          protocolVersion,
          partName: 'directive',
          payload: { type: 'noUpdateAvailable' },
        });
        return;
      }
      const rollbackStat = await stat(path.join(releaseDirectory, 'rollback'));
      await sendMultipart({
        req,
        res,
        protocolVersion,
        partName: 'directive',
        payload: {
          type: 'rollBackToEmbedded',
          parameters: { commitTime: rollbackStat.birthtime.toISOString() },
        },
      });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    const update = await buildUpdate(req, runtimeVersion, releaseId, platform);
    const currentUpdateId = asSingleHeader(req.headers['expo-current-update-id']);
    if (protocolVersion === 1 && currentUpdateId === update.manifest.id) {
      await sendMultipart({
        req,
        res,
        protocolVersion,
        partName: 'directive',
        payload: { type: 'noUpdateAvailable' },
      });
      return;
    }

    await sendMultipart({
      req,
      res,
      protocolVersion,
      partName: 'manifest',
      payload: update.manifest,
      includeExtensions: true,
    });
  } catch (error) {
    const status = error instanceof OtaRequestError ? error.status : 500;
    if (status >= 500) console.error('[ota] manifest failed:', error);
    res.status(status).json({
      error: status >= 500 ? 'OTA update is temporarily unavailable.' : (error as Error).message,
    });
  }
};

export const serveAsset = async (req: Request, res: Response): Promise<void> => {
  try {
    const runtimeVersion = requireSafeSegment(
      typeof req.query.runtimeVersion === 'string' ? req.query.runtimeVersion : undefined,
      'runtime version'
    );
    const releaseId = requireSafeSegment(
      typeof req.query.releaseId === 'string' ? req.query.releaseId : undefined,
      'release id'
    );
    const platform = requirePlatform(
      typeof req.query.platform === 'string' ? req.query.platform : undefined
    );
    const relativePath = portableAssetPath(
      typeof req.query.asset === 'string' ? req.query.asset : ''
    );
    const releaseDirectory = releaseDirectoryOf(runtimeVersion, releaseId);
    const { platformMetadata } = await readExportMetadata(releaseDirectory, platform);
    const declaredAsset = platformMetadata.assets.find(
      (asset) => portableAssetPath(asset.path) === relativePath
    );
    const isLaunchAsset = portableAssetPath(platformMetadata.bundle) === relativePath;
    if (!declaredAsset && !isLaunchAsset) {
      throw new OtaRequestError('Asset is not declared by this update.', 404);
    }

    const filePath = safeFilePath(releaseDirectory, relativePath);
    const fileStat = await stat(filePath);
    const contentType = isLaunchAsset
      ? 'application/javascript'
      : mime.getType(declaredAsset?.ext || '') || 'application/octet-stream';

    res.status(200);
    res.setHeader('content-type', contentType);
    res.setHeader('content-length', String(fileStat.size));
    res.setHeader('cache-control', 'public, max-age=31536000, immutable');
    res.setHeader('x-content-type-options', 'nosniff');
    createReadStream(filePath).on('error', (error) => res.destroy(error)).pipe(res);
  } catch (error) {
    const status =
      error instanceof OtaRequestError
        ? error.status
        : (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? 404
          : 500;
    if (status >= 500) console.error('[ota] asset failed:', error);
    if (!res.headersSent) {
      res.status(status).json({
        error: status >= 500 ? 'OTA asset is temporarily unavailable.' : (error as Error).message,
      });
    }
  }
};

export const otaStatus = async (): Promise<{ enabled: true; runtimes: string[] }> => {
  try {
    const entries = await readdir(OTA_UPDATES_DIR, { withFileTypes: true });
    return {
      enabled: true,
      runtimes: entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort(),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { enabled: true, runtimes: [] };
    throw error;
  }
};
