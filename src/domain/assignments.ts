import type { CanvasAssignment } from '../canvas/types.js';

export type AssignmentBucket = 'upcoming' | 'overdue' | 'past' | 'all';

export function isInBucket(
  assignment: CanvasAssignment,
  bucket: AssignmentBucket,
  now: Date,
): boolean {
  if (bucket === 'all') return true;
  if (!assignment.due_at) return false;

  const past = new Date(assignment.due_at).getTime() < now.getTime();
  const state = assignment.submission?.workflow_state;
  const complete =
    assignment.submission?.excused === true ||
    state === 'submitted' ||
    state === 'graded';

  if (bucket === 'past') return past;
  if (bucket === 'upcoming') return !past && !complete;

  const requiresSubmission = !assignment.submission_types?.includes('none');
  return past && requiresSubmission && !complete;
}

export function classifyAssignment(
  assignment: CanvasAssignment,
  now: Date,
): AssignmentBucket {
  if (isInBucket(assignment, 'overdue', now)) return 'overdue';
  if (isInBucket(assignment, 'upcoming', now)) return 'upcoming';
  if (isInBucket(assignment, 'past', now)) return 'past';
  return 'all';
}

export function sortAssignments(
  assignments: readonly CanvasAssignment[],
): CanvasAssignment[] {
  return [...assignments].sort((left, right) => dueTime(left) - dueTime(right));
}

function dueTime(assignment: CanvasAssignment): number {
  if (!assignment.due_at) return Number.POSITIVE_INFINITY;
  const timestamp = new Date(assignment.due_at).getTime();
  return Number.isNaN(timestamp) ? Number.POSITIVE_INFINITY : timestamp;
}
