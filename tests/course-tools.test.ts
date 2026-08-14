import { describe, expect, it, vi } from 'vitest';
import { CanvasClient } from '../src/canvas/client.js';
import type { CanvasConfig } from '../src/config.js';
import { createCourseHandlers } from '../src/tools/course-tools.js';
import {
  academicAssignments,
  academicCourses,
  fixedNow,
  syllabusCourse,
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

function responseText(
  result: Awaited<
    ReturnType<ReturnType<typeof createCourseHandlers>['listCourses']>
  >,
): string {
  return result.content[0]?.type === 'text' ? result.content[0].text : '';
}

function createHandlers(fetchMock: typeof fetch) {
  return createCourseHandlers({
    client: new CanvasClient(config, fetchMock),
    timezone: 'Australia/Sydney',
    now: () => fixedNow,
  });
}

describe('course handlers', () => {
  it('lists active courses with stable IDs, terms, scores, and hidden-grade messaging', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(academicCourses));

    const text = responseText(await createHandlers(fetchMock).listCourses({}));

    expect(fetchMock).toHaveBeenCalledWith(
      'https://canvas.example.edu/api/v1/courses?enrollment_state=active&include%5B%5D=term&include%5B%5D=total_scores&per_page=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(text).toContain('Canvas courses');
    expect(text).toContain('Mythical Systems');
    expect(text).toContain('Course ID: 101');
    expect(text).toContain('Spring Stories 2026');
    expect(text).toContain('Current score: 91.5%');
    expect(text).toContain('Cloud Cartography');
    expect(text).toContain('Current score: hidden by Canvas');
    expect(text).toContain('https://canvas.example.edu/courses/101');
    expect(JSON.stringify(academicCourses)).not.toContain(config.apiToken);
  });

  it('returns a stable empty state when Canvas has no active courses', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([]));

    const text = responseText(await createHandlers(fetchMock).listCourses({}));

    expect(text).toBe('No matching Canvas courses found.');
  });

  it('gets a syllabus by positive course ID and removes HTML and executable content', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(syllabusCourse));

    const text = responseText(
      await createHandlers(fetchMock).getSyllabus({ course_id: 101 }),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://canvas.example.edu/api/v1/courses/101?include%5B%5D=syllabus_body',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(text).toContain('Canvas syllabus');
    expect(text).toContain('Mythical Systems');
    expect(text).toContain('Course ID: 101');
    expect(text).toContain('Canvas: https://canvas.example.edu/courses/101');
    expect(text).toContain('VOYAGE PLAN Read Chapter One.');
    expect(text).not.toMatch(/<[^>]+>|hidden\(\)/);
  });

  it.each([0, -1, 1.5, Number.NaN])(
    'rejects invalid course ID %s before making a request',
    async (courseId) => {
      const fetchMock = vi.fn<typeof fetch>();

      await expect(
        createHandlers(fetchMock).getSyllabus({ course_id: courseId }),
      ).rejects.toThrow('course_id must be a positive integer');
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('lists grade totals for all active courses from the active-course endpoint', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(academicCourses));

    const text = responseText(await createHandlers(fetchMock).getGrades({}));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://canvas.example.edu/api/v1/courses?enrollment_state=active&include%5B%5D=term&include%5B%5D=total_scores&per_page=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(text).toContain('Canvas grades');
    expect(text).toContain('Mythical Systems');
    expect(text).toContain('Course ID: 101');
    expect(text).toContain('Current score: 91.5%');
    expect(text).toContain('Current score: hidden by Canvas');
    expect(text).toContain('Canvas: https://canvas.example.edu/courses/101');
  });

  it('gets one course total and its per-assignment grade breakdown', async () => {
    const zeroScoreAssignment = {
      ...academicAssignments[101][0],
      id: 1004,
      name: 'Basilisk Safety Quiz',
      submission: { workflow_state: 'graded', score: 0, grade: 'F' },
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(academicCourses[0]))
      .mockResolvedValueOnce(
        jsonResponse([academicAssignments[101][0], zeroScoreAssignment]),
      );

    const text = responseText(
      await createHandlers(fetchMock).getGrades({ course_id: 101 }),
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://canvas.example.edu/api/v1/courses/101?include%5B%5D=total_scores',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://canvas.example.edu/api/v1/courses/101/assignments?include%5B%5D=submission&per_page=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(text).toContain('Canvas grades');
    expect(text).toContain('Mythical Systems');
    expect(text).toContain('Canvas: https://canvas.example.edu/courses/101');
    expect(text).toContain('Dragon Migration Map');
    expect(text).toContain('Points: not graded / 40');
    expect(text).toContain('Grade: not graded');
    expect(text).toContain('Basilisk Safety Quiz');
    expect(text).toContain('Points: 0 / 40');
    expect(text).toContain('Grade: F');
  });

  it('uses the course empty state when the active-course grade list is empty', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([]));

    const text = responseText(await createHandlers(fetchMock).getGrades({}));

    expect(text).toBe('No matching Canvas courses found.');
  });
});
