# Easier student setup and connection diagnostics

Continue the authorised small student upgrades on the existing isolated branch, after the document-reading commit. Build on the user's unfinished Claude Desktop extension manifest and packaging script by copying them into this branch; leave the original checkout untouched.

Deliverables:

- A `--help` command and a `--doctor` connection check, with optional `--json` output. Validate configuration before making a read-only request for one active course. Explain missing settings, rejected credentials, denied permissions, rate limits, network/timeouts and unexpected responses. Never print the token, raw response bodies, user/course names or raw exceptions. Exit zero on success and nonzero on failure. No arguments continues to start the MCP server without unsolicited stdout output.
- A Claude Desktop `.mcpb` installer built from the upgraded runtime with required Canvas URL and sensitive token form fields. Assemble only manifest, runtime files, README/LICENSE and locked production dependencies in a temporary staging directory; validate and pack with the official MCPB CLI. Clean staging on success/failure. Build an artifact for this machine's platform/architecture and name it accordingly because PDF extraction has native optional dependencies.
- Short installation and diagnostic guidance for students. Clarify that a connection check confirms Canvas API access, not approval for every course, file or AI client. Keep all existing eleven tools.

Implementation: add `src/diagnostics.ts` and `src/commands.ts`, route explicit commands from `src/index.ts`; extend command/diagnostic tests and the existing serial packed-install smoke test to exercise actual CLI exit codes and the assembled extension. Copy and finish `manifest.json` / `scripts/build-mcpb.mjs`; add the official packager as a locked development dependency. Keep Node >=20.19.0.

- [x] Write failing diagnostic/command tests and implement the minimal behavior.
- [x] Complete extension packaging and exercise the actual packed server, including a PDF read.
- [x] Update setup guidance, run full tests/lint/typecheck/build, check Node 20.19 compatibility, and review.
- [x] Save a local commit and installer preview. Publishing and editing installed client configurations are separate actions.

Verification: all 207 tests passed on Node 24.15.0, including installed npm and unpacked MCPB diagnostics, help, and PDF/DOCX/PPTX reads. Lint, formatting and typecheck passed; the packaging smoke test builds the runtime and validates the extension with the pinned official packager. Runtime audit reports zero advisories. Independent review found no material issues.

Compatibility: all 29 diagnostics/configuration and packaged-install tests passed on Node 20.19.0. Built the 21 MB darwin-arm64 installer preview under `output/canvas-student-upgrade`, alongside a short installation guide and refreshed npm archive.

Implementation decisions: the first installer targets macOS Apple Silicon; the builder stamps the actual host platform and architecture. A query string or fragment in a Canvas base URL now fails validation rather than being silently discarded. The installer does not configure a real token or change a user's installed AI client. Claude Desktop UI installation remains untested and is documented as such. Four existing development-tool advisories and six development-tool advisories introduced transitively by the official packager are outside the shipped runtime.
