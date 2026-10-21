import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
if (process.env.GITHUB_REF_NAME !== `v${version}`) {
  console.error('Release tag must match the package version.');
  process.exit(1);
}
const args = [
  'publish',
  '--provenance',
  '--access',
  'public',
  '--tag',
  version.includes('-') ? 'preview' : 'latest',
];
if (process.argv[2] === '--check') {
  console.log(JSON.stringify(args));
} else {
  if (process.argv.length !== 2) throw new Error('Unsupported publish option.');
  if (!process.env.npm_execpath)
    throw new Error('Run publishing through npm run release:publish.');
  const result = spawnSync(
    process.execPath,
    [process.env.npm_execpath, ...args],
    { stdio: 'inherit' },
  );
  if (result.error || result.status !== 0) process.exit(1);
}
