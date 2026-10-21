# Release checklist

Candidate: `0.2.0-preview.2`. Nothing in a feature-branch push publishes to npm.

1. Review and merge the upgrade pull request after CI and all three native
   installer jobs pass. Download each workflow artifact and confirm its expected
   platform/architecture; checksums are included. Automated tests exercise the
   actual packed npm server and unpacked desktop bundle with synthetic data.
2. Complete a real Claude Desktop installation on a matching computer before
   recommending broad rollout. Ask a small student group to try connecting their
   own Canvas account, listing courses, reading a brief, getting a weekly overview
   and checking changes twice. No private student data should be posted to GitHub.
3. Check the npm package's trusted publisher settings: repository
   `javohir73/mcp-server-canvas-lms`, workflow **`release.yml`**, permitted publish
   action, and matching GitHub environment if one is required. Do not add a
   long-lived token to the workflow. Local `npm whoami` is independent of GitHub
   OIDC; the existing local session currently needs reauthentication.
4. Obtain maintainer approval to publish the reviewed release. Then tag the
   approved commit `v0.2.0-preview.2` and push that tag. This triggers native
   installer builds, verification and npm publishing with provenance.
   `npm run release:publish` requires the matching tag and chooses npm dist-tag
   **`preview`** for prereleases, preserving `latest` (currently `0.1.0`).
5. The workflow creates a **draft** GitHub release with the three installers and
   checksums after npm publishing succeeds. Review its notes, mark this candidate
   as a prerelease, and publish the draft when approved. Replace the candidate
   availability wording in the install guide with actual release status.
6. Confirm the exact npm version is available, and try the README links while
   signed out. Give friends the GitHub installation page. A package command
   without a version continues to select npm's stable `latest`; use the exact
   candidate version for this trial.

If npm publishing fails, inspect the job error and npm-side publisher settings;
do not create a second version merely to repair authentication. If npm succeeds
but draft-release creation fails, reuse the successfully built artifacts and
create the missing draft without publishing npm again. A release can also be
prepared manually using the tested local tarball, but provenance requirements
and npm authentication must be met.

Primary references: [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
and [GitHub native runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
