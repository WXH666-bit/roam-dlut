import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

export const repositoryRoot = path.resolve(scriptDirectory, '..');
export const clientDirectory = path.join(repositoryRoot, 'client');
export const defaultUpdatesRoot = path.join(repositoryRoot, 'server', 'data', 'updates');

export const run = (command, args, options = {}) => {
  let executable = command;
  let executableArgs = args;
  if (process.platform === 'win32' && command === 'pnpm') {
    const corepackPnpm = path.join(
      path.dirname(process.execPath),
      'node_modules',
      'corepack',
      'dist',
      'pnpm.js'
    );
    if (!existsSync(corepackPnpm)) {
      throw new Error(`Unable to locate Corepack pnpm entry point at ${corepackPnpm}.`);
    }
    executable = process.execPath;
    executableArgs = [corepackPnpm, ...args];
  }

  const result = spawnSync(executable, executableArgs, {
    cwd: repositoryRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const details = options.capture ? `\n${result.stderr || result.stdout || ''}` : '';
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}.${details}`);
  }
  return result.stdout || '';
};

export const optionValue = (name) => {
  const exact = process.argv.findIndex((arg) => arg === `--${name}`);
  if (exact >= 0) return process.argv[exact + 1];
  const prefixed = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return prefixed?.slice(name.length + 3);
};

export const loadExpoConfig = () => {
  const stdout = run(
    'pnpm',
    ['--dir', clientDirectory, 'exec', 'expo', 'config', '--type', 'public', '--json'],
    { capture: true }
  );
  const jsonStart = stdout.indexOf('{');
  if (jsonStart < 0) throw new Error('Expo config command did not return JSON.');
  return JSON.parse(stdout.slice(jsonStart));
};

export const runtimeVersionOf = (config) => {
  if (typeof config.runtimeVersion === 'string') return config.runtimeVersion;
  if (config.runtimeVersion?.policy === 'appVersion' && config.version) return config.version;
  throw new Error('Unable to resolve runtimeVersion. Expected a string or appVersion policy.');
};

export const releaseIdNow = () => String(Date.now());

export const commitId = () => {
  try {
    return run('git', ['rev-parse', '--short=12', 'HEAD'], { capture: true }).trim();
  } catch {
    return null;
  }
};

export const createAtomicRelease = async ({ updatesRoot, runtimeVersion, releaseId, populate }) => {
  const runtimeDirectory = path.join(path.resolve(updatesRoot), runtimeVersion);
  const temporaryDirectory = path.join(runtimeDirectory, `.tmp-${releaseId}-${process.pid}`);
  const finalDirectory = path.join(runtimeDirectory, releaseId);
  await fs.mkdir(runtimeDirectory, { recursive: true });
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
  try {
    await fs.mkdir(temporaryDirectory, { recursive: true });
    await populate(temporaryDirectory);
    await fs.rename(temporaryDirectory, finalDirectory);
    return finalDirectory;
  } catch (error) {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
};
