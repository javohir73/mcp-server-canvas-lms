import { afterEach, describe, expect, test } from 'vitest';
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
  stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CanvasClient } from '../src/canvas/client.js';
import { createChangesHandler } from '../src/tools/change-tools.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
const initial = '2026-10-21T00:00:00.000Z';
const later = '2026-10-22T00:00:00.000Z';
const task = (due_at: string | null = '2026-10-23T00:00:00Z', id = 1) => ({
  id,
  course_id: 11,
  name: `Essay ${id}`,
  due_at,
  description: 'private assignment body',
});
const news = (id: number, posted_at = '2026-10-21T12:00:00Z') => ({
  id,
  title: `News ${id}`,
  posted_at,
  message: 'private announcement body',
});

async function harness() {
  const directory = await mkdtemp(join(tmpdir(), 'canvas-history-test-'));
  directories.push(directory);
  const data = {
    now: initial,
    user: 7,
    origin: 'https://canvas.example.edu',
    token: 'synthetic-private-token',
    courses: [{ id: 11, name: 'Design' }] as unknown[],
    assignments: [task()] as unknown[],
    announcements: [] as unknown[],
    failed: '',
    status: 403,
    beforeAssignments: undefined as (() => Promise<void>) | undefined,
  };
  const requests: URL[] = [];
  const run = async (input = {}) => {
    const origin = new URL(data.origin);
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      requests.push(url);
      expect(init?.method).toBe('GET');
      if (url.pathname.endsWith(data.failed) && data.failed)
        return new Response('synthetic-private-token raw failure', {
          status: data.status,
        });
      if (url.pathname === '/api/v1/users/self')
        return Response.json({ id: data.user, name: 'private student name' });
      if (url.pathname === '/api/v1/courses')
        return Response.json(data.courses);
      if (url.pathname.endsWith('/assignments')) {
        await data.beforeAssignments?.();
        return Response.json(data.assignments);
      }
      if (url.pathname === '/api/v1/announcements')
        return Response.json(data.announcements);
      throw new Error('Unexpected route');
    };
    const handler = createChangesHandler({
      client: new CanvasClient(
        {
          baseUrl: origin,
          apiToken: data.token,
          timeoutMs: 1000,
          maxPages: 20,
        },
        fetchImpl,
      ),
      canvasOrigin: origin,
      timezone: 'UTC',
      now: () => new Date(data.now),
      stateDirectory: directory,
    });
    const result = await handler(input);
    return result.content
      .filter((x) => x.type === 'text')
      .map((x) => x.text)
      .join('\n');
  };
  return {
    data,
    run,
    directory,
    requests,
    history: async () => {
      const file = (await readdir(directory)).find((x) => x.endsWith('.json'));
      if (!file) throw new Error('Missing saved state');
      return join(directory, file);
    },
  };
}

describe('student change tracking', () => {
  test('first check establishes a baseline, then reports changed deadlines and new published announcements with sources', async () => {
    const h = await harness();
    h.data.announcements = [news(5, initial)];
    expect(await h.run()).toContain('Baseline saved');
    h.data.now = later;
    h.data.assignments = [task('2026-10-25T00:00:00Z')];
    h.data.announcements.push(news(6));
    const result = await h.run();
    expect(result).toContain('Deadline changed: Essay 1');
    expect(result).toContain('2026-10-23');
    expect(result).toContain('2026-10-25');
    expect(result).toContain(initial);
    expect(result).toContain(later);
    expect(result).toContain(
      'https://canvas.example.edu/courses/11/assignments/1',
    );
    expect(result).toContain('New announcement: News 6');
    expect(result).toContain(
      'https://canvas.example.edu/courses/11/discussion_topics/6',
    );
    expect(result).not.toContain('New announcement: News 5');
    expect(await h.run()).toContain('No changes detected');
  });

  test('stores minimal private metadata without tokens, names of students or content bodies, with restrictive POSIX permissions', async () => {
    const h = await harness();
    h.data.announcements = [news(5, initial)];
    await h.run();
    const path = await h.history();
    const raw = await readFile(path, 'utf8');
    expect(raw).not.toMatch(
      /synthetic-private-token|private student|private assignment body|private announcement body/,
    );
    if (process.platform !== 'win32') {
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      expect((await stat(h.directory)).mode & 0o777).toBe(0o700);
    }
  });

  test('token rotation preserves history while different Canvas users and institutions get new baselines', async () => {
    const h = await harness();
    await h.run();
    h.data.token = 'rotated-token';
    h.data.assignments = [task(null)];
    expect(await h.run()).toContain('Deadline changed: Essay 1');
    h.data.user = 8;
    expect(await h.run()).toContain('Baseline saved');
    h.data.origin = 'https://other.example.edu';
    expect(await h.run()).toContain('Baseline saved');
    expect(
      (await readdir(h.directory)).filter((x) => x.endsWith('.json')),
    ).toHaveLength(3);
  });

  test('new assignments and removed due dates are explicit; equivalent timestamp spellings are not changes', async () => {
    const h = await harness();
    await h.run();
    h.data.now = later;
    h.data.assignments = [task('2026-10-23T10:00:00+10:00')];
    expect(await h.run()).toContain('No changes detected');
    h.data.assignments = [task(null), task('2026-10-26T00:00:00Z', 2)];
    const result = await h.run();
    expect(result).toContain('No due date');
    expect(result).toContain('New assignment: Essay 2');
  });

  test('failed endpoints retain their last successful baseline without claiming deletion', async () => {
    const h = await harness();
    await h.run();
    h.data.now = later;
    h.data.failed = '/assignments';
    h.data.assignments = [task(null)];
    h.data.announcements = [news(6)];
    const partial = await h.run();
    expect(partial).toContain('assignments were not checked');
    expect(partial).toContain('New announcement: News 6');
    h.data.failed = '';
    expect(await h.run()).toContain('Deadline changed: Essay 1');
    h.data.assignments = [];
    expect(await h.run()).toContain('Detected changes: 0');
    h.data.assignments = [task('2026-10-27T00:00:00Z')];
    expect(await h.run()).toContain('Deadline changed: Essay 1');
  });

  test('an endpoint first becoming accessible seeds only its own baseline', async () => {
    const h = await harness();
    h.data.failed = '/assignments';
    await h.run();
    h.data.failed = '';
    h.data.now = later;
    h.data.announcements = [news(6)];
    const result = await h.run();
    expect(result).toContain('Baseline saved');
    expect(result).toContain('New announcement: News 6');
    expect(result).not.toContain('New assignment:');
  });

  test('malformed assignment or announcement responses do not advance their baseline', async () => {
    const h = await harness();
    await h.run();
    h.data.now = later;
    h.data.assignments = [task(null), { id: 'bad' }];
    h.data.announcements = [{ id: 6, posted_at: 'invalid' }];
    expect(await h.run()).toContain('invalid metadata');
    h.data.assignments = [task(null)];
    h.data.announcements = [news(6)];
    const result = await h.run();
    expect(result).toContain('Deadline changed: Essay 1');
    expect(result).toContain('New announcement: News 6');
  });

  test('authentication failure preserves saved bytes and exposes no raw token error', async () => {
    const h = await harness();
    await h.run();
    const path = await h.history();
    const before = await readFile(path, 'utf8');
    h.data.failed = '/announcements';
    h.data.status = 401;
    await expect(h.run()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(await readFile(path, 'utf8')).toBe(before);
  });

  test('corrupt history is reported and never overwritten', async () => {
    const h = await harness();
    await h.run();
    const path = await h.history();
    await writeFile(path, '{broken');
    const result = await h.run();
    expect(result).toContain('history could not be read');
    expect(await readFile(path, 'utf8')).toBe('{broken');
    expect(result).not.toContain(h.directory);
  });

  test('overlapping checks are rejected without losing the first check', async () => {
    const h = await harness();
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.data.beforeAssignments = async () => {
      entered();
      await waiting;
    };
    const first = h.run();
    await started;
    try {
      expect(await h.run()).toContain('Another change check is running');
    } finally {
      release();
    }
    expect(await first).toContain('Baseline saved');
    expect(
      (await readdir(h.directory)).filter((x) => x.endsWith('.lock')),
    ).toHaveLength(0);
  });

  test('future/unpublished announcements are excluded and long catch-up gaps are disclosed', async () => {
    const h = await harness();
    await h.run();
    h.data.now = '2026-12-22T00:00:00.000Z';
    h.data.announcements = [
      news(6, '2026-12-21T00:00:00Z'),
      news(7, '2027-01-01T00:00:00Z'),
      { ...news(8, '2026-12-21T00:00:00Z'), published: false },
    ];
    const result = await h.run();
    expect(result).toContain('30 days');
    expect(result).toContain('News 6');
    expect(result).not.toMatch(/News 7|News 8/);
  });

  test('display limits do not lose detected changes and disclose omitted items', async () => {
    const h = await harness();
    await h.run();
    h.data.assignments = [task(null), task(null, 2), task(null, 3)];
    const result = await h.run({ limit: 1 });
    expect(result).toContain('2 additional changes');
    expect(await h.run()).toContain('No changes detected');
  });
});

test('clock moving backwards cannot overwrite a newer baseline', async () => {
  const h = await harness();
  await h.run();
  const path = await h.history();
  const before = await readFile(path, 'utf8');
  h.data.now = '2026-10-20T00:00:00.000Z';
  h.data.assignments = [task(null)];
  expect(await h.run()).toContain('clock');
  expect(await readFile(path, 'utf8')).toBe(before);
});

test('a non-directory state location returns a safe error and changes no existing file', async () => {
  const h = await harness();
  await rm(h.directory, { recursive: true });
  await writeFile(h.directory, 'keep this file');
  const result = await h.run();
  expect(result).toContain('history could not be saved');
  expect(result).not.toContain(h.directory);
  expect(await readFile(h.directory, 'utf8')).toBe('keep this file');
});

test('an oversized history file is rejected without replacement', async () => {
  const h = await harness();
  await h.run();
  const path = await h.history();
  const { truncate } = await import('node:fs/promises');
  await truncate(path, 8 * 1024 * 1024 + 1);
  expect(await h.run()).toContain('history could not be read');
  expect((await stat(path)).size).toBe(8 * 1024 * 1024 + 1);
});

test('saving over the history size limit preserves the prior snapshot and cleans locks', async () => {
  const h = await harness();
  await h.run();
  const path = await h.history();
  const before = await readFile(path, 'utf8');
  h.data.assignments = Array.from({ length: 16_000 }, (_, i) => ({
    ...task(null, i + 1),
    name: 'x'.repeat(512),
  }));
  expect(await h.run()).toContain('history could not be saved');
  expect(await readFile(path, 'utf8')).toBe(before);
  expect(
    (await readdir(h.directory)).filter((x) => /\.(lock|tmp)$/.test(x)),
  ).toHaveLength(0);
});

test('course cap and output truncation are disclosed', async () => {
  const h = await harness();
  h.data.courses = Array.from({ length: 51 }, (_, index) => ({
    id: 11 + index,
    name: 'x'.repeat(512),
  }));
  expect(await h.run()).toContain('Only 50 of 51');
  h.data.courses = [{ id: 11, name: 'x'.repeat(512) }];
  h.data.assignments = Array.from({ length: 100 }, (_, i) => ({
    ...task(null, i + 2),
    name: 'y'.repeat(512),
  }));
  const result = await h.run({ limit: 100 });
  expect(result.length).toBeLessThanOrEqual(100_000);
  expect(result).toContain('Output shortened');
});
