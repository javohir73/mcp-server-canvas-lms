# Installation and change tracking

User authorisation: “work on them”, following the installation, distribution,
troubleshooting and change-tracking recommendation. Continue in the existing
isolated worktree; preserve the original checkout. Implement inline with a fresh
final review. Public release publication is a final approval step.

## Scope and decisions

- A prominent GitHub install section explains Claude Desktop versus npm clients
  and browser connectors. Version-specific release assets avoid installing the
  old public release by accident. Provide a troubleshooting guide and Claude
  Code instructions as a secondary route.
- Native GitHub runners build/test Mac arm64, Mac x64 and Windows x64 installers.
  Do not relabel an Apple Silicon bundle or claim UI testing. PR builds produce
  downloadable artifacts; tagged releases attach the same assets and checksums.
- Prepare `0.2.0-preview.2`; prereleases publish under npm's `preview` tag, never
  `latest`. Publishing needs a correctly configured npm trusted publisher.
- `canvas_check_changes` compares deadlines and newly seen published
  announcements on demand. First successful check of each course/endpoint seeds
  its baseline. New assignments after that baseline are reported separately.
- State is local, keyed by Canvas origin and authenticated `/users/self` ID,
  independent of token rotation. Persist minimal IDs, assignment names/dates,
  announcement IDs and check timestamps, never tokens or document/message bodies.
  Default OS-specific application state directory; optional `CANVAS_STATE_DIR`.
- Exclusive per-account lock and atomic replacement prevent lost updates. Invalid
  or unreadable history is reported and never silently replaced. Restrict local
  directory/file permissions on POSIX; Windows uses account directory permissions.
- Failed or malformed endpoint data never advances that baseline. No deletion
  claims. Catch up announcements for at most 30 days and disclose longer gaps.
  Cap 50 courses, 8 MiB state, 50 displayed changes by default, 100,000 output
  characters; disclose omissions. Each displayed change links to Canvas and
  shows previous/current check times. No monitoring or notifications.

## Task 1: Distribution and guides

Read current builder/package integration and release policy. Add regression
coverage for platform-safe package execution and release artifact/prerelease
policy, run to observe failure, then implement native build workflow and versioned
bundle names, guides, troubleshooting and release checklist. Validate the actual
host bundle using existing package smoke tests. Expected: policy tests and
package smoke pass. Avoid tests which merely mirror documentation wording.

## Task 2: Local change tracking

Test first-check baseline, changed/cleared deadlines, new assignments and
announcements, token rotation/account isolation, partial access, invalid metadata,
pagination, concurrent checks, corrupt/unwritable state, bounded output and long
gaps using temporary directories and synthetic Canvas responses. Observe missing
feature failures before implementation. Implement local store and handler; wire
strict MCP input and version/manifest/tool count. Expected: new tests pass and
existing tools remain GET-only and discoverable.

## Task 3: Verification and review

Run lint, typecheck, full tests, runtime audit and Node 20 smoke tests. Build local
preview installer/tarball and verify contents. Fresh reviewer checks branch;
fix material findings with regression tests. Push feature branch/create draft PR
if GitHub access permits, attach PR to chat, run native installer CI and inspect
results. Expected: actual verified artifacts where CI succeeds; clearly report
unavailable platforms or credentials. Do not publish npm or a public GitHub
release until user approves concrete reviewed release.

## Review focus

Native Windows command invocation; accidental npm latest prerelease publishing;
account isolation; partial fetch preserving baselines; corrupted state and lock
contention; private data in archives; snapshot/output bounds; distinguish
automated packaged-server tests from real Claude UI installation.

## Progress

- Baseline: clean branch `codex/student-document-reading` at `363275e`.
- GitHub authentication works outside sandbox; npm local authentication returns
  E401. Existing release uses GitHub OIDC, requiring npm-side trusted publishing.

- Implemented distribution guides, versioned installer/checksums, native runner
  workflow and guarded npm preview publishing; existing stable latest preserved.
- Implemented local change tracking and strict MCP registration (13 tools),
  token rotation/account isolation, partial access preservation, size caps,
  corruption/lock/write errors, and backwards-clock safeguard.
- Verification: full suite 249 tests passed (17 files); Node 20.19 package/server/
  history smoke suite 37 tests passed; lint/typecheck/diff check passed;
  production dependency audit reports zero advisories.
- Review and native GitHub CI pending. No npm/GitHub release publication or
  installed-client configuration changes performed.
