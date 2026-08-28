import fs from 'node:fs/promises';
import path from 'node:path';
import {
  createAtomicRelease,
  defaultUpdatesRoot,
  loadExpoConfig,
  optionValue,
  releaseIdNow,
  runtimeVersionOf,
} from './ota-utils.mjs';

const config = loadExpoConfig();
const runtimeVersion = runtimeVersionOf(config);
const releaseId = releaseIdNow();
const updatesRoot = optionValue('output-root') || process.env.OTA_UPDATES_DIR || defaultUpdatesRoot;

const releaseDirectory = await createAtomicRelease({
  updatesRoot,
  runtimeVersion,
  releaseId,
  populate: async (temporaryDirectory) => {
    await fs.writeFile(path.join(temporaryDirectory, 'rollback'), '', 'utf8');
    await fs.writeFile(
      path.join(temporaryDirectory, 'release.json'),
      `${JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          message: optionValue('message') || 'rollback to embedded update',
          runtimeVersion,
          type: 'rollback',
        },
        null,
        2
      )}\n`,
      'utf8'
    );
  },
});

console.log(`OTA rollback created: ${releaseDirectory}`);
console.log(`Runtime: ${runtimeVersion}`);
