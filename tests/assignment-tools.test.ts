import { describe, expect, it, vi } from 'vitest';
import { CanvasClient } from '../src/canvas/client.js';
import { CanvasError } from '../src/canvas/errors.js';
import type { CanvasConfig } from '../src/config.js';
import { createAssignmentHandlers } from '../src/tools/assignment-tools.js';
import {
  academicAssignments,
  academicCourses,
  fixedNow,
  gradedSubmission,
} from './fixtures/academic.js';

const config: Readonly<CanvasConfig> = Object.freeze({
  baseUrl: new URL('https://canvas.example.edu/'),
  apiToken: 'test-only-secret',
  timeoutMs: 15_000,
  maxPages: 20,
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function responseText(result: { content: readonly unknown[] }): string {
  const first = result.content[0];
  if (!first || typeof first !== 'object' || !('text' in first)) return '';
  return String(first.text);
}

function createHandlers(fetchMock: typeof fetch) {
  return createAssignmentHandlers({
    client: new CanvasClient(config, fetchMock),
    timezone: 'Australia/Sydney',
    now: () => fixedNow,
  });
}

describe('assignment handlers', () => {
  it('lists one course assignments from the fixed endpoint with bucket filtering', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(academicAssignments[101]));

    const text = responseText(
      await createHandlers(fetchMock).listAssignments({
        course_id: 101,
        bucket: 'overdue',
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://canvas.example.edu/api/v1/courses/101/assignments?include%5B%5D=submission&order_by=due_at&per_page=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(text).toContain('Canvas assignments');
    expect(text).toContain('Phoenix Field Notes');
    expect(text).toContain('Course ID: 101');
    expect(text).toContain('Assignment ID: 1002');
    expect(text).toContain('Australia/Sydney');
    expect(text).toContain('Submission state: unsubmitted');
    expect(text).toContain('Points possible: 20');
    expect(text).toContain(
      'https://canvas.example.edu/courses/101/assignments/1002',
    );
    expect(text).not.toContain('Dragon Migration Map');
  });

  it('reads all courses serially, skips a per-course 403, then globally sorts before limiting', async () => {
    let releaseFirstAssignments: (() => void) | undefined;
    const firstAssignmentsReady = new Promise<void>((resolve) => {
      releaseFirstAssignments = resolve;
    });
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const href = String(url);
      if (href.includes('/api/v1/courses?'))
        return jsonResponse(academicCourses);
      if (href.includes('/courses/101/assignments?')) {
        await firstAssignmentsReady;
        return jsonResponse(academicAssignments[101]);
      }
      if (href.includes('/courses/202/assignments?')) {
        return jsonResponse(academicAssignments[202]);
      }
      if (href.includes('/courses/303/assignments?')) {
        return new Response(null, { status: 403 });
      }
      throw new Error(`Unexpected URL: ${href}`);
    });

    const result = createHandlers(fetchMock).listAssignments({
      bucket: 'all',
      limit: 2,
    });
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes('/202/')),
    ).toBe(false);
    releaseFirstAssignments?.();
    const text = responseText(await result);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(text).toContain('Skipped Clockwork Botany: access denied');
    expect(text.indexOf('Phoenix Field Notes')).toBeLessThan(
      text.indexOf('Storm Ledger'),
    );
    expect(text).toContain('Mythical Systems');
    expect(text).toContain('Cloud Cartography');
    expect(text).not.toContain('Nimbus Classification');
    expect(text).not.toContain('Dragon Migration Map');
  });

  it.each(['UNAUTHORIZED', 'RATE_LIMITED', 'UNSAFE_URL', 'NETWORK'] as const)(
    'propagates %s errors from an all-course assignment read',
    async (code) => {
      const error = new CanvasError(code, `safe ${code}`);
      const client = {
        getAll: vi
          .fn()
          .mockResolvedValueOnce(academicCourses)
          .mockRejectedValueOnce(error),
        get: vi.fn(),
      } as unknown as CanvasClient;

      await expect(
        createAssignmentHandlers({
          client,
          timezone: 'Australia/Sydney',
          now: () => fixedNow,
        }).listAssignments({}),
      ).rejects.toBe(error);
    },
  );

  it('gets assignment details with cleaned description, rubric ratings, submission, grade, and web link', async () => {
    const detailedAssignment = {
      ...academicAssignments[101][0],
      submission: gradedSubmission,
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(detailedAssignment));

    const text = responseText(
      await createHandlers(fetchMock).getAssignment({
        course_id: 101,
        assignment_id: 1001,
      }),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://canvas.example.edu/api/v1/courses/101/assignments/1001?include%5B%5D=submission',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(text).toContain('Canvas assignment');
    expect(text).toContain('Dragon Migration Map');
    expect(text).toContain('Course ID: 101');
    expect(text).toContain('Assignment ID: 1001');
    expect(text).toContain('Australia/Sydney');
    expect(text).toContain('Points possible: 40');
    expect(text).toContain('Submission state: graded');
    expect(text).toContain('Grade: A-');
    expect(text).toContain('Route accuracy');
    expect(text).toContain('Excellent: 20 points');
    expect(text).toContain(
      'https://canvas.example.edu/courses/101/assignments/1001',
    );
    expect(text).not.toMatch(/<p>|<\/p>/);
  });

  it('gets the current user submission with comments, rubric assessment, timestamps, grade, and link', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(gradedSubmission));

    const text = responseText(
      await createHandlers(fetchMock).getSubmission({
        course_id: 101,
        assignment_id: 1001,
      }),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://canvas.example.edu/api/v1/courses/101/assignments/1001/submissions/self?include%5B%5D=submission_comments&include%5B%5D=rubric_assessment',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(text).toContain('Canvas submission');
    expect(text).toContain('Course ID: 101');
    expect(text).toContain('Assignment ID: 1001');
    expect(text).toContain('Submission state: graded');
    expect(text).toContain('Score: 36');
    expect(text).toContain('Grade: A-');
    expect(text).toContain('Professor Juniper');
    expect(text).toContain('Clear route and thoughtful legend.');
    expect(text).toContain('route: 18 points — excellent');
    expect(text).toContain('Accurate with one small omission.');
    expect(text).toContain('Australia/Sydney');
    expect(text).toContain(
      'https://canvas.example.edu/courses/101/assignments/1001/submissions/42',
    );
    expect(text).not.toMatch(/<p>|<\/p>/);
  });

  it.each([
    {
      input: { course_id: 0 },
      message: 'course_id must be a positive integer',
    },
    {
      input: { course_id: 1.2 },
      message: 'course_id must be a positive integer',
    },
    { input: { bucket: 'soon' }, message: 'bucket must be one of' },
    {
      input: { limit: 0 },
      message: 'limit must be an integer from 1 through 100',
    },
    {
      input: { limit: 101 },
      message: 'limit must be an integer from 1 through 100',
    },
    {
      input: { limit: 1.5 },
      message: 'limit must be an integer from 1 through 100',
    },
  ])('rejects invalid list input $input', async ({ input, message }) => {
    const fetchMock = vi.fn<typeof fetch>();

    await expect(
      createHandlers(fetchMock).listAssignments(input as never),
    ).rejects.toThrow(message);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      course_id: 0,
      assignment_id: 1,
      message: 'course_id must be a positive integer',
    },
    {
      course_id: 1,
      assignment_id: -1,
      message: 'assignment_id must be a positive integer',
    },
    {
      course_id: 1,
      assignment_id: 1.2,
      message: 'assignment_id must be a positive integer',
    },
  ])('rejects invalid detail IDs before making a request', async (input) => {
    const fetchMock = vi.fn<typeof fetch>();

    await expect(
      createHandlers(fetchMock).getAssignment(input),
    ).rejects.toThrow(input.message);
    await expect(
      createHandlers(fetchMock).getSubmission(input),
    ).rejects.toThrow(input.message);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
