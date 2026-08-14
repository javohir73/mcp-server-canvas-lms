import type {
  CanvasAssignment,
  CanvasCourse,
  CanvasEnrollment,
} from '../canvas/types.js';
import { htmlToReadableText } from '../format/html.js';
import { textResult } from '../format/text.js';
import type { Handler, ToolDependencies } from './types.js';

const ACTIVE_COURSE_QUERY = {
  enrollment_state: 'active',
  'include[]': ['term', 'total_scores'],
  per_page: 100,
} as const;

export interface CourseHandlers {
  readonly listCourses: Handler<Record<string, never>>;
  readonly getSyllabus: Handler<{ course_id: number }>;
  readonly getGrades: Handler<{ course_id?: number }>;
}

export function createCourseHandlers(
  dependencies: ToolDependencies,
): CourseHandlers {
  const { client } = dependencies;

  return {
    async listCourses() {
      const courses = await client.getAll<CanvasCourse>(
        '/courses',
        ACTIVE_COURSE_QUERY,
      );
      return textResult(formatCourseList(courses));
    },

    async getSyllabus({ course_id }) {
      requirePositiveInteger(course_id, 'course_id');
      const course = await client.get<CanvasCourse>(
        `/courses/${String(course_id)}`,
        {
          'include[]': ['syllabus_body'],
        },
      );
      const syllabus = course.syllabus_body
        ? htmlToReadableText(course.syllabus_body)
        : 'No syllabus is available for this course.';
      return textResult(
        [
          'Canvas syllabus',
          `Course: ${course.name}`,
          `Course ID: ${String(course.id)}`,
          '',
          syllabus,
        ].join('\n'),
      );
    },

    async getGrades({ course_id }) {
      if (course_id === undefined) {
        const courses = await client.getAll<CanvasCourse>(
          '/courses',
          ACTIVE_COURSE_QUERY,
        );
        return textResult(formatGradeTotals(courses));
      }

      requirePositiveInteger(course_id, 'course_id');
      const course = await client.get<CanvasCourse>(
        `/courses/${String(course_id)}`,
        {
          'include[]': ['total_scores'],
        },
      );
      const assignments = await client.getAll<CanvasAssignment>(
        `/courses/${String(course_id)}/assignments`,
        { 'include[]': ['submission'], per_page: 100 },
      );
      return textResult(formatGradeBreakdown(course, assignments));
    },
  };
}

function formatCourseList(courses: readonly CanvasCourse[]): string {
  if (courses.length === 0) return 'No matching Canvas courses found.';
  return ['Canvas courses', ...courses.map(formatCourse)].join('\n\n');
}

function formatGradeTotals(courses: readonly CanvasCourse[]): string {
  if (courses.length === 0) return 'No matching Canvas courses found.';
  return ['Canvas grades', ...courses.map(formatGradeTotal)].join('\n\n');
}

function formatCourse(course: CanvasCourse): string {
  return [
    `Course: ${course.name}`,
    `Course ID: ${String(course.id)}`,
    `Code: ${course.course_code ?? 'not provided'}`,
    `Term: ${course.term?.name ?? 'not provided'}`,
    formatScore(course),
    ...(course.html_url ? [`Canvas: ${course.html_url}`] : []),
  ].join('\n');
}

function formatGradeTotal(course: CanvasCourse): string {
  return [
    `Course: ${course.name}`,
    `Course ID: ${String(course.id)}`,
    formatScore(course),
    formatCurrentGrade(course),
  ].join('\n');
}

function formatGradeBreakdown(
  course: CanvasCourse,
  assignments: readonly CanvasAssignment[],
): string {
  const heading = [
    'Canvas grades',
    `Course: ${course.name}`,
    `Course ID: ${String(course.id)}`,
    formatScore(course),
    formatCurrentGrade(course),
  ].join('\n');
  if (assignments.length === 0) {
    return `${heading}\n\nNo assignments with grade information found.`;
  }
  return [heading, ...assignments.map(formatAssignmentGrade)].join('\n\n');
}

function formatAssignmentGrade(assignment: CanvasAssignment): string {
  const score = assignment.submission?.score ?? 0;
  const possible = assignment.points_possible;
  return [
    `Assignment: ${assignment.name}`,
    `Assignment ID: ${String(assignment.id)}`,
    `Points: ${String(score)} / ${possible === null || possible === undefined ? 'not provided' : String(possible)}`,
    `Grade: ${assignment.submission?.grade ?? 'not graded'}`,
    `Submission state: ${assignment.submission?.workflow_state ?? 'unsubmitted'}`,
    ...(assignment.html_url ? [`Canvas: ${assignment.html_url}`] : []),
  ].join('\n');
}

function formatScore(course: CanvasCourse): string {
  const score = currentScore(course);
  return score === undefined
    ? 'Current score: hidden by Canvas'
    : `Current score: ${String(score)}%`;
}

function formatCurrentGrade(course: CanvasCourse): string {
  const grade = course.enrollments
    ?.map(
      (enrollment) =>
        enrollment.current_grade ?? enrollment.computed_current_grade,
    )
    .find((value): value is string => typeof value === 'string');
  return grade === undefined
    ? 'Current grade: hidden by Canvas'
    : `Current grade: ${grade}`;
}

function currentScore(course: CanvasCourse): number | undefined {
  for (const enrollment of course.enrollments ?? []) {
    const direct =
      enrollment.current_score ?? enrollment.computed_current_score;
    if (typeof direct === 'number') return direct;
    const nested = scoreFromGrades(enrollment);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function scoreFromGrades(enrollment: CanvasEnrollment): number | undefined {
  if (!isRecord(enrollment.grades)) return undefined;
  const value = enrollment.grades.current_score;
  return typeof value === 'number' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requirePositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${field} must be a positive integer`);
  }
}
