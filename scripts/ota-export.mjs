import fs from 'node:fs/promises';
import path from 'node:path';
import {
  clientDirectory,
  commitId,
  createAtomicRelease,
  defaultUpdatesRoot,
  loadExpoConfig,
  optionValue,
  releaseIdNow,
  run,
  runtimeVersionOf,
} from './ota-utils.mjs';

const config = loadExpoConfig();
const runtimeVersion = runtimeVersionOf(config);
const updateUrl = config.updates?.url;

const isPrivateOrLocalUrl = (value) => {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.local') || hostname === '::1') return true;
    const octets = hostname.split('.').map(Number);
    if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) return false;
    return (
      octets[0] === 10 ||
      octets[0] === 127 ||
      (octets[0] === 169 && octets[1] === 254) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168)
    );
  } catch {
    return true;
  }
};

const backendUrl = config.extra?.router?.origin;
if (
  !updateUrl ||
  isPrivateOrLocalUrl(updateUrl) ||
  (typeof backendUrl === 'string' && isPrivateOrLocalUrl(backendUrl))
) {
  throw new Error(
    'OTA/backend URL is missing or points to localhost/private LAN. Set EXPO_PUBLIC_BACKEND_BASE_URL or EXPO_PUBLIC_OTA_UPDATE_URL to the public server first.'
  );
}

const releaseId = releaseIdNow();
const message = optionValue('message') || 'manual OTA update';
const updatesRoot = optionValue('output-root') || process.env.OTA_UPDATES_DIR || defaultUpdatesRoot;
const exportDirectory = path.join(clientDirectory, '.expo', `ota-export-${process.pid}-${releaseId}`);

try {
  await fs.rm(exportDirectory, { recursive: true, force: true });
  run('pnpm', [
    '--dir',
    clientDirectory,
    'exec',
    'expo',
    'export',
    '--platform',
    'android',
    '--output-dir',
    exportDirectory,
    '--clear',
  ]);

  const metadata = JSON.parse(await fs.readFile(path.join(exportDirectory, 'metadata.json'), 'utf8'));
  if (!metadata.fileMetadata?.android?.bundle) {
    throw new Error('Expo export did not produce an Android launch bundle.');
  }

  const releaseDirectory = await createAtomicRelease({
    updatesRoot,
    runtimeVersion,
    releaseId,
    populate: async (temporaryDirectory) => {
      await fs.cp(exportDirectory, temporaryDirectory, { recursive: true });
      await fs.writeFile(
        path.join(temporaryDirectory, 'expoConfig.json'),
        `${JSON.stringify(config)}\n`,
        'utf8'
      );
      await fs.writeFile(
        path.join(temporaryDirectory, 'release.json'),
        `${JSON.stringify(
          {
            createdAt: new Date().toISOString(),
            message,
            commit: commitId(),
            runtimeVersion,
            platform: 'android',
            updateUrl,
          },
          null,
          2
        )}\n`,
        'utf8'
      );
    },
  });

  console.log(`OTA release created: ${releaseDirectory}`);
  console.log(`Runtime: ${runtimeVersion}`);
  console.log(`Update URL: ${updateUrl}`);
} finally {
  await fs.rm(exportDirectory, { recursive: true, force: true });
}
