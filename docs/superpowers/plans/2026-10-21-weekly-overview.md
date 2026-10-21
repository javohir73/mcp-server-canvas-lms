# Student weekly overview

Next authorised small upgrade: add `canvas_get_weekly_overview` so a student can ask what to focus on this week without manually combining course, assignment and announcement calls.

Inputs: optional `days_ahead` and `since_days`, each integer 1–30 (default 7); optional `limit`, integer 1–50 (default 10 per section); optional valid IANA `timezone` (default the server timezone). Rolling windows start from one captured current time and are displayed explicitly.

Read active courses, then assignments with the current user's submission and `override_assignment_dates=true`, and published announcements per course in the lookback window. Use paginated GET requests through the existing client. Check at most 50 active courses, clearly disclosing any omitted courses. Collect assignments and announcements independently so one denied endpoint does not hide successful results. Never include raw errors or tokens; fail normally on an authentication error.

Output: upcoming uncompleted deadlines (earliest first), overdue work (latest due first), past deadlines with unknown/offline completion to verify, work without a confirmed due date, and recent announcement previews (newest first). Exclude excused/completed work and non-submission calendar items; a missing grade of zero must not count as a completed submission. Use current-user due dates, preserve unknown status, and do not imply that missing metadata proves work is overdue. Include course names, canonical Canvas links, generated time, timezone, limits/omitted counts and partial-coverage notices. Bound total text to 100,000 characters with an explicit notice. This is an on-demand snapshot, not persistent change tracking or a scheduled reminder.

Implementation: add a focused overview handler and formatter; register the new read-only tool; add necessary Canvas metadata fields; update manifest/tool discovery/security/package smoke tests and README. Rebuild both preview artifacts after verification.

- [x] Add failing tests for boundaries, completion/missing state, unknown/invalid dates, announcements, partial access, limits and validation.
- [x] Implement the overview and register it at the MCP boundary.
- [x] Verify full suite, typecheck, lint, build, actual packaged tool invocation and Node 20.19 compatibility; independent review.
- [x] Save a local commit and refreshed installer/npm previews. No public release or installed-client changes.

Implementation decisions: check three subjects at a time (at most six requests in flight), preserve completed-state overrides for missing work and reassigned submissions, and treat past reassignment dates as needing verification. Stale submitted_at timestamps do not override the current unsubmitted state. Validate malformed metadata and disclose exclusions. Source, MCP server and installer use local preview version 0.2.0-preview.1 so it can be distinguished from the earlier installer; a packed-install regression checks server/package version agreement.

Review found one material omission: Canvas redo_request was being treated as completed work. Two failing regressions reproduced reassignment/stale-timestamp cases; both were fixed and independently verified, with all 21 overview tests passing and no remaining material findings. Full suite before preview versioning: 229 tests passed; final versioned package and Node 20.19 checks follow below.

API references: [assignments and per-user date overrides](https://developerdocs.instructure.com/services/canvas/resources/assignments), [published announcements](https://developerdocs.instructure.com/services/canvas/resources/announcements), [submission metadata](https://developerdocs.instructure.com/services/canvas/resources/submissions).

Final verification: all 229 tests passed on Node 24.15.0; lint and typecheck passed. All 40 overview, protocol-boundary and installed-package tests passed on Node 20.19.0. Both the clean npm installation and unpacked MCPB were exercised through the new tool, with matching manifest/runtime tool lists and package/server versions. Runtime dependency audit: zero advisories. Both preview artifacts are rebuilt from this code; no client configuration or public registry changes.
