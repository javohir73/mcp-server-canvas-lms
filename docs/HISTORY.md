# Local change history

Ask “What changed since my last check?” to use `canvas_check_changes`.
The first successful assignments/announcements check in each active course saves
its baseline. Subsequent checks report changed deadlines, newly seen assignments
and newly seen published announcements with source links. Dates are UTC ISO
values. `limit` accepts 1–100 displayed changes, default 50; omitted changes are
counted and acknowledged in history, so ask for a larger limit before checking
if you need more. Use the source tools to inspect current assignments and news.

This is an on-demand comparison, not continuous monitoring. It does not track
announcement edits, assignment instruction changes, grades or file updates.
If Canvas changes a deadline twice between checks, only the last value is seen.
Announcements are checked back to the previous successful check with a one-day
overlap, at most 30 days; longer gaps have an explicit coverage notice. The tool
checks up to 50 active courses, fetching two endpoints at a time. Pagination
limits or malformed data prevent updating that endpoint's baseline. Inaccessible
or missing resources are never described as deleted.

## What stays on this computer

History contains assignment IDs/names/due dates, announcement IDs and last
successful check times. It does not store your Canvas token, student name,
announcement messages, assignment bodies, grades or document contents. Account
files are named with a hash of the Canvas origin and authenticated user ID, so
separate accounts/institutions do not share history and token rotation works.
Anyone with access to your OS account or backups may still access history.

| OS      | Default directory                                                                                  |
| ------- | -------------------------------------------------------------------------------------------------- |
| macOS   | `~/Library/Application Support/mcp-server-canvas-lms/history`                                      |
| Windows | `%LOCALAPPDATA%\mcp-server-canvas-lms\history`                                                     |
| Linux   | `$XDG_STATE_HOME/mcp-server-canvas-lms/history`, or `~/.local/state/mcp-server-canvas-lms/history` |

Advanced users can set `CANVAS_STATE_DIR` to an absolute private directory in
the server's environment. History is not synced across computers. POSIX files
are created with mode 0600 in a 0700 directory; Windows relies on your account's
directory access controls. Do not select a shared or Git-tracked directory.
Each account file is limited to 8 MiB. If full, back it up and start a fresh
baseline; previous history remains intact on failure.

## Reset or uninstall

Close all Canvas MCP clients. Back up and rename the `history` directory to
start fresh; a new directory is created at the next change check. This resets
all account baselines in that directory. To remove saved history permanently,
delete that directory after closing clients. Uninstalling the extension alone
may leave history behind. Revoking the token in Canvas is separate.

No changes are written to Canvas. Each check does update this local history;
repeating a successful check normally reports no new differences.
