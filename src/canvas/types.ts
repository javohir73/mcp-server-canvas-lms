export interface CanvasCourse {
  readonly id: number;
  readonly name: string;
  readonly course_code?: string;
  readonly workflow_state?: string;
  readonly syllabus_body?: string | null;
  readonly html_url?: string;
  readonly term?: { readonly name?: string } | null;
  readonly enrollments?: readonly CanvasEnrollment[];
  readonly total_scores?: unknown;
}

export interface CanvasEnrollment {
  readonly id?: number;
  readonly course_id?: number;
  readonly user_id?: number;
  readonly type?: string;
  readonly role?: string;
  readonly enrollment_state?: string;
  readonly current_score?: number | null;
  readonly current_grade?: string | null;
  readonly computed_current_score?: number | null;
  readonly computed_current_grade?: string | null;
  readonly final_score?: number | null;
  readonly final_grade?: string | null;
  readonly grades?: unknown;
}

export interface CanvasAssignment {
  readonly id: number;
  readonly course_id: number;
  readonly name: string;
  readonly description?: string | null;
  readonly due_at?: string | null;
  readonly unlock_at?: string | null;
  readonly lock_at?: string | null;
  readonly html_url?: string;
  readonly points_possible?: number | null;
  readonly submission_types?: readonly string[];
  readonly submission?: CanvasSubmission | null;
  readonly rubric?: readonly CanvasRubricCriterion[];
}

export interface CanvasSubmission {
  readonly id?: number;
  readonly workflow_state?: string;
  readonly submitted_at?: string | null;
  readonly graded_at?: string | null;
  readonly grade?: string | null;
  readonly score?: number | null;
  readonly excused?: boolean;
  readonly late?: boolean;
  readonly missing?: boolean;
  readonly attempt?: number | null;
  readonly body?: string | null;
  readonly url?: string | null;
  readonly submission_comments?: readonly CanvasSubmissionComment[];
  readonly rubric_assessment?: Readonly<Record<string, CanvasRubricAssessment>>;
}

export interface CanvasAnnouncement {
  readonly id: number;
  readonly title?: string;
  readonly message?: string | null;
  readonly posted_at?: string | null;
  readonly delayed_post_at?: string | null;
  readonly html_url?: string;
  readonly author?: unknown;
}

export interface CanvasModule {
  readonly id: number;
  readonly name?: string;
  readonly position?: number;
  readonly unlock_at?: string | null;
  readonly state?: string;
  readonly items?: readonly CanvasModuleItem[];
}

export interface CanvasModuleItem {
  readonly id: number;
  readonly module_id?: number;
  readonly type?: string;
  readonly title?: string;
  readonly position?: number;
  readonly html_url?: string;
  readonly page_url?: string;
  readonly content_id?: number;
  readonly url?: string;
  readonly completion_requirement?: CanvasModuleCompletionRequirement | null;
  readonly content_details?: CanvasModuleItemContentDetails | null;
  readonly locked_for_user?: boolean;
}

export interface CanvasModuleCompletionRequirement {
  readonly type?: string;
  readonly min_score?: number | null;
  readonly completed?: boolean;
}

export interface CanvasModuleItemContentDetails {
  readonly locked_for_user?: boolean;
  readonly lock_explanation?: string | null;
}

export interface CanvasPage {
  readonly page_id?: number;
  readonly url: string;
  readonly title?: string;
  readonly body?: string | null;
  readonly updated_at?: string | null;
  readonly html_url?: string;
}

export interface CanvasFile {
  readonly id: number;
  readonly display_name?: string;
  readonly filename?: string;
  readonly content_type?: string;
  readonly url?: string;
  readonly preview_url?: string;
  readonly size?: number;
  readonly created_at?: string | null;
  readonly updated_at?: string | null;
  readonly folder?: unknown;
}

export interface CanvasRubricCriterion {
  readonly id: string;
  readonly description?: string;
  readonly long_description?: string | null;
  readonly points?: number | null;
  readonly ratings?: readonly CanvasRubricRating[];
}

export interface CanvasRubricRating {
  readonly id?: string;
  readonly description?: string;
  readonly points?: number | null;
}

export interface CanvasRubricAssessment {
  readonly points?: number | null;
  readonly rating_id?: string | null;
  readonly comments?: string | null;
}

export interface CanvasSubmissionComment {
  readonly id?: number;
  readonly author_name?: string;
  readonly comment?: string | null;
  readonly created_at?: string | null;
  readonly author?: unknown;
}
