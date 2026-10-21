#!/usr/bin/env node
// Build the user's desktop-extension design from locked production dependencies.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
if (manifest.version !== pkg.version || manifest.name !== pkg.name)
  throw new Error('Manifest name and version must match package.json.');
const output = resolve(
  root,
  process.argv[2] ??
    `${pkg.name}-${pkg.version}-${process.platform}-${process.arch}.mcpb`,
);
const npmCli = [
  process.env.npm_execpath,
  resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
  resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
].find((path) => path && existsSync(path));
if (!npmCli) throw new Error('Run this builder with npm run build:mcpb.');
const packager = join(root, 'node_modules/@anthropic-ai/mcpb/dist/cli/cli.js');
if (!existsSync(packager))
  throw new Error('Run npm ci before building the desktop extension.');

run(process.execPath, [npmCli, 'run', 'build'], root);
const workspace = mkdtempSync(join(tmpdir(), 'canvas-mcpb-build-'));
const stage = join(workspace, 'package');
try {
  mkdirSync(stage);
  for (const file of [
    'package.json',
    'package-lock.json',
    'LICENSE',
    'README.md',
  ])
    cpSync(join(root, file), join(stage, file));
  cpSync(join(root, 'dist'), join(stage, 'dist'), { recursive: true });
  // PDF.js has optional native dependencies: do not label a host-built bundle
  // as a universal bundle. Build on each target platform and architecture.
  manifest.compatibility.platforms = [process.platform];
  manifest.long_description += `\n\nThis installer was built for ${process.platform} ${process.arch}. Use a matching platform and architecture.`;
  writeFileSync(
    join(stage, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  run(
    process.execPath,
    [npmCli, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
    stage,
  );
  run(
    process.execPath,
    [packager, 'validate', join(stage, 'manifest.json')],
    root,
  );
  const archive = join(workspace, 'bundle.mcpb');
  run(process.execPath, [packager, 'pack', stage, archive], root);
  mkdirSync(dirname(output), { recursive: true });
  copyFileSync(archive, output);
  const checksum = createHash('sha256')
    .update(readFileSync(output))
    .digest('hex');
  writeFileSync(
    `${output}.sha256`,
    `${checksum}  ${output.split(/[\\/]/).at(-1)}\n`,
  );
  console.log(`Built ${output}`);
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error || result.status !== 0)
    throw new Error(
      `Desktop-extension build failed (exit ${result.status ?? 'unknown'}).`,
    );
}
