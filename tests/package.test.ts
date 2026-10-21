import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { unzipSync, strFromU8 } from 'fflate';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { expect, test } from 'vitest';
import {
  pdfDocument,
  presentationDocument,
  wordDocument,
} from './fixtures/documents.js';

const execFileAsync = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, '..');

const TOOL_NAMES = [
  'canvas_get_assignment',
  'canvas_get_grades',
  'canvas_get_page',
  'canvas_get_submission',
  'canvas_get_syllabus',
  'canvas_get_weekly_overview',
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
  readonly version?: string;
  readonly repository?: { readonly type?: string; readonly url?: string };
  readonly homepage?: string;
  readonly bugs?: { readonly url?: string };
}

test('packed package starts all twelve tools, reads course documents and returns a weekly overview', async () => {
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
    expect(client.getServerVersion()?.version).toBe(installedPackage.version);

    // Exercise the installed package's readers, not the source tree's modules.
    const fixtures = [
      {
        name: 'brief.pdf',
        data: Buffer.from(pdfDocument(['Packed PDF content.'])).toString(
          'base64',
        ),
      },
      {
        name: 'brief.docx',
        data: Buffer.from(
          wordDocument('<w:p><w:r><w:t>Packed Word content.</w:t></w:r></w:p>'),
        ).toString('base64'),
      },
      {
        name: 'lecture.pptx',
        data: Buffer.from(presentationDocument()).toString('base64'),
      },
    ];
    const documentReaderScript = `
      import { createCanvasServer } from 'mcp-server-canvas-lms';
      import { Client } from '@modelcontextprotocol/sdk/client/index.js';
      import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
      const results = [];
      for (const fixture of JSON.parse(process.env.DOCUMENT_FIXTURES)) {
        const file = { id: 803, filename: fixture.name, content_type: 'application/octet-stream', url: 'https://canvas.example.edu/files/803/download' };
        const server = createCanvasServer({ baseUrl: new URL('https://canvas.example.edu'), apiToken: 'fictional-smoke-token', timeoutMs: 15000, maxPages: 20 }, {
          fetchImpl: async (url) => new Response(JSON.stringify(String(url).includes('/courses/') ? [file] : file)),
          downloadFetch: async () => new Response(Buffer.from(fixture.data, 'base64')),
        });
        const client = new Client({ name: 'packed-document-reader', version: '1.0.0' });
        const [left, right] = InMemoryTransport.createLinkedPair();
        try {
          await server.connect(right);
          await client.connect(left);
          results.push(await client.callTool({ name: 'canvas_read_file', arguments: { course_id: 101, file_id: 803 } }));
        } finally {
          await client.close();
          await server.close();
        }
      }
      const overviewServer = createCanvasServer({ baseUrl: new URL('https://canvas.example.edu'), apiToken: 'fictional-smoke-token', timeoutMs: 15000, maxPages: 20 }, {
        now: () => new Date('2026-10-21T00:00:00Z'),
        fetchImpl: async (input) => {
          const path = new URL(String(input)).pathname;
          return new Response(JSON.stringify(path === '/api/v1/courses' ? [{ id: 101, name: 'Weekly course' }] : path.endsWith('/assignments') ? [{ id: 7, course_id: 101, name: 'Weekly assignment', due_at: '2026-10-22T00:00:00Z', submission: { workflow_state: 'unsubmitted' } }] : []));
        },
      });
      const overviewClient = new Client({ name: 'packed-overview-reader', version: '1.0.0' });
      const [left, right] = InMemoryTransport.createLinkedPair();
      try {
        await overviewServer.connect(right);
        await overviewClient.connect(left);
        results.push(await overviewClient.callTool({ name: 'canvas_get_weekly_overview', arguments: {} }));
      } finally { await overviewClient.close(); await overviewServer.close(); }
      console.log(JSON.stringify(results));
    `;
    const { stdout: documentOutput } = await execFileAsync(
      process.execPath,
      ['--input-type=module', '--eval', documentReaderScript],
      {
        cwd: smokeDirectory,
        env: { ...process.env, DOCUMENT_FIXTURES: JSON.stringify(fixtures) },
      },
    );
    const documents = JSON.parse(documentOutput) as Array<{
      content: Array<{ text: string }>;
    }>;
    expect(documents[0]?.content[0]?.text).toContain(
      'Page 1\nPacked PDF content.',
    );
    expect(documents[1]?.content[0]?.text).toContain(
      'Paragraph 1\nPacked Word content.',
    );
    expect(documents[2]?.content[0]?.text).toContain(
      'Slide 1\nFirst: learning objectives',
    );
    expect(documents[3]?.content[0]?.text).toContain('Weekly assignment');

    await checkInstalledCommands(
      join(
        smokeDirectory,
        'node_modules',
        'mcp-server-canvas-lms',
        'bin',
        'mcp-server-canvas-lms.js',
      ),
    );

    const extensionPath = join(smokeDirectory, 'canvas-preview.mcpb');
    await execFileAsync(
      process.execPath,
      ['scripts/build-mcpb.mjs', extensionPath],
      { cwd: projectRoot },
    );
    const extension = unzipSync(new Uint8Array(await readFile(extensionPath)));
    const manifest = JSON.parse(strFromU8(extension['manifest.json']!));
    expect(manifest.user_config.canvas_api_token.sensitive).toBe(true);
    expect(manifest.compatibility.platforms).toEqual([process.platform]);
    expect(manifest.server.entry_point).toBe('dist/index.js');
    expect(
      manifest.tools.map((tool: { name: string }) => tool.name).sort(),
    ).toEqual(TOOL_NAMES);
    expect(extension['dist/index.js']).toBeDefined();
    expect(
      extension['node_modules/pdfjs-dist/legacy/build/pdf.mjs'],
    ).toBeDefined();
    expect(
      Object.keys(extension).some((name) =>
        /^(?:src\/|tests\/|\.env|scripts\/|node_modules\/vitest\/)/.test(name),
      ),
    ).toBe(false);
    const extensionRoot = join(smokeDirectory, 'extension');
    for (const [name, bytes] of Object.entries(extension)) {
      const destination = resolve(extensionRoot, name);
      if (!destination.startsWith(extensionRoot + sep))
        throw new Error('Unsafe archive path');
      if (name.endsWith('/')) continue;
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, bytes);
    }
    const { stdout: extensionOutput } = await execFileAsync(
      process.execPath,
      ['--input-type=module', '--eval', documentReaderScript],
      {
        cwd: extensionRoot,
        env: { ...process.env, DOCUMENT_FIXTURES: JSON.stringify(fixtures) },
      },
    );
    const extensionDocuments = JSON.parse(extensionOutput) as Array<{
      content: Array<{ text: string }>;
    }>;
    expect(extensionDocuments[0]?.content[0]?.text).toContain(
      'Page 1\nPacked PDF content.',
    );
    expect(extensionDocuments[1]?.content[0]?.text).toContain(
      'Paragraph 1\nPacked Word content.',
    );
    expect(extensionDocuments[2]?.content[0]?.text).toContain(
      'Slide 1\nFirst: learning objectives',
    );
    expect(extensionDocuments[3]?.content[0]?.text).toContain(
      'Weekly assignment',
    );
    await checkInstalledCommands(
      join(extensionRoot, manifest.server.entry_point),
    );
  } finally {
    try {
      await client?.close();
    } finally {
      await rm(smokeDirectory, { recursive: true, force: true });
      if (tarballPath) await rm(tarballPath, { force: true });
    }
  }
}, 120_000);

async function checkInstalledCommands(entry: string): Promise<void> {
  const baseEnv = { ...process.env, CANVAS_BASE_URL: '', CANVAS_API_TOKEN: '' };
  const help = await execFileAsync(process.execPath, [entry, '--help'], {
    env: baseEnv,
  });
  expect(help.stdout).toContain('--doctor');
  expect(help.stderr).toBe('');
  await expect(
    execFileAsync(process.execPath, [entry, '--doctor', '--json'], {
      env: baseEnv,
    }),
  ).rejects.toMatchObject({
    code: 1,
    stdout: expect.stringContaining('CANVAS_BASE_URL'),
  });

  const requests: Array<{
    method: string | undefined;
    url: string | undefined;
    authorization: string | undefined;
  }> = [];
  const server = createServer((request, response) => {
    requests.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization,
    });
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify([{ id: 1, name: 'private-course-name' }]));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Missing test port');
    const result = await execFileAsync(
      process.execPath,
      [entry, '--doctor', '--json'],
      {
        env: {
          ...baseEnv,
          CANVAS_BASE_URL: `http://127.0.0.1:${address.port}`,
          CANVAS_API_TOKEN: 'fictional-cli-token',
        },
      },
    );
    expect(JSON.parse(result.stdout).ok).toBe(true);
    expect(requests).toEqual([
      {
        method: 'GET',
        url: '/api/v1/courses?enrollment_state=active&per_page=1',
        authorization: 'Bearer fictional-cli-token',
      },
    ]);
    expect(result.stdout + result.stderr).not.toMatch(
      /private-course-name|fictional-cli-token/,
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
