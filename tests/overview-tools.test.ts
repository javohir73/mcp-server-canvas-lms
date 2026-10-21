import { describe, expect, it } from 'vitest';
import { CanvasClient } from '../src/canvas/client.js';
import type {
  CanvasAssignment,
  CanvasAnnouncement,
} from '../src/canvas/types.js';
import { createOverviewHandler } from '../src/tools/overview-tools.js';

const now = new Date('2026-10-21T00:00:00Z');
const config = {
  baseUrl: new URL('https://canvas.example.edu'),
  apiToken: 'overview-secret-token',
  timeoutMs: 100,
  maxPages: 20,
};

function assignment(
  id: number,
  overrides: Partial<CanvasAssignment> = {},
): CanvasAssignment {
  return {
    id,
    course_id: 11,
    name: `Work ${id}`,
    due_at: '2026-10-22T00:00:00Z',
    submission_types: ['online_upload'],
    submission: { workflow_state: 'unsubmitted' },
    ...overrides,
  };
}

function harness(
  options: {
    assignments?: readonly unknown[];
    secondAssignments?: readonly CanvasAssignment[];
    announcements?: readonly CanvasAnnouncement[];
    failure?: { path: string; status: number };
    courseCount?: number;
  } = {},
) {
  const requests: Array<{ url: URL; method: string | undefined }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, method: init?.method });
    if (options.failure?.path === url.pathname)
      return new Response('private overview-secret-token', {
        status: options.failure.status,
      });
    let value: unknown;
    if (url.pathname === '/api/v1/courses')
      value = Array.from({ length: options.courseCount ?? 2 }, (_, i) => ({
        id: 11 + i,
        name: i === 0 ? 'Design' : `Science ${i}`,
      }));
    else if (url.pathname === '/api/v1/announcements')
      value =
        url.searchParams.get('context_codes[]') === 'course_11'
          ? (options.announcements ?? [])
          : [];
    else if (url.pathname === '/api/v1/courses/11/assignments')
      value = options.assignments ?? [];
    else if (/\/courses\/\d+\/assignments$/.test(url.pathname))
      value = options.secondAssignments ?? [];
    else throw new Error('Unexpected API route');
    return new Response(JSON.stringify(value));
  };
  const run = createOverviewHandler({
    client: new CanvasClient(config, fetchImpl),
    timezone: 'Australia/Sydney',
    now: () => now,
    canvasOrigin: config.baseUrl,
  });
  return { run, requests };
}

async function textOf(
  result: ReturnType<ReturnType<typeof createOverviewHandler>>,
): Promise<string> {
  return (await result).content
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('\n');
}

describe('student weekly overview', () => {
  it('combines subjects and sorts upcoming work by the actual Canvas deadline', async () => {
    const h = harness({
      assignments: [
        assignment(1, { name: 'Later report', due_at: '2026-10-25T00:00:00Z' }),
      ],
      secondAssignments: [
        assignment(2, {
          course_id: 12,
          name: 'Earlier quiz',
          due_at: '2026-10-22T00:00:00Z',
        }),
      ],
    });
    const text = await textOf(h.run({}));
    expect(text).toContain('Student weekly overview');
    expect(text).toContain('Australia/Sydney');
    expect(text.indexOf('Earlier quiz')).toBeLessThan(
      text.indexOf('Later report'),
    );
    expect(text).toContain('Design');
    expect(text).toContain('Science 1');
    expect(text).toContain(
      'https://canvas.example.edu/courses/12/assignments/2',
    );
    expect(text).toContain('2026-10-21T00:00:00.000Z');
    expect(h.requests.every((request) => request.method === 'GET')).toBe(true);
    expect(
      h.requests
        .filter((r) => r.url.pathname.endsWith('/assignments'))
        .every(
          (r) =>
            r.url.searchParams.get('override_assignment_dates') === 'true' &&
            r.url.searchParams.get('include[]') === 'submission',
        ),
    ).toBe(true);
  });

  it('includes the exact horizon boundaries and excludes deadlines beyond the window', async () => {
    const text = await textOf(
      harness({
        assignments: [
          assignment(1, { name: 'Due now', due_at: now.toISOString() }),
          assignment(2, { name: 'At horizon', due_at: '2026-10-28T00:00:00Z' }),
          assignment(3, {
            name: 'Beyond horizon',
            due_at: '2026-10-28T00:00:00.001Z',
          }),
        ],
      }).run({}),
    );
    expect(text).toContain('Due now');
    expect(text).toContain('At horizon');
    expect(text).not.toContain('Beyond horizon');
  });

  it('keeps missing graded work overdue while excluding completed and excused work', async () => {
    const text = await textOf(
      harness({
        assignments: [
          assignment(1, {
            name: 'Missing report',
            due_at: '2026-10-20T00:00:00Z',
            submission: { workflow_state: 'graded', grade: '0', missing: true },
          }),
          assignment(2, {
            name: 'Submitted work',
            submission: { workflow_state: 'submitted' },
          }),
          assignment(3, {
            name: 'Under review',
            submission: { workflow_state: 'pending_review' },
          }),
          assignment(4, {
            name: 'Excused work',
            submission: { excused: true },
          }),
          assignment(5, {
            name: 'Marked work',
            submission: { workflow_state: 'graded' },
          }),
          assignment(6, {
            name: 'Calendar marker',
            submission_types: ['none'],
          }),
        ],
      }).run({}),
    );
    expect(text).toContain('Overdue');
    expect(text).toContain('Missing report');
    for (const name of [
      'Submitted work',
      'Under review',
      'Excused work',
      'Marked work',
      'Calendar marker',
    ])
      expect(text).not.toContain(name);
  });

  it('distinguishes unknown and offline completion from confirmed overdue work', async () => {
    const text = await textOf(
      harness({
        assignments: [
          assignment(1, {
            name: 'Unknown completion',
            due_at: '2026-10-20T00:00:00Z',
            submission: null,
          }),
          assignment(2, {
            name: 'Paper presentation',
            due_at: '2026-10-20T00:00:00Z',
            submission_types: ['on_paper'],
          }),
        ],
      }).run({}),
    );
    expect(text).toContain('Past deadlines to verify');
    expect(text).toContain('Unknown completion');
    expect(text).toContain('Paper presentation');
    expect(text).toMatch(/completion.*not confirmed/i);
    expect(text).toContain('Overdue (0)');
  });

  it('keeps reassigned work visible and asks students to verify past resubmission deadlines', async () => {
    const text = await textOf(
      harness({
        assignments: [
          {
            ...assignment(1, {
              name: 'Revision requested',
              due_at: '2026-10-20T00:00:00Z',
            }),
            submission: {
              workflow_state: 'graded',
              submitted_at: '2026-10-19T00:00:00Z',
              redo_request: true,
            },
          },
          {
            ...assignment(2, { name: 'Upcoming resubmission' }),
            submission: { workflow_state: 'submitted', redo_request: true },
          },
        ],
      }).run({}),
    );
    expect(text).toContain('Revision requested');
    expect(text).toContain('Upcoming resubmission');
    expect(text).toMatch(/resubmission requested/i);
    expect(text).toContain('Past deadlines to verify (1)');
    expect(text).toContain('Overdue (0)');
  });

  it('does not let an old submission timestamp override a current unsubmitted status', async () => {
    const text = await textOf(
      harness({
        assignments: [
          assignment(1, {
            name: 'Reset to unsubmitted',
            due_at: '2026-10-20T00:00:00Z',
            submission: {
              workflow_state: 'unsubmitted',
              submitted_at: '2026-10-19T00:00:00Z',
            },
          }),
        ],
      }).run({}),
    );
    expect(text).toContain('Reset to unsubmitted');
    expect(text).toContain('Overdue (1)');
  });

  it('identifies undated or invalid dates without inventing deadlines', async () => {
    const text = await textOf(
      harness({
        assignments: [
          assignment(1, { name: 'Undated task', due_at: null }),
          assignment(2, { name: 'Invalid date task', due_at: 'not-a-date' }),
        ],
      }).run({}),
    );
    expect(text).toContain('No confirmed due date');
    expect(text).toContain('Undated task');
    expect(text).toContain('Invalid date task');
    expect(text).not.toContain('Invalid Date');
  });

  it('filters announcements by time and publication, strips HTML and preserves source links', async () => {
    const text = await textOf(
      harness({
        announcements: [
          {
            id: 1,
            title: 'Earlier news',
            posted_at: '2026-10-15T00:00:00Z',
            message: '<p>Bring a calculator.</p><script>doBadThings()</script>',
          },
          { id: 2, title: 'Latest news', posted_at: '2026-10-20T00:00:00Z' },
          { id: 3, title: 'Future news', posted_at: '2026-10-22T00:00:00Z' },
          { id: 4, title: 'Old news', posted_at: '2026-10-01T00:00:00Z' },
          {
            id: 5,
            title: 'Scheduled news',
            posted_at: '2026-10-20T00:00:00Z',
            delayed_post_at: '2026-10-22T00:00:00Z',
          },
        ],
      }).run({}),
    );
    expect(text.indexOf('Latest news')).toBeLessThan(
      text.indexOf('Earlier news'),
    );
    expect(text).toContain('Bring a calculator.');
    expect(text).toContain(
      'https://canvas.example.edu/courses/11/discussion_topics/1',
    );
    for (const name of [
      'Future news',
      'Old news',
      'Scheduled news',
      'doBadThings()',
    ])
      expect(text).not.toContain(name);
  });

  it('marks partial assignment coverage but still returns accessible announcements and other subjects', async () => {
    const text = await textOf(
      harness({
        failure: { path: '/api/v1/courses/11/assignments', status: 403 },
        secondAssignments: [
          assignment(2, { course_id: 12, name: 'Accessible task' }),
        ],
        announcements: [
          {
            id: 1,
            title: 'Accessible news',
            posted_at: '2026-10-20T00:00:00Z',
          },
        ],
      }).run({}),
    );
    expect(text).toMatch(/partial coverage/i);
    expect(text).toMatch(/Design.*assignments.*not checked/i);
    expect(text).toContain('Accessible task');
    expect(text).toContain('Accessible news');
    expect(text).not.toContain('overview-secret-token');
  });

  it('fails on expired authentication instead of implying a complete overview', async () => {
    await expect(
      harness({
        failure: { path: '/api/v1/courses/11/assignments', status: 401 },
      }).run({}),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('discloses per-section omissions when the result limit is reached', async () => {
    const text = await textOf(
      harness({
        assignments: [
          assignment(1, { name: 'First task' }),
          assignment(2, {
            name: 'Second task',
            due_at: '2026-10-23T00:00:00Z',
          }),
        ],
      }).run({ limit: 1 }),
    );
    expect(text).toContain('First task');
    expect(text).not.toContain('Second task');
    expect(text).toMatch(/1 (?:more|additional|omitted)/i);
  });

  it('bounds course fan-out and discloses uninspected courses', async () => {
    const h = harness({ courseCount: 51 });
    const text = await textOf(h.run({}));
    expect(text).toMatch(/50 of 51/);
    expect(text).toMatch(/partial coverage/i);
    expect(
      h.requests.filter((r) => r.url.pathname.endsWith('/assignments')),
    ).toHaveLength(50);
  });

  it('handles no active courses without making course-scoped requests', async () => {
    const h = harness({ courseCount: 0 });
    expect(await textOf(h.run({}))).toMatch(/no active courses/i);
    expect(h.requests).toHaveLength(1);
  });

  it('marks malformed submission metadata as incomplete coverage rather than hiding work', async () => {
    const text = await textOf(
      harness({
        assignments: [
          assignment(1, { name: 'Visible task' }),
          {
            ...assignment(2),
            submission: { workflow_state: 'graded', submitted_at: 1 },
          },
        ],
      }).run({}),
    );
    expect(text).toContain('Visible task');
    expect(text).toMatch(/partial coverage/i);
    expect(text).toMatch(/invalid metadata/i);
  });

  it('caps the combined response and discloses overall truncation', async () => {
    const assignments = Array.from({ length: 200 }, (_, i) =>
      assignment(i + 1, {
        name: `Task ${i} ${'x'.repeat(200)}`,
        due_at:
          i < 50
            ? '2026-10-22T00:00:00Z'
            : i < 150
              ? '2026-10-20T00:00:00Z'
              : null,
        submission:
          i >= 100 && i < 150 ? null : { workflow_state: 'unsubmitted' },
      }),
    );
    const announcements = Array.from({ length: 50 }, (_, i) => ({
      id: i + 1,
      title: 'n'.repeat(200),
      message: 'body '.repeat(100),
      posted_at: '2026-10-20T00:00:00Z',
    }));
    const text = await textOf(
      harness({ assignments, announcements }).run({ limit: 50 }),
    );
    expect(text.length).toBeLessThanOrEqual(100000);
    expect(text).toContain('[Output truncated');
  });

  it('checks subjects concurrently without exceeding six in-flight requests', async () => {
    let active = 0;
    let peak = 0;
    const fetchImpl: typeof fetch = async (input) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      const courses = Array.from({ length: 8 }, (_, i) => ({
        id: 11 + i,
        name: `Course ${i}`,
      }));
      return new Response(
        JSON.stringify(
          new URL(String(input)).pathname === '/api/v1/courses' ? courses : [],
        ),
      );
    };
    const run = createOverviewHandler({
      client: new CanvasClient(config, fetchImpl),
      timezone: 'Australia/Sydney',
      now: () => now,
      canvasOrigin: config.baseUrl,
    });
    await run({});
    expect(peak).toBeGreaterThan(2);
    expect(peak).toBeLessThanOrEqual(6);
    expect(active).toBe(0);
  });

  it.each([
    { days_ahead: 0 },
    { days_ahead: 31 },
    { since_days: 0 },
    { limit: 51 },
    { timezone: 'not/a/timezone' },
  ])('rejects invalid input before network access', async (input) => {
    const h = harness();
    await expect(h.run(input)).rejects.toBeInstanceOf(TypeError);
    expect(h.requests).toHaveLength(0);
  });
});
