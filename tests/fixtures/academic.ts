import type {
  CanvasAssignment,
  CanvasCourse,
  CanvasSubmission,
} from '../../src/canvas/types.js';

export const academicCourses = [
  {
    id: 101,
    name: 'Mythical Systems',
    course_code: 'MYTH-101',
    html_url: 'https://canvas.example.edu/courses/101',
    term: { name: 'Spring Stories 2026' },
    enrollments: [
      {
        id: 501,
        course_id: 101,
        user_id: 42,
        type: 'StudentEnrollment',
        enrollment_state: 'active',
        current_score: 91.5,
        current_grade: 'A-',
      },
    ],
  },
  {
    id: 202,
    name: 'Cloud Cartography',
    course_code: 'CLOUD-202',
    html_url: 'https://canvas.example.edu/courses/202',
    term: { name: 'Spring Stories 2026' },
    enrollments: [
      {
        id: 502,
        course_id: 202,
        user_id: 42,
        type: 'StudentEnrollment',
        enrollment_state: 'active',
        current_score: null,
        current_grade: null,
      },
    ],
  },
  {
    id: 303,
    name: 'Clockwork Botany',
    course_code: 'BOT-303',
    html_url: 'https://canvas.example.edu/courses/303',
    term: { name: 'Spring Stories 2026' },
    enrollments: [
      {
        id: 503,
        course_id: 303,
        user_id: 42,
        type: 'StudentEnrollment',
        enrollment_state: 'active',
      },
    ],
  },
] as const satisfies readonly CanvasCourse[];

export const syllabusCourse = {
  ...academicCourses[0],
  syllabus_body:
    '<h2>Voyage plan</h2><p>Read <strong>Chapter One</strong>.</p><script>hidden()</script>',
} satisfies CanvasCourse;

export const academicAssignments = {
  101: [
    {
      id: 1001,
      course_id: 101,
      name: 'Dragon Migration Map',
      description:
        '<p>Plot the route using <a href="https://canvas.example.edu/courses/101/files/9">the atlas</a>.</p>',
      due_at: '2026-08-20T03:00:00Z',
      html_url: 'https://canvas.example.edu/courses/101/assignments/1001',
      points_possible: 40,
      submission_types: ['online_upload'],
      submission: { workflow_state: 'unsubmitted', score: null, grade: null },
      rubric: [
        {
          id: 'route',
          description: 'Route accuracy',
          points: 20,
          ratings: [
            { id: 'excellent', description: 'Excellent', points: 20 },
            { id: 'developing', description: 'Developing', points: 10 },
          ],
        },
      ],
    },
    {
      id: 1002,
      course_id: 101,
      name: 'Phoenix Field Notes',
      due_at: '2026-08-10T04:00:00Z',
      html_url: 'https://canvas.example.edu/courses/101/assignments/1002',
      points_possible: 20,
      submission_types: ['online_text_entry'],
      submission: { workflow_state: 'unsubmitted', score: null, grade: null },
    },
    {
      id: 1003,
      course_id: 101,
      name: 'Unscheduled Observatory Visit',
      due_at: null,
      html_url: 'https://canvas.example.edu/courses/101/assignments/1003',
      points_possible: 5,
      submission_types: ['none'],
      submission: { workflow_state: 'unsubmitted' },
    },
  ],
  202: [
    {
      id: 2001,
      course_id: 202,
      name: 'Nimbus Classification',
      due_at: '2026-08-16T22:30:00Z',
      html_url: 'https://canvas.example.edu/courses/202/assignments/2001',
      points_possible: 30,
      submission_types: ['online_quiz'],
      submission: { workflow_state: 'unsubmitted', score: null, grade: null },
    },
    {
      id: 2002,
      course_id: 202,
      name: 'Storm Ledger',
      due_at: '2026-08-12T01:00:00Z',
      html_url: 'https://canvas.example.edu/courses/202/assignments/2002',
      points_possible: 50,
      submission_types: ['online_upload'],
      submission: { workflow_state: 'graded', score: 44, grade: 'A' },
    },
  ],
} as const satisfies Readonly<Record<101 | 202, readonly CanvasAssignment[]>>;

export const gradedSubmission = {
  id: 8001,
  workflow_state: 'graded',
  submitted_at: '2026-08-15T02:10:00Z',
  graded_at: '2026-08-16T06:00:00Z',
  grade: 'A-',
  score: 36,
  excused: false,
  late: false,
  missing: false,
  attempt: 2,
  url: 'https://canvas.example.edu/courses/101/assignments/1001/submissions/42',
  submission_comments: [
    {
      id: 9001,
      author_name: 'Professor Juniper',
      comment: '<p>Clear route and thoughtful legend.</p>',
      created_at: '2026-08-16T06:05:00Z',
    },
  ],
  rubric_assessment: {
    route: {
      points: 18,
      rating_id: 'excellent',
      comments: 'Accurate with one small omission.',
    },
  },
} as const satisfies CanvasSubmission;

export const fixedNow = new Date('2026-08-14T00:00:00Z');
