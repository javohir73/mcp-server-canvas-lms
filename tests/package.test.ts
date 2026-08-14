import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { expect, test } from 'vitest';

const execFileAsync = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, '..');

const TOOL_NAMES = [
  'canvas_get_assignment',
  'canvas_get_grades',
  'canvas_get_page',
  'canvas_get_submission',
  'canvas_get_syllabus',
  'canvas_list_announcements',
  'canvas_list_assignments',
  'canvas_list_courses',
  'canvas_list_files',
  'canvas_list_modules',
  'canvas_read_file',
] as const;

interface PackResult {
  readonly filename: string;
  readonly files: ReadonlyArray<{ readonly path: string }>;
}

interface PublishedPackage {
  readonly repository?: { readonly type?: string; readonly url?: string };
  readonly homepage?: string;
  readonly bugs?: { readonly url?: string };
}

test('packed package clean-installs with only public runtime files and starts all eleven tools', async () => {
  const smokeDirectory = await mkdtemp(join(tmpdir(), 'canvas-mcp-smoke-'));
  let tarballPath: string | undefined;
  let client: Client | undefined;

  try {
    await execFileAsync('npm', ['run', 'build'], {
      cwd: projectRoot,
      env: { ...process.env, npm_config_dry_run: 'false' },
    });

    const { stdout } = await execFileAsync(
      'npm',
      ['pack', '--json', '--ignore-scripts'],
      {
        cwd: projectRoot,
        env: { ...process.env, npm_config_dry_run: 'false' },
      },
    );
    const [packResult] = JSON.parse(stdout) as PackResult[];
    if (!packResult) throw new Error('npm pack returned no package result');

    tarballPath = join(projectRoot, packResult.filename);
    const packedFiles = packResult.files.map(({ path }) => path).sort();
    const topLevelEntries = [
      ...new Set(packedFiles.map((path) => path.split('/')[0])),
    ].sort();

    expect(topLevelEntries).toEqual([
      'LICENSE',
      'README.md',
      'bin',
      'dist',
      'package.json',
    ]);
    expect(packedFiles).toContain('dist/server.d.ts');
    expect(
      packedFiles.some((path) =>
        [
          'src/',
          'tests/',
          '.env',
          '.github/',
          'docs/superpowers/',
          'downloads/',
        ].some((forbidden) => path.startsWith(forbidden)),
      ),
    ).toBe(false);

    await execFileAsync(
      'npm',
      ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarballPath],
      {
        cwd: smokeDirectory,
        env: { ...process.env, npm_config_dry_run: 'false' },
      },
    );

    const installedPackage = JSON.parse(
      await readFile(
        join(
          smokeDirectory,
          'node_modules',
          'mcp-server-canvas-lms',
          'package.json',
        ),
        'utf8',
      ),
    ) as PublishedPackage;
    expect(installedPackage.repository).toEqual({
      type: 'git',
      url: 'git+https://github.com/javohir73/mcp-server-canvas-lms.git',
    });
    expect(installedPackage.homepage).toBe(
      'https://github.com/javohir73/mcp-server-canvas-lms#readme',
    );
    expect(installedPackage.bugs).toEqual({
      url: 'https://github.com/javohir73/mcp-server-canvas-lms/issues',
    });

    const installedReadme = await readFile(
      join(
        smokeDirectory,
        'node_modules',
        'mcp-server-canvas-lms',
        'README.md',
      ),
      'utf8',
    );
    expect(installedReadme).not.toMatch(/\]\(docs\/clients\//);
    for (const guide of [
      'codex.md',
      'claude-desktop.md',
      'cursor.md',
      'vscode.md',
      'generic.md',
    ]) {
      expect(installedReadme).toContain(
        `https://github.com/javohir73/mcp-server-canvas-lms/blob/main/docs/clients/${guide}`,
      );
    }

    const transport = new StdioClientTransport({
      command: join(
        smokeDirectory,
        'node_modules',
        '.bin',
        'mcp-server-canvas-lms',
      ),
      cwd: smokeDirectory,
      env: {
        ...getDefaultEnvironment(),
        CANVAS_BASE_URL: 'https://canvas.example.edu',
        CANVAS_API_TOKEN: 'fictional-package-smoke-token',
      },
      stderr: 'pipe',
    });
    client = new Client({
      name: 'canvas-package-smoke-test',
      version: '1.0.0',
    });

    await client.connect(transport);
    const tools = await client.listTools();

    expect(tools.tools.map(({ name }) => name).sort()).toEqual(TOOL_NAMES);
  } finally {
    try {
      await client?.close();
    } finally {
      await rm(smokeDirectory, { recursive: true, force: true });
      if (tarballPath) await rm(tarballPath, { force: true });
    }
  }
}, 60_000);
