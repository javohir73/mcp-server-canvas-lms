import { describe, expect, it, vi } from 'vitest';
import { CanvasClient } from '../src/canvas/client.js';
import type { CanvasConfig } from '../src/config.js';
import { createContentHandlers } from '../src/tools/content-tools.js';
import { fixedNow } from './fixtures/academic.js';
import {
  contentAnnouncements,
  contentModules,
  contentPage,
  fallbackModuleItems,
} from './fixtures/content.js';

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
  return createContentHandlers({
    client: new CanvasClient(config, fetchMock),
    timezone: 'Australia/Sydney',
    now: () => fixedNow,
  });
}

describe('content handlers', () => {
  it('lists one course’s default 30-day announcement window newest first with cleaned HTML', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(contentAnnouncements));

    const text = responseText(
      await createHandlers(fetchMock).listAnnouncements({ course_id: 101 }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://canvas.example.edu/api/v1/announcements?context_codes%5B%5D=course_101&start_date=2026-07-15T00%3A00%3A00.000Z&end_date=2026-08-14T00%3A00%3A00.000Z&per_page=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(text).toContain('Canvas announcements');
    expect(text.indexOf('Newest expedition briefing')).toBeLessThan(
      text.indexOf('First expedition briefing'),
    );
    expect(text).toContain(
      'Meet at the map room [https://canvas.example.edu/map].',
    );
    expect(text).toContain(
      'Canvas: https://canvas.example.edu/courses/101/announcements/902',
    );
    expect(text).not.toMatch(/<p>|<strong>|ignore\(\)/);
  });

  it('batches all active course announcements in groups of twenty', async () => {
    const courses = Array.from({ length: 21 }, (_, index) => ({
      id: index + 1,
      name: `Course ${String(index + 1)}`,
    }));
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(courses))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([]));

    const text = responseText(
      await createHandlers(fetchMock).listAnnouncements({ since_days: 7 }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://canvas.example.edu/api/v1/courses?enrollment_state=active&include%5B%5D=term&include%5B%5D=total_scores&per_page=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      'https://canvas.example.edu/api/v1/announcements?context_codes%5B%5D=course_1&context_codes%5B%5D=course_2&context_codes%5B%5D=course_3&context_codes%5B%5D=course_4&context_codes%5B%5D=course_5&context_codes%5B%5D=course_6&context_codes%5B%5D=course_7&context_codes%5B%5D=course_8&context_codes%5B%5D=course_9&context_codes%5B%5D=course_10&context_codes%5B%5D=course_11&context_codes%5B%5D=course_12&context_codes%5B%5D=course_13&context_codes%5B%5D=course_14&context_codes%5B%5D=course_15&context_codes%5B%5D=course_16&context_codes%5B%5D=course_17&context_codes%5B%5D=course_18&context_codes%5B%5D=course_19&context_codes%5B%5D=course_20&start_date=2026-08-07T00%3A00%3A00.000Z&end_date=2026-08-14T00%3A00%3A00.000Z&per_page=100',
    );
    expect(String(fetchMock.mock.calls[2]?.[0])).toBe(
      'https://canvas.example.edu/api/v1/announcements?context_codes%5B%5D=course_21&start_date=2026-08-07T00%3A00%3A00.000Z&end_date=2026-08-14T00%3A00%3A00.000Z&per_page=100',
    );
    expect(text).toBe('No matching Canvas announcements found.');
  });

  it('returns the announcement empty state without querying announcements when there are no active courses', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([]));

    const text = responseText(
      await createHandlers(fetchMock).listAnnouncements({}),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(text).toBe('No matching Canvas announcements found.');
  });

  it.each([
    {
      input: { course_id: 0 },
      message: 'course_id must be a positive integer',
    },
    {
      input: { since_days: 0 },
      message: 'since_days must be an integer from 1 through 365',
    },
    {
      input: { since_days: 366 },
      message: 'since_days must be an integer from 1 through 365',
    },
    {
      input: { since_days: 1.5 },
      message: 'since_days must be an integer from 1 through 365',
    },
  ])(
    'rejects invalid announcement input $input before making a request',
    async ({ input, message }) => {
      const fetchMock = vi.fn<typeof fetch>();

      await expect(
        createHandlers(fetchMock).listAnnouncements(input),
      ).rejects.toThrow(message);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([1, 365])(
    'accepts %i as a since_days boundary',
    async (sinceDays) => {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse([]));

      await createHandlers(fetchMock).listAnnouncements({
        course_id: 101,
        since_days: sinceDays,
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('lists position-sorted modules, uses the item fallback, and includes lock and completion details', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(contentModules))
      .mockResolvedValueOnce(jsonResponse(fallbackModuleItems));

    const text = responseText(
      await createHandlers(fetchMock).listModules({ course_id: 101 }),
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://canvas.example.edu/api/v1/courses/101/modules?include%5B%5D=items&include%5B%5D=content_details&per_page=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://canvas.example.edu/api/v1/courses/101/modules/702/items?include%5B%5D=content_details&per_page=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(text).toContain('Canvas modules');
    expect(text.indexOf('Orientation')).toBeLessThan(text.indexOf('Fieldwork'));
    expect(text.indexOf('Welcome')).toBeLessThan(
      text.indexOf('Safety handbook'),
    );
    expect(text.indexOf('Locked trail map')).toBeLessThan(
      text.indexOf('Trail journal'),
    );
    expect(text).toContain('Type: Page');
    expect(text).toContain('Completion requirement: must_view');
    expect(text).toContain('Locked: yes');
    expect(text).toContain('Complete the orientation first.');
    expect(text).toContain(
      'Canvas: https://canvas.example.edu/courses/101/pages/trail-map',
    );
  });

  it('returns the modules empty state', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([]));

    const text = responseText(
      await createHandlers(fetchMock).listModules({ course_id: 101 }),
    );

    expect(text).toBe('No Canvas modules found for this course.');
  });

  it('gets an encoded page slug with cleaned HTML and its Canvas link', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(contentPage));

    const text = responseText(
      await createHandlers(fetchMock).getPage({
        course_id: 101,
        page_url: 'week 1 & notes',
      }),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://canvas.example.edu/api/v1/courses/101/pages/week%201%20%26%20notes',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(text).toContain('Canvas page');
    expect(text).toContain('Week 1 Notes');
    expect(text).toContain(
      'FIRST STEPS Bring a compass [https://canvas.example.edu/compass].',
    );
    expect(text).toContain(
      'Canvas: https://canvas.example.edu/courses/101/pages/week-1-notes',
    );
    expect(text).not.toMatch(/<h2>|<p>|hidden/);
  });

  it.each([
    {
      course_id: 0,
      page_url: 'welcome',
      message: 'course_id must be a positive integer',
    },
    {
      course_id: 101,
      page_url: '',
      message: 'page_url must be a valid Canvas page slug',
    },
    {
      course_id: 101,
      page_url: 'a/b',
      message: 'page_url must be a valid Canvas page slug',
    },
    {
      course_id: 101,
      page_url: 'a?b',
      message: 'page_url must be a valid Canvas page slug',
    },
    {
      course_id: 101,
      page_url: 'a#b',
      message: 'page_url must be a valid Canvas page slug',
    },
    {
      course_id: 101,
      page_url: 'a'.repeat(256),
      message: 'page_url must be a valid Canvas page slug',
    },
  ])('rejects invalid page input before making a request', async (input) => {
    const fetchMock = vi.fn<typeof fetch>();

    await expect(createHandlers(fetchMock).getPage(input)).rejects.toThrow(
      input.message,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
