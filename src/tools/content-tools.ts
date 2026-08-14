import type {
  CanvasAnnouncement,
  CanvasCourse,
  CanvasModule,
  CanvasModuleItem,
  CanvasPage,
} from '../canvas/types.js';
import { htmlToReadableText } from '../format/html.js';
import { formatTimestamp, textResult } from '../format/text.js';
import type { Handler, ToolDependencies } from './types.js';

const ACTIVE_COURSE_QUERY = {
  enrollment_state: 'active',
  'include[]': ['term', 'total_scores'],
  per_page: 100,
} as const;
const MODULE_QUERY = {
  'include[]': ['items', 'content_details'],
  per_page: 100,
} as const;
const MODULE_ITEM_QUERY = {
  'include[]': ['content_details'],
  per_page: 100,
} as const;
const ANNOUNCEMENT_BATCH_SIZE = 20;
const DEFAULT_SINCE_DAYS = 30;

export interface ContentHandlers {
  readonly listAnnouncements: Handler<{
    course_id?: number;
    since_days?: number;
  }>;
  readonly listModules: Handler<{ course_id: number }>;
  readonly getPage: Handler<{ course_id: number; page_url: string }>;
}

interface ModuleRecord {
  readonly module: CanvasModule;
  readonly items: readonly CanvasModuleItem[];
}

export function createContentHandlers(
  dependencies: ToolDependencies,
): ContentHandlers {
  const { client, now, timezone } = dependencies;

  return {
    async listAnnouncements(input) {
      validateAnnouncementInput(input);
      const dates = announcementDates(
        input.since_days ?? DEFAULT_SINCE_DAYS,
        now(),
      );
      const contextCodes =
        input.course_id === undefined
          ? (
              await client.getAll<CanvasCourse>('/courses', ACTIVE_COURSE_QUERY)
            ).map((course) => `course_${String(course.id)}`)
          : [`course_${String(input.course_id)}`];
      const announcements: CanvasAnnouncement[] = [];

      for (const contextBatch of batches(
        contextCodes,
        ANNOUNCEMENT_BATCH_SIZE,
      )) {
        announcements.push(
          ...(await client.getAll<CanvasAnnouncement>('/announcements', {
            'context_codes[]': contextBatch,
            start_date: dates.start,
            end_date: dates.end,
            per_page: 100,
          })),
        );
      }

      return textResult(formatAnnouncementList(announcements, timezone));
    },

    async listModules({ course_id }) {
      requirePositiveInteger(course_id, 'course_id');
      const modules = await client.getAll<CanvasModule>(
        `/courses/${String(course_id)}/modules`,
        MODULE_QUERY,
      );
      const records: ModuleRecord[] = [];

      for (const module of modules) {
        const items =
          module.items ??
          (await client.getAll<CanvasModuleItem>(
            `/courses/${String(course_id)}/modules/${String(module.id)}/items`,
            MODULE_ITEM_QUERY,
          ));
        records.push({ module, items });
      }

      return textResult(formatModuleList(records, timezone));
    },

    async getPage({ course_id, page_url }) {
      requirePositiveInteger(course_id, 'course_id');
      requirePageSlug(page_url);
      const page = await client.get<CanvasPage>(
        `/courses/${String(course_id)}/pages/${encodeURIComponent(page_url)}`,
      );
      return textResult(formatPage(page, course_id, timezone));
    },
  };
}

function validateAnnouncementInput(input: {
  readonly course_id?: number;
  readonly since_days?: number;
}): void {
  if (input.course_id !== undefined) {
    requirePositiveInteger(input.course_id, 'course_id');
  }
  if (
    input.since_days !== undefined &&
    (!Number.isInteger(input.since_days) ||
      input.since_days < 1 ||
      input.since_days > 365)
  ) {
    throw new TypeError('since_days must be an integer from 1 through 365');
  }
}

function requirePositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${field} must be a positive integer`);
  }
}

function requirePageSlug(value: string): void {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > 255 ||
    /[/?#]/.test(value)
  ) {
    throw new TypeError('page_url must be a valid Canvas page slug');
  }
}

function announcementDates(
  sinceDays: number,
  endDate: Date,
): { readonly start: string; readonly end: string } {
  return {
    start: new Date(
      endDate.getTime() - sinceDays * 24 * 60 * 60 * 1_000,
    ).toISOString(),
    end: endDate.toISOString(),
  };
}

function batches<T>(values: readonly T[], size: number): readonly T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function formatAnnouncementList(
  announcements: readonly CanvasAnnouncement[],
  timezone: string,
): string {
  if (announcements.length === 0) {
    return 'No matching Canvas announcements found.';
  }
  return [
    'Canvas announcements',
    ...sortByNewest(announcements).map((announcement) =>
      formatAnnouncement(announcement, timezone),
    ),
  ].join('\n\n');
}

function formatAnnouncement(
  announcement: CanvasAnnouncement,
  timezone: string,
): string {
  return [
    `Announcement: ${announcement.title ?? 'Untitled announcement'}`,
    `Announcement ID: ${String(announcement.id)}`,
    `Posted: ${formatOptionalTimestamp(announcement.posted_at, timezone)}`,
    ...(announcement.delayed_post_at
      ? [
          `Delayed until: ${formatOptionalTimestamp(announcement.delayed_post_at, timezone)}`,
        ]
      : []),
    ...(announcement.html_url ? [`Canvas: ${announcement.html_url}`] : []),
    '',
    'Message',
    announcement.message
      ? htmlToReadableText(announcement.message)
      : 'No announcement message provided.',
  ].join('\n');
}

function sortByNewest(
  announcements: readonly CanvasAnnouncement[],
): CanvasAnnouncement[] {
  return [...announcements].sort(
    (left, right) =>
      timestampValue(right.posted_at) - timestampValue(left.posted_at),
  );
}

function formatModuleList(
  records: readonly ModuleRecord[],
  timezone: string,
): string {
  if (records.length === 0) return 'No Canvas modules found for this course.';
  return [
    'Canvas modules',
    ...sortByPosition(records, (record) => record.module.position).map(
      (record) => formatModule(record, timezone),
    ),
  ].join('\n\n');
}

function formatModule(record: ModuleRecord, timezone: string): string {
  const module = record.module;
  const items = sortByPosition(record.items, (item) => item.position);
  return [
    `Module: ${module.name ?? 'Untitled module'}`,
    `Module ID: ${String(module.id)}`,
    `Position: ${formatOptionalNumber(module.position)}`,
    `State: ${module.state ?? 'not provided'}`,
    `Unlocks: ${formatOptionalTimestamp(module.unlock_at, timezone)}`,
    '',
    'Items',
    items.length === 0
      ? 'No module items found.'
      : items.map(formatModuleItem).join('\n\n'),
  ].join('\n');
}

function formatModuleItem(item: CanvasModuleItem): string {
  const lockExplanation = item.content_details?.lock_explanation;
  const locked =
    item.locked_for_user === true ||
    item.content_details?.locked_for_user === true;
  return [
    `Item: ${item.title ?? 'Untitled module item'}`,
    `Item ID: ${String(item.id)}`,
    `Type: ${item.type ?? 'not provided'}`,
    `Position: ${formatOptionalNumber(item.position)}`,
    `Completion requirement: ${item.completion_requirement?.type ?? 'not required'}`,
    `Locked: ${locked ? 'yes' : 'no'}`,
    ...(lockExplanation
      ? [`Lock details: ${htmlToReadableText(lockExplanation)}`]
      : []),
    ...(item.html_url ? [`Canvas: ${item.html_url}`] : []),
  ].join('\n');
}

function formatPage(
  page: CanvasPage,
  courseId: number,
  timezone: string,
): string {
  return [
    'Canvas page',
    `Title: ${page.title ?? page.url}`,
    `Course ID: ${String(courseId)}`,
    `Page URL: ${page.url}`,
    `Updated: ${formatOptionalTimestamp(page.updated_at, timezone)}`,
    ...(page.html_url ? [`Canvas: ${page.html_url}`] : []),
    '',
    'Content',
    page.body ? htmlToReadableText(page.body) : 'No page content provided.',
  ].join('\n');
}

function sortByPosition<T>(
  values: readonly T[],
  position: (value: T) => number | undefined,
): T[] {
  return [...values].sort(
    (left, right) =>
      normalizedPosition(position(left)) - normalizedPosition(position(right)),
  );
}

function normalizedPosition(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : Number.POSITIVE_INFINITY;
}

function formatOptionalTimestamp(
  value: string | null | undefined,
  timezone: string,
): string {
  return value && Number.isFinite(new Date(value).getTime())
    ? formatTimestamp(value, timezone)
    : 'not provided';
}

function timestampValue(value: string | null | undefined): number {
  const timestamp = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function formatOptionalNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? 'not provided' : String(value);
}
