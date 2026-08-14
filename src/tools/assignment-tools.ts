import { CanvasError } from '../canvas/errors.js';
import type {
  CanvasAssignment,
  CanvasCourse,
  CanvasRubricAssessment,
  CanvasRubricCriterion,
  CanvasSubmission,
} from '../canvas/types.js';
import {
  isInBucket,
  sortAssignments,
  type AssignmentBucket,
} from '../domain/assignments.js';
import { htmlToReadableText } from '../format/html.js';
import { formatTimestamp, textResult } from '../format/text.js';
import type { Handler, ToolDependencies } from './types.js';

const ACTIVE_COURSE_QUERY = {
  enrollment_state: 'active',
  'include[]': ['term', 'total_scores'],
  per_page: 100,
} as const;
const ASSIGNMENT_QUERY = {
  'include[]': ['submission'],
  order_by: 'due_at',
  per_page: 100,
} as const;
const BUCKETS = new Set<AssignmentBucket>([
  'upcoming',
  'overdue',
  'past',
  'all',
]);

export interface ListAssignmentsInput {
  readonly course_id?: number;
  readonly bucket?: AssignmentBucket;
  readonly limit?: number;
}

export interface AssignmentHandlers {
  readonly listAssignments: Handler<ListAssignmentsInput>;
  readonly getAssignment: Handler<{
    course_id: number;
    assignment_id: number;
  }>;
  readonly getSubmission: Handler<{
    course_id: number;
    assignment_id: number;
  }>;
}

interface AssignmentRecord {
  readonly assignment: CanvasAssignment;
  readonly courseName?: string;
}

export function createAssignmentHandlers(
  dependencies: ToolDependencies,
): AssignmentHandlers {
  const { client, timezone, now } = dependencies;

  return {
    async listAssignments(input) {
      validateListInput(input);
      const bucket = input.bucket ?? 'upcoming';
      const limit = input.limit ?? 100;
      const notes: string[] = [];
      let records: AssignmentRecord[];

      if (input.course_id !== undefined) {
        const assignments = await client.getAll<CanvasAssignment>(
          `/courses/${String(input.course_id)}/assignments`,
          ASSIGNMENT_QUERY,
        );
        records = assignments.map((assignment) => ({ assignment }));
      } else {
        const courses = await client.getAll<CanvasCourse>(
          '/courses',
          ACTIVE_COURSE_QUERY,
        );
        records = [];
        for (const course of courses) {
          try {
            const assignments = await client.getAll<CanvasAssignment>(
              `/courses/${String(course.id)}/assignments`,
              ASSIGNMENT_QUERY,
            );
            records.push(
              ...assignments.map((assignment) => ({
                assignment,
                courseName: course.name,
              })),
            );
          } catch (error) {
            if (error instanceof CanvasError && error.code === 'FORBIDDEN') {
              notes.push(`Skipped ${course.name}: access denied`);
              continue;
            }
            throw error;
          }
        }
      }

      const referenceTime = now();
      const filtered = records.filter(({ assignment }) =>
        isInBucket(assignment, bucket, referenceTime),
      );
      const ordered = sortRecords(filtered).slice(0, limit);
      return textResult(formatAssignmentList(ordered, notes, timezone));
    },

    async getAssignment({ course_id, assignment_id }) {
      validateIds(course_id, assignment_id);
      const assignment = await client.get<CanvasAssignment>(
        `/courses/${String(course_id)}/assignments/${String(assignment_id)}`,
        { 'include[]': ['submission'] },
      );
      return textResult(formatAssignmentDetail(assignment, timezone));
    },

    async getSubmission({ course_id, assignment_id }) {
      validateIds(course_id, assignment_id);
      const submission = await client.get<CanvasSubmission>(
        `/courses/${String(course_id)}/assignments/${String(assignment_id)}/submissions/self`,
        {
          'include[]': ['submission_comments', 'rubric_assessment'],
        },
      );
      return textResult(
        formatSubmission(submission, course_id, assignment_id, timezone),
      );
    },
  };
}

function validateListInput(input: ListAssignmentsInput): void {
  if (input.course_id !== undefined) {
    requirePositiveInteger(input.course_id, 'course_id');
  }
  if (input.bucket !== undefined && !BUCKETS.has(input.bucket)) {
    throw new TypeError(
      'bucket must be one of upcoming, overdue, past, or all',
    );
  }
  if (
    input.limit !== undefined &&
    (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100)
  ) {
    throw new TypeError('limit must be an integer from 1 through 100');
  }
}

function validateIds(courseId: number, assignmentId: number): void {
  requirePositiveInteger(courseId, 'course_id');
  requirePositiveInteger(assignmentId, 'assignment_id');
}

function requirePositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${field} must be a positive integer`);
  }
}

function sortRecords(records: readonly AssignmentRecord[]): AssignmentRecord[] {
  const byAssignment = new Map(
    records.map((record) => [record.assignment, record] as const),
  );
  return sortAssignments(records.map(({ assignment }) => assignment)).map(
    (assignment) => byAssignment.get(assignment) ?? { assignment },
  );
}

function formatAssignmentList(
  records: readonly AssignmentRecord[],
  notes: readonly string[],
  timezone: string,
): string {
  if (records.length === 0 && notes.length === 0) {
    return 'No matching Canvas assignments found.';
  }
  return [
    'Canvas assignments',
    ...records.map((record) => formatAssignmentSummary(record, timezone)),
    ...notes,
  ].join('\n\n');
}

function formatAssignmentSummary(
  record: AssignmentRecord,
  timezone: string,
): string {
  const { assignment, courseName } = record;
  return [
    `Assignment: ${assignment.name}`,
    ...(courseName ? [`Course: ${courseName}`] : []),
    `Course ID: ${String(assignment.course_id)}`,
    `Assignment ID: ${String(assignment.id)}`,
    `Due: ${formatOptionalTimestamp(assignment.due_at, timezone)}`,
    `Submission state: ${assignment.submission?.workflow_state ?? 'unsubmitted'}`,
    `Points possible: ${formatOptionalNumber(assignment.points_possible)}`,
    `Grade: ${assignment.submission?.grade ?? 'not graded'}`,
    ...(assignment.html_url ? [`Canvas: ${assignment.html_url}`] : []),
  ].join('\n');
}

function formatAssignmentDetail(
  assignment: CanvasAssignment,
  timezone: string,
): string {
  return [
    'Canvas assignment',
    `Assignment: ${assignment.name}`,
    `Course ID: ${String(assignment.course_id)}`,
    `Assignment ID: ${String(assignment.id)}`,
    `Due: ${formatOptionalTimestamp(assignment.due_at, timezone)}`,
    `Available from: ${formatOptionalTimestamp(assignment.unlock_at, timezone)}`,
    `Locks at: ${formatOptionalTimestamp(assignment.lock_at, timezone)}`,
    `Points possible: ${formatOptionalNumber(assignment.points_possible)}`,
    `Submission types: ${assignment.submission_types?.join(', ') ?? 'not provided'}`,
    `Submission state: ${assignment.submission?.workflow_state ?? 'unsubmitted'}`,
    `Score: ${formatOptionalNumber(assignment.submission?.score)}`,
    `Grade: ${assignment.submission?.grade ?? 'not graded'}`,
    ...(assignment.html_url ? [`Canvas: ${assignment.html_url}`] : []),
    '',
    'Description',
    assignment.description
      ? htmlToReadableText(assignment.description)
      : 'No description provided.',
    '',
    'Rubric',
    formatRubric(assignment.rubric),
  ].join('\n');
}

function formatRubric(
  rubric: readonly CanvasRubricCriterion[] | undefined,
): string {
  if (!rubric || rubric.length === 0) return 'No rubric provided.';
  return rubric
    .map((criterion) => {
      const ratings = criterion.ratings?.map(
        (rating) =>
          `${rating.description ?? rating.id ?? 'Rating'}: ${formatOptionalNumber(rating.points)} points`,
      );
      return [
        `${criterion.description ?? criterion.id}: ${formatOptionalNumber(criterion.points)} points`,
        ...(criterion.long_description
          ? [htmlToReadableText(criterion.long_description)]
          : []),
        ...(ratings ?? []),
      ].join('\n');
    })
    .join('\n\n');
}

function formatSubmission(
  submission: CanvasSubmission,
  courseId: number,
  assignmentId: number,
  timezone: string,
): string {
  return [
    'Canvas submission',
    `Course ID: ${String(courseId)}`,
    `Assignment ID: ${String(assignmentId)}`,
    `Submission state: ${submission.workflow_state ?? 'unsubmitted'}`,
    `Score: ${formatOptionalNumber(submission.score)}`,
    `Grade: ${submission.grade ?? 'not graded'}`,
    `Attempt: ${formatOptionalNumber(submission.attempt)}`,
    `Submitted: ${formatOptionalTimestamp(submission.submitted_at, timezone)}`,
    `Graded: ${formatOptionalTimestamp(submission.graded_at, timezone)}`,
    `Late: ${submission.late === true ? 'yes' : 'no'}`,
    `Missing: ${submission.missing === true ? 'yes' : 'no'}`,
    `Excused: ${submission.excused === true ? 'yes' : 'no'}`,
    ...(submission.url ? [`Canvas: ${submission.url}`] : []),
    '',
    'Comments',
    formatComments(submission, timezone),
    '',
    'Rubric assessment',
    formatRubricAssessment(submission.rubric_assessment),
  ].join('\n');
}

function formatComments(
  submission: CanvasSubmission,
  timezone: string,
): string {
  const comments = submission.submission_comments;
  if (!comments || comments.length === 0) return 'No submission comments.';
  return comments
    .map((comment) =>
      [
        `${comment.author_name ?? 'Canvas user'} — ${formatOptionalTimestamp(comment.created_at, timezone)}`,
        comment.comment
          ? htmlToReadableText(comment.comment)
          : 'No comment text.',
      ].join('\n'),
    )
    .join('\n\n');
}

function formatRubricAssessment(
  assessment: Readonly<Record<string, CanvasRubricAssessment>> | undefined,
): string {
  if (!assessment || Object.keys(assessment).length === 0) {
    return 'No rubric assessment.';
  }
  return Object.entries(assessment)
    .map(([criterionId, value]) =>
      [
        `${criterionId}: ${formatOptionalNumber(value.points)} points${value.rating_id ? ` — ${value.rating_id}` : ''}`,
        ...(value.comments ? [htmlToReadableText(value.comments)] : []),
      ].join('\n'),
    )
    .join('\n\n');
}

function formatOptionalTimestamp(
  value: string | null | undefined,
  timezone: string,
): string {
  return value ? formatTimestamp(value, timezone) : 'not provided';
}

function formatOptionalNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? 'not provided' : String(value);
}
