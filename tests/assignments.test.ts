import { describe, expect, it } from 'vitest';
import type { CanvasAssignment } from '../src/canvas/types.js';
import {
  classifyAssignment,
  isInBucket,
  sortAssignments,
} from '../src/domain/assignments.js';

const now = new Date('2026-08-14T00:00:00Z');

function assignment(
  overrides: Partial<CanvasAssignment> = {},
): CanvasAssignment {
  return { id: 1, course_id: 7, name: 'Essay', ...overrides };
}

describe('assignment buckets', () => {
  it.each([
    {
      name: 'a future unsubmitted assignment',
      value: assignment({ due_at: '2026-08-20T00:00:00Z' }),
      expected: { upcoming: true, overdue: false, past: false, all: true },
      expectedClassification: 'upcoming',
    },
    {
      name: 'a future graded assignment',
      value: assignment({
        due_at: '2026-08-20T00:00:00Z',
        submission: { workflow_state: 'graded' },
      }),
      expected: { upcoming: false, overdue: false, past: false, all: true },
      expectedClassification: 'all',
    },
    {
      name: 'a past unsubmitted assignment',
      value: assignment({ due_at: '2026-08-10T00:00:00Z' }),
      expected: { upcoming: false, overdue: true, past: true, all: true },
      expectedClassification: 'overdue',
    },
    {
      name: 'a past submitted assignment',
      value: assignment({
        due_at: '2026-08-10T00:00:00Z',
        submission: { workflow_state: 'submitted' },
      }),
      expected: { upcoming: false, overdue: false, past: true, all: true },
      expectedClassification: 'past',
    },
    {
      name: 'a past graded assignment',
      value: assignment({
        due_at: '2026-08-10T00:00:00Z',
        submission: { workflow_state: 'graded' },
      }),
      expected: { upcoming: false, overdue: false, past: true, all: true },
      expectedClassification: 'past',
    },
    {
      name: 'an excused assignment',
      value: assignment({
        due_at: '2026-08-10T00:00:00Z',
        submission: { excused: true },
      }),
      expected: { upcoming: false, overdue: false, past: true, all: true },
      expectedClassification: 'past',
    },
    {
      name: 'a past non-submittable assignment',
      value: assignment({
        due_at: '2026-08-10T00:00:00Z',
        submission_types: ['none'],
      }),
      expected: { upcoming: false, overdue: false, past: true, all: true },
      expectedClassification: 'past',
    },
    {
      name: 'an assignment without a due date',
      value: assignment(),
      expected: { upcoming: false, overdue: false, past: false, all: true },
      expectedClassification: 'all',
    },
  ] as const)(
    'places $name in the correct buckets',
    ({ value, expected, expectedClassification }) => {
      expect(isInBucket(value, 'upcoming', now)).toBe(expected.upcoming);
      expect(isInBucket(value, 'overdue', now)).toBe(expected.overdue);
      expect(isInBucket(value, 'past', now)).toBe(expected.past);
      expect(isInBucket(value, 'all', now)).toBe(expected.all);
      expect(classifyAssignment(value, now)).toBe(expectedClassification);
    },
  );

  it('sorts dated assignments chronologically and leaves undated assignments last', () => {
    const undated = assignment({ id: 1 });
    const later = assignment({ id: 2, due_at: '2026-08-20T00:00:00Z' });
    const earlier = assignment({ id: 3, due_at: '2026-08-10T00:00:00Z' });
    const assignments = [undated, later, earlier];

    expect(sortAssignments(assignments).map(({ id }) => id)).toEqual([3, 2, 1]);
    expect(assignments.map(({ id }) => id)).toEqual([1, 2, 3]);
  });
});
