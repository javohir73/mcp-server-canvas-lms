import { htmlToReadableText } from '../format/html.js';
import {
  formatTimestamp,
  parseTimestamp as timestamp,
} from '../format/text.js';
import type { OverviewAssignment, OverviewData } from './overview-tools.js';

export function formatOverview(data: OverviewData): string {
  const lines = [
    'Student weekly overview',
    `Generated: ${data.generated.toISOString()}`,
    `Timezone: ${data.timezone}`,
    `Upcoming window: ${formatTimestamp(data.generated.toISOString(), data.timezone)} through ${formatTimestamp(data.horizon.toISOString(), data.timezone)}`,
    `Announcement window: ${formatTimestamp(data.since.toISOString(), data.timezone)} through ${formatTimestamp(data.generated.toISOString(), data.timezone)}`,
    `Coverage: ${String(data.checkedCourses)} of ${String(data.totalCourses)} active courses checked; assignments ${String(data.assignmentCourses)}/${String(data.checkedCourses)}, announcements ${String(data.announcementCourses)}/${String(data.checkedCourses)}.`,
    'This is an on-demand snapshot of Canvas metadata. Check source links for full instructions and external assessments.',
    ...(data.warnings.length
      ? [
          'Partial coverage: results exclude data that could not be checked.',
          ...data.warnings.map((warning) => clean(warning, 500)),
        ]
      : []),
    ...(data.totalCourses === 0
      ? [
          data.warnings.length
            ? 'No usable active course records were available; coverage is incomplete.'
            : 'No active courses were returned.',
        ]
      : []),
  ];
  for (const [category, title] of [
    ['upcoming', 'Upcoming deadlines'],
    ['overdue', 'Overdue'],
    ['verify', 'Past deadlines to verify'],
    ['undated', 'No confirmed due date'],
  ] as const) {
    const records = data.assignments[category];
    lines.push('', `${title} (${String(records.length)})`);
    if (records.length === 0)
      lines.push('No matching items in the checked data.');
    for (const record of records.slice(0, data.limit))
      lines.push('', formatAssignment(record, data));
    if (records.length > data.limit)
      lines.push(
        `${String(records.length - data.limit)} more items omitted by the per-section limit.`,
      );
  }
  lines.push('', `Recent announcements (${String(data.announcements.length)})`);
  if (data.announcements.length === 0)
    lines.push('No matching announcements in the checked data.');
  for (const { course, announcement } of data.announcements.slice(
    0,
    data.limit,
  )) {
    const text = htmlToReadableText(announcement.message ?? '');
    lines.push(
      '',
      [
        `${clean(course.name, 200)} — ${clean(announcement.title ?? 'Untitled announcement', 200)}`,
        `Posted: ${formatTimestamp(announcement.posted_at ?? '', data.timezone)}`,
        ...(text
          ? [
              text.length > 400
                ? `${text.slice(0, 400)} [Preview shortened; open the source.]`
                : text,
            ]
          : []),
        `Canvas: ${new URL(`/courses/${String(course.id)}/discussion_topics/${String(announcement.id)}`, data.origin).href}`,
      ].join('\n'),
    );
  }
  if (data.announcements.length > data.limit)
    lines.push(
      `${String(data.announcements.length - data.limit)} more announcements omitted by the per-section limit.`,
    );
  const text = lines.join('\n');
  const notice =
    '\n[Output truncated at 100,000 characters. Reduce the result limit or read the original Canvas sources.]';
  return text.length > 100_000
    ? text.slice(0, 100_000 - notice.length) + notice
    : text;
}

function formatAssignment(
  { course, assignment }: OverviewAssignment,
  data: OverviewData,
): string {
  const due = timestamp(assignment.due_at);
  const status =
    assignment.submission?.redo_request === true
      ? 'resubmission requested; confirm the current deadline in Canvas'
      : assignment.submission?.missing === true
        ? 'marked missing in Canvas'
        : assignment.submission_types?.includes('on_paper')
          ? 'offline submission; completion not confirmed'
          : assignment.submission?.workflow_state === 'unsubmitted'
            ? 'unsubmitted in Canvas'
            : 'not reported; completion not confirmed';
  return [
    `${clean(course.name, 200)} — ${clean(assignment.name, 200)}`,
    `Due: ${due === undefined ? 'not confirmed; verify in Canvas' : formatTimestamp(new Date(due).toISOString(), data.timezone)}`,
    `Submission: ${status}`,
    `Canvas: ${new URL(`/courses/${String(course.id)}/assignments/${String(assignment.id)}`, data.origin).href}`,
  ].join('\n');
}

function clean(value: string, limit: number): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > limit ? text.slice(0, limit - 1) + '…' : text;
}
