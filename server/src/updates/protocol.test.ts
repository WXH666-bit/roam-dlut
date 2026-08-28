import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isMultipartPartWithName,
  parseMultipartMixedResponseAsync,
} from '@expo/multipart-body-parser';
import express from 'express';

test('serves a signed Expo Updates manifest and immutable assets', async (context) => {
  const updatesRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'roam-dlut-ota-test-'));
  const runtimeVersion = '1.0.0';
  const releaseId = '1787894000000';
  const releaseDirectory = path.join(updatesRoot, runtimeVersion, releaseId);
  const bundlePath = '_expo/static/js/android/entry-test.hbc';
  const assetPath = 'assets/test-image';
  const bundle = Buffer.from('globalThis.__OTA_TEST__ = true;');
  const asset = Buffer.from('not-a-real-png-but-valid-test-bytes');

  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privateKeyPath = path.join(updatesRoot, 'private-key.pem');
  await fs.mkdir(path.dirname(path.join(releaseDirectory, bundlePath)), { recursive: true });
  await fs.mkdir(path.dirname(path.join(releaseDirectory, assetPath)), { recursive: true });
  await fs.writeFile(path.join(releaseDirectory, bundlePath), bundle);
  await fs.writeFile(path.join(releaseDirectory, assetPath), asset);
  await fs.writeFile(
    path.join(releaseDirectory, 'metadata.json'),
    JSON.stringify({
      version: 0,
      bundler: 'metro',
      fileMetadata: {
        android: {
          bundle: bundlePath,
          assets: [{ path: assetPath, ext: 'png' }],
        },
      },
    })
  );
  await fs.writeFile(
    path.join(releaseDirectory, 'expoConfig.json'),
    JSON.stringify({ name: 'OTA protocol test', version: runtimeVersion })
  );
  await fs.writeFile(
    path.join(releaseDirectory, 'release.json'),
    JSON.stringify({ createdAt: '2026-08-28T00:00:00.000Z' })
  );
  await fs.writeFile(
    privateKeyPath,
    privateKey.export({ type: 'pkcs8', format: 'pem' })
  );

  process.env.OTA_UPDATES_DIR = updatesRoot;
  process.env.OTA_PRIVATE_KEY_PATH = privateKeyPath;
  const updatesRouter = (await import('../routes/updates')).default;
  const app = express();
  app.use('/api/v1/updates', updatesRouter);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  process.env.OTA_PUBLIC_BASE_URL = baseUrl;

  context.after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    await fs.rm(updatesRoot, { recursive: true, force: true });
    delete process.env.OTA_UPDATES_DIR;
    delete process.env.OTA_PRIVATE_KEY_PATH;
    delete process.env.OTA_PUBLIC_BASE_URL;
  });

  const requestHeaders = {
    'expo-protocol-version': '1',
    'expo-platform': 'android',
    'expo-runtime-version': runtimeVersion,
    'expo-expect-signature': 'keyid="main", alg="rsa-v1_5-sha256"',
  };
  const manifestResponse = await fetch(`${baseUrl}/api/v1/updates/manifest`, {
    headers: requestHeaders,
  });
  assert.equal(manifestResponse.status, 200);
  assert.equal(manifestResponse.headers.get('expo-protocol-version'), '1');
  const contentType = manifestResponse.headers.get('content-type');
  if (!contentType) throw new Error('Manifest response has no content-type.');
  assert(contentType.startsWith('multipart/mixed'));
  const multipart = await parseMultipartMixedResponseAsync(
    contentType,
    Buffer.from(await manifestResponse.arrayBuffer())
  );
  const manifestPart = multipart.find((part) => isMultipartPartWithName(part, 'manifest'));
  assert(manifestPart);
  const manifest = JSON.parse(manifestPart.body) as {
    id: string;
    runtimeVersion: string;
    launchAsset: { hash: string; url: string };
    assets: Array<{ hash: string; fileExtension: string; url: string }>;
  };
  assert.match(manifest.id, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  assert.equal(manifest.runtimeVersion, runtimeVersion);
  assert.equal(manifest.launchAsset.hash, crypto.createHash('sha256').update(bundle).digest('base64url'));
  assert.equal(manifest.assets[0]?.hash, crypto.createHash('sha256').update(asset).digest('base64url'));
  assert.equal(manifest.assets[0]?.fileExtension, '.png');

  const signatureValue = manifestPart.headers.get('expo-signature');
  if (typeof signatureValue !== 'string') throw new Error('Manifest signature is missing.');
  const signature = signatureValue?.match(/sig="([^"]+)"/)?.[1];
  assert(signature);
  assert.equal(
    crypto.verify(
      'RSA-SHA256',
      Buffer.from(manifestPart.body),
      publicKey,
      Buffer.from(signature, 'base64')
    ),
    true
  );

  const bundleResponse = await fetch(manifest.launchAsset.url);
  assert.equal(bundleResponse.status, 200);
  assert.equal(bundleResponse.headers.get('content-type'), 'application/javascript');
  assert.deepEqual(Buffer.from(await bundleResponse.arrayBuffer()), bundle);

  const assetResponse = await fetch(manifest.assets[0]!.url);
  assert.equal(assetResponse.status, 200);
  assert.equal(assetResponse.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.deepEqual(Buffer.from(await assetResponse.arrayBuffer()), asset);

  const noUpdateResponse = await fetch(`${baseUrl}/api/v1/updates/manifest`, {
    headers: { ...requestHeaders, 'expo-current-update-id': manifest.id },
  });
  const noUpdateParts = await parseMultipartMixedResponseAsync(
    noUpdateResponse.headers.get('content-type')!,
    Buffer.from(await noUpdateResponse.arrayBuffer())
  );
  const directivePart = noUpdateParts.find((part) => isMultipartPartWithName(part, 'directive'));
  assert(directivePart);
  assert.deepEqual(JSON.parse(directivePart.body), { type: 'noUpdateAvailable' });

  const traversalResponse = await fetch(
    `${baseUrl}/api/v1/updates/assets?runtimeVersion=${runtimeVersion}&releaseId=${releaseId}&platform=android&asset=../private-key.pem`
  );
  assert.equal(traversalResponse.status, 404);

  const runtimeTraversalResponse = await fetch(
    `${baseUrl}/api/v1/updates/manifest?platform=android&runtimeVersion=..`
  );
  assert.equal(runtimeTraversalResponse.status, 400);

  const missingRuntimeResponse = await fetch(`${baseUrl}/api/v1/updates/manifest`, {
    headers: { ...requestHeaders, 'expo-runtime-version': '9.9.9' },
  });
  assert.equal(missingRuntimeResponse.status, 404);
});
