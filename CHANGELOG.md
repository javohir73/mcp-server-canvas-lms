# Changes

## 0.2.0-preview.2 — published preview

- Downloadable Claude Desktop installers built and smoke-tested separately for
  Apple Silicon Macs, Intel Macs and Windows x64, with SHA-256 checksums.
- A simpler installation guide, client instructions and connection troubleshooting.
- New `canvas_check_changes`: compare moved/cleared deadlines, newly seen
  assignments and announcements between on-demand checks. First checks seed
  local history; unavailable data preserves its previous baseline.
- Includes the weekly student overview, local PDF/Word/PowerPoint text extraction
  with source references, and token-free connection diagnostics from preview.1.
- Thirteen tools; every Canvas request remains GET-only. Change checks save
  minimal local metadata, with account isolation, locking and atomic replacement.

Published under npm dist-tag `preview`; stable `latest` remains `0.1.0`. Custom desktop
installers need manual updates. Real Claude Desktop UI installation still needs
student testing. Browser Claude/ChatGPT remote connections are not included.
