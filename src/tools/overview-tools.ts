import { CanvasError } from '../canvas/errors.js';
import type {
  CanvasAnnouncement,
  CanvasAssignment,
  CanvasCourse,
} from '../canvas/types.js';
import { textResult, parseTimestamp as timestamp } from '../format/text.js';
import { formatOverview } from './overview-format.js';
import type { Handler, ToolDependencies } from './types.js';

export interface OverviewInput {
  readonly days_ahead?: number;
  readonly since_days?: number;
  readonly limit?: number;
  readonly timezone?: string;
}

export type OverviewCategory = 'upcoming' | 'overdue' | 'verify' | 'undated';
export interface OverviewAssignment {
  readonly course: CanvasCourse;
  readonly assignment: CanvasAssignment;
}
export interface OverviewAnnouncement {
  readonly course: CanvasCourse;
  readonly announcement: CanvasAnnouncement;
}
export interface OverviewData {
  readonly generated: Date;
  readonly horizon: Date;
  readonly since: Date;
  readonly timezone: string;
  readonly limit: number;
  readonly origin: URL;
  readonly totalCourses: number;
  readonly checkedCourses: number;
  readonly assignmentCourses: number;
  readonly announcementCourses: number;
  readonly warnings: readonly string[];
  readonly assignments: Readonly<
    Record<OverviewCategory, readonly OverviewAssignment[]>
  >;
  readonly announcements: readonly OverviewAnnouncement[];
}

interface OverviewDependencies extends ToolDependencies {
  readonly canvasOrigin: URL;
}

const DAY_MS = 24 * 60 * 60 * 1_000;
const MAX_COURSES = 50;

export function createOverviewHandler(
  dependencies: OverviewDependencies,
): Handler<OverviewInput> {
  return async (input) => {
    validateInput(input);
    const generated = dependencies.now();
    const horizon = new Date(
      generated.getTime() + (input.days_ahead ?? 7) * DAY_MS,
    );
    const since = new Date(
      generated.getTime() - (input.since_days ?? 7) * DAY_MS,
    );
    const courses = await dependencies.client.getAll<unknown>('/courses', {
      enrollment_state: 'active',
      per_page: 100,
    });
    const validCourses = courses.filter(isCourse);
    const selected = validCourses.slice(0, MAX_COURSES);
    const warnings: string[] = [];
    if (validCourses.length !== courses.length)
      warnings.push(
        'Some course entries had invalid metadata and were not checked.',
      );
    if (validCourses.length > selected.length)
      warnings.push(
        `Only ${String(selected.length)} of ${String(validCourses.length)} active courses were checked; remaining courses were not inspected.`,
      );
    const assignments: Record<OverviewCategory, OverviewAssignment[]> = {
      upcoming: [],
      overdue: [],
      verify: [],
      undated: [],
    };
    const announcements: OverviewAnnouncement[] = [];
    let assignmentCourses = 0;
    let announcementCourses = 0;

    for (let offset = 0; offset < selected.length; offset += 3) {
      const batch = await Promise.all(
        selected.slice(offset, offset + 3).map(async (course) => ({
          course,
          responses: await Promise.allSettled([
            dependencies.client.getAll<unknown>(
              `/courses/${String(course.id)}/assignments`,
              {
                'include[]': ['submission'],
                override_assignment_dates: true,
                order_by: 'due_at',
                per_page: 100,
              },
            ),
            dependencies.client.getAll<unknown>('/announcements', {
              'context_codes[]': [`course_${String(course.id)}`],
              start_date: since.toISOString(),
              end_date: generated.toISOString(),
              active_only: true,
              per_page: 100,
            }),
          ]),
        })),
      );
      for (const {
        course,
        responses: [work, news],
      } of batch) {
        if (work.status === 'fulfilled') {
          assignmentCourses += 1;
          let invalid = false;
          for (const value of work.value) {
            if (!isAssignment(value, course.id)) {
              invalid = true;
              continue;
            }
            const category = assignmentCategory(value, generated, horizon);
            if (category)
              assignments[category].push({ course, assignment: value });
          }
          if (invalid)
            warnings.push(
              `${course.name}: some assignments had invalid metadata and were not included.`,
            );
        } else
          warnings.push(
            `${course.name}: assignments were not checked (${failureSummary(work.reason)}).`,
          );

        if (news.status === 'fulfilled') {
          announcementCourses += 1;
          let invalid = false;
          for (const value of news.value) {
            if (!isAnnouncement(value)) {
              invalid = true;
              continue;
            }
            if (value.published === false) continue;
            const posted = timestamp(value.posted_at);
            if (posted === undefined) {
              invalid = true;
              continue;
            }
            const delayed = timestamp(value.delayed_post_at);
            if (
              posted >= since.getTime() &&
              posted <= generated.getTime() &&
              !(delayed !== undefined && delayed > generated.getTime())
            )
              announcements.push({ course, announcement: value });
          }
          if (invalid)
            warnings.push(
              `${course.name}: some announcements lacked usable metadata and were not included.`,
            );
        } else
          warnings.push(
            `${course.name}: announcements were not checked (${failureSummary(news.reason)}).`,
          );
      }
    }
    assignments.upcoming.sort((a, b) => due(a) - due(b));
    assignments.overdue.sort((a, b) => due(b) - due(a));
    assignments.verify.sort((a, b) => due(b) - due(a));
    announcements.sort(
      (a, b) =>
        (timestamp(b.announcement.posted_at) ?? 0) -
        (timestamp(a.announcement.posted_at) ?? 0),
    );
    return textResult(
      formatOverview({
        generated,
        horizon,
        since,
        timezone: input.timezone ?? dependencies.timezone,
        limit: input.limit ?? 10,
        origin: dependencies.canvasOrigin,
        totalCourses: validCourses.length,
        checkedCourses: selected.length,
        assignmentCourses,
        announcementCourses,
        warnings,
        assignments,
        announcements,
      }),
    );
  };
}

function validateInput(input: OverviewInput): void {
  for (const [name, value, maximum] of [
    ['days_ahead', input.days_ahead, 30],
    ['since_days', input.since_days, 30],
    ['limit', input.limit, 50],
  ] as const) {
    if (
      value !== undefined &&
      (!Number.isInteger(value) || value < 1 || value > maximum)
    )
      throw new TypeError(`${name} is outside its supported range`);
  }
  if (input.timezone !== undefined) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: input.timezone }).format(0);
    } catch {
      throw new TypeError('timezone must be a valid IANA timezone');
    }
  }
}

function assignmentCategory(
  assignment: CanvasAssignment,
  now: Date,
  horizon: Date,
): OverviewCategory | undefined {
  if (
    assignment.published === false ||
    assignment.submission_types?.some(
      (type) => type === 'none' || type === 'not_graded',
    )
  )
    return undefined;
  const submission = assignment.submission;
  const state = submission?.workflow_state;
  if (submission?.excused === true) return undefined;
  if (
    submission?.missing !== true &&
    submission?.redo_request !== true &&
    (state === 'submitted' || state === 'pending_review' || state === 'graded')
  )
    return undefined;
  const deadline = timestamp(assignment.due_at);
  if (deadline === undefined) return 'undated';
  if (deadline >= now.getTime())
    return deadline <= horizon.getTime() ? 'upcoming' : undefined;
  if (submission?.redo_request === true) return 'verify';
  if (submission?.missing === true) return 'overdue';
  if (
    state === 'unsubmitted' &&
    !assignment.submission_types?.includes('on_paper')
  )
    return 'overdue';
  return 'verify';
}

function due(record: OverviewAssignment): number {
  return timestamp(record.assignment.due_at) ?? 0;
}

function failureSummary(error: unknown): string {
  if (error instanceof CanvasError) {
    if (error.code === 'UNAUTHORIZED') throw error;
    if (error.code === 'FORBIDDEN') return 'access denied';
    if (error.code === 'RATE_LIMITED') return 'rate limited';
    if (error.code === 'TIMEOUT') return 'timed out';
  }
  return 'unavailable';
}

function isCourse(value: unknown): value is CanvasCourse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    Number.isInteger(value.id) &&
    Number(value.id) > 0 &&
    'name' in value &&
    typeof value.name === 'string'
  );
}

function isAssignment(
  value: unknown,
  courseId: number,
): value is CanvasAssignment {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('id' in value) ||
    !Number.isInteger(value.id) ||
    Number(value.id) <= 0 ||
    !('course_id' in value) ||
    value.course_id !== courseId ||
    !('name' in value) ||
    typeof value.name !== 'string'
  )
    return false;
  if (
    'due_at' in value &&
    value.due_at != null &&
    typeof value.due_at !== 'string'
  )
    return false;
  if (
    'submission' in value &&
    value.submission != null &&
    !isSubmission(value.submission)
  )
    return false;
  return (
    !('submission_types' in value) ||
    (Array.isArray(value.submission_types) &&
      value.submission_types.every((type: unknown) => typeof type === 'string'))
  );
}

function isSubmission(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  const fields = value as Record<string, unknown>;
  return (
    ['workflow_state', 'submitted_at'].every(
      (key) => fields[key] == null || typeof fields[key] === 'string',
    ) &&
    ['missing', 'excused', 'redo_request'].every(
      (key) => fields[key] === undefined || typeof fields[key] === 'boolean',
    )
  );
}

function isAnnouncement(value: unknown): value is CanvasAnnouncement {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('id' in value) ||
    !Number.isInteger(value.id) ||
    Number(value.id) <= 0
  )
    return false;
  return ['title', 'message', 'posted_at', 'delayed_post_at'].every(
    (key) =>
      !(key in value) ||
      (value as Record<string, unknown>)[key] == null ||
      typeof (value as Record<string, unknown>)[key] === 'string',
  );
}
