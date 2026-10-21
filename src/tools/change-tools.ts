import { CanvasError } from '../canvas/errors.js';
import { parseTimestamp, textResult } from '../format/text.js';
import {
  defaultHistoryDirectory,
  HistoryError,
  withHistory,
  type AssignmentHistory,
} from '../history/store.js';
import type { Handler, ToolDependencies } from './types.js';

interface ChangeDependencies extends ToolDependencies {
  readonly canvasOrigin: URL;
  readonly stateDirectory?: string;
}
interface ChangeInput {
  readonly limit?: number;
}
const DAY = 86_400_000;
const MAX_OUTPUT = 100_000;

/** Canvas remains read-only; only the local comparison history is updated. */
export function createChangesHandler(
  dependencies: ChangeDependencies,
): Handler<ChangeInput> {
  return async (input) => {
    const limit = input.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new TypeError('Invalid change limit');
    const identity = await dependencies.client.get<unknown>('/users/self');
    if (!record(identity) || !positiveId(identity.id))
      throw new CanvasError('BAD_RESPONSE', 'Invalid Canvas identity');
    try {
      return await withHistory(
        dependencies.stateDirectory ?? defaultHistoryDirectory(),
        dependencies.canvasOrigin.origin,
        identity.id,
        async (history) => {
          const now = dependencies.now();
          const checked = now.toISOString();
          if (
            Object.values(history.courses).some((course) =>
              [course.assignments?.checked, course.announcements?.checked].some(
                (value) => (parseTimestamp(value) ?? 0) > now.getTime(),
              ),
            )
          )
            throw new HistoryError('clock');
          const lines = [
            'Canvas changes',
            `Checked: ${checked}`,
            'Compared with each endpoint’s last successful check. First checks establish a baseline.',
          ];
          const changes: string[] = [];
          const notices: string[] = [];
          const rawCourses = await dependencies.client.getAll<unknown>(
            '/courses',
            { enrollment_state: 'active', per_page: 100 },
          );
          const courses = rawCourses.filter(
            (value): value is { id: number; name: string } =>
              record(value) &&
              positiveId(value.id) &&
              typeof value.name === 'string',
          );
          if (courses.length !== rawCourses.length)
            notices.push(
              'Some courses had invalid metadata and were not checked.',
            );
          if (courses.length > 50)
            notices.push(
              `Only 50 of ${String(courses.length)} active courses were checked.`,
            );
          if (courses.length === 0)
            notices.push(
              'No active courses were available to check. Existing history was preserved.',
            );
          for (const course of courses.slice(0, 50)) {
            const key = String(course.id);
            const previous = history.courses[key] ?? {};
            const next = { ...previous };
            const lastNews = parseTimestamp(previous.announcements?.checked);
            const windowStart = new Date(
              Math.max(
                (lastNews ?? now.getTime() - 30 * DAY) - DAY,
                now.getTime() - 30 * DAY,
              ),
            );
            const [work, news] = await Promise.allSettled([
              dependencies.client.getAll<unknown>(
                `/courses/${String(course.id)}/assignments`,
                { override_assignment_dates: true, per_page: 100 },
              ),
              dependencies.client.getAll<unknown>('/announcements', {
                'context_codes[]': [`course_${String(course.id)}`],
                start_date: windowStart.toISOString(),
                end_date: checked,
                active_only: true,
                per_page: 100,
              }),
            ]);
            for (const response of [work, news])
              if (
                response.status === 'rejected' &&
                response.reason instanceof CanvasError &&
                response.reason.code === 'UNAUTHORIZED'
              )
                throw response.reason;
            const label = short(course.name);
            if (work.status === 'fulfilled') {
              const assignments = work.value.map((value) =>
                readAssignment(value, course.id),
              );
              if (assignments.some((item) => item === undefined))
                notices.push(
                  `${label}: assignments had invalid metadata; their baseline was preserved.`,
                );
              else {
                const items = assignments.filter(
                  (value): value is AssignmentHistory => value !== undefined,
                );
                const old = new Map(
                  previous.assignments?.items.map((item) => [item.id, item]),
                );
                for (const item of items) {
                  const before = old.get(item.id);
                  const source = new URL(
                    `/courses/${String(course.id)}/assignments/${String(item.id)}`,
                    dependencies.canvasOrigin,
                  ).href;
                  if (previous.assignments && !before)
                    changes.push(
                      `New assignment: ${item.name} (${label})\nDue: ${deadline(item.due)}\nPreviously checked: ${previous.assignments.checked}\nSource: ${source}`,
                    );
                  else if (before && before.due !== item.due)
                    changes.push(
                      `Deadline changed: ${item.name} (${label})\nBefore: ${deadline(before.due)}\nNow: ${deadline(item.due)}\nPreviously checked: ${previous.assignments?.checked ?? 'unknown'}\nSource: ${source}`,
                    );
                  old.set(item.id, item);
                }
                next.assignments = { checked, items: [...old.values()] };
                if (!previous.assignments)
                  notices.push(
                    `${label}: Baseline saved for assignments; no earlier comparison exists.`,
                  );
              }
            } else
              notices.push(
                `${label}: assignments were not checked (${failure(work.reason)}); baseline preserved.`,
              );
            if (news.status === 'fulfilled') {
              const parsed = news.value.map(readAnnouncement);
              if (parsed.some((item) => item === undefined))
                notices.push(
                  `${label}: announcements had invalid metadata; their baseline was preserved.`,
                );
              else {
                const ids = new Set(previous.announcements?.ids ?? []);
                if (
                  lastNews !== undefined &&
                  lastNews < now.getTime() - 30 * DAY
                )
                  notices.push(
                    `${label}: announcement catch-up covers only the last 30 days; earlier posts may have been missed.`,
                  );
                for (const item of parsed) {
                  if (
                    !item ||
                    !item.published ||
                    item.posted > now.getTime() ||
                    item.posted < windowStart.getTime() ||
                    item.delayed > now.getTime()
                  )
                    continue;
                  if (previous.announcements && !ids.has(item.id)) {
                    const source = new URL(
                      `/courses/${String(course.id)}/discussion_topics/${String(item.id)}`,
                      dependencies.canvasOrigin,
                    ).href;
                    changes.push(
                      `New announcement: ${short(item.title)} (${label})\nPosted: ${new Date(item.posted).toISOString()}\nPreviously checked: ${previous.announcements.checked}\nSource: ${source}`,
                    );
                  }
                  ids.add(item.id);
                }
                next.announcements = { checked, ids: [...ids] };
                if (!previous.announcements)
                  notices.push(
                    `${label}: Baseline saved for announcements; no earlier comparison exists.`,
                  );
              }
            } else
              notices.push(
                `${label}: announcements were not checked (${failure(news.reason)}); baseline preserved.`,
              );
            history.courses[key] = next;
          }
          lines.push(`\nDetected changes: ${String(changes.length)}`);
          if (changes.length === 0)
            lines.push(
              'No changes detected in compared data. Check coverage notices below.',
            );
          lines.push(...changes.slice(0, limit).map((item) => `\n${item}`));
          if (changes.length > limit)
            lines.push(
              `\n${String(changes.length - limit)} additional changes omitted by the display limit. All detected items were recorded; use the source tools to inspect current data.`,
            );
          lines.push(
            '\nCoverage and storage',
            ...notices,
            'Only checked data is compared. Missing items are not reported as deleted. Local history was saved; this tool does not monitor Canvas or send notifications.',
          );
          let output = lines.join('\n');
          if (output.length > MAX_OUTPUT)
            output =
              output.slice(0, MAX_OUTPUT - 180) +
              '\nOutput shortened at 100,000 characters. Some changes or coverage notices were omitted. All detected items were recorded in local history.';
          return { history, result: textResult(output) };
        },
      );
    } catch (error) {
      if (!(error instanceof HistoryError)) throw error;
      const message =
        error.reason === 'clock'
          ? 'Your system clock is earlier than a saved check. Correct the clock and try again; previous history was preserved.'
          : error.reason === 'busy'
            ? 'Another change check is running. Wait for it to finish, then try again. If a previous process crashed, close Canvas MCP clients before removing the stale .lock file from your history directory.'
            : error.reason === 'read'
              ? 'Local change history could not be read. It was not replaced. Close Canvas MCP clients and back up or rename the history file before starting a new baseline.'
              : 'Local change history could not be saved. No comparison was acknowledged; fix the history directory permissions or storage limit and try again. Previous history was preserved.';
      return { ...textResult(message), isError: true };
    }
  };
}

function readAssignment(
  value: unknown,
  courseId: number,
): AssignmentHistory | undefined {
  if (
    !record(value) ||
    !positiveId(value.id) ||
    value.course_id !== courseId ||
    typeof value.name !== 'string' ||
    !('due_at' in value)
  )
    return undefined;
  if (value.due_at === null)
    return { id: value.id, name: short(value.name), due: null };
  const due = parseTimestamp(
    typeof value.due_at === 'string' ? value.due_at : undefined,
  );
  if (due === undefined) return undefined;
  return {
    id: value.id,
    name: short(value.name),
    due: new Date(due).toISOString(),
  };
}
function readAnnouncement(value: unknown) {
  if (
    !record(value) ||
    !positiveId(value.id) ||
    typeof value.title !== 'string'
  )
    return undefined;
  const posted = parseTimestamp(
    typeof value.posted_at === 'string' ? value.posted_at : undefined,
  );
  const delayed =
    value.delayed_post_at == null
      ? 0
      : parseTimestamp(
          typeof value.delayed_post_at === 'string'
            ? value.delayed_post_at
            : undefined,
        );
  if (
    posted === undefined ||
    delayed === undefined ||
    (value.published !== undefined && typeof value.published !== 'boolean')
  )
    return undefined;
  return {
    id: value.id,
    title: value.title,
    posted,
    delayed,
    published: value.published !== false,
  };
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function positiveId(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}
function short(value: string): string {
  return value.replace(/[\r\n\t]/g, ' ').slice(0, 512);
}
function deadline(value: string | null): string {
  return value ?? 'No due date';
}
function failure(error: unknown): string {
  if (error instanceof CanvasError) {
    if (error.code === 'FORBIDDEN') return 'access denied';
    if (error.code === 'RATE_LIMITED') return 'rate limited';
  }
  return 'unavailable';
}
