# Changelog

## 1.0.0

First release.

- Right-click a session in the workspace sidebar and choose
  **删除会话并移入回收站** / **Delete session and move to trash**. The session
  is archived through the host's own durable write and its stored directory
  moves into `<DSH_HOME>/session-purge/trash/`.
- A **🗑 Trash** button at the foot of the left sidebar opens a panel listing
  every deleted session with its size and deletion time.
- **Restore** puts a session back: its files move to their original location
  and the archive write that hid it is undone.
- **Delete permanently** hands a session to the operating system's own Trash
  (`~/.Trash` on macOS), so the file manager can still recover it.
- **Empty trash** does the same for every entry, behind a second click.
- **Batch selection**: tick rows or use *Select all*, then restore or delete
  the selection in one go.
- **Retention**: entries older than the chosen window (never, 1, 7, 14, 30, 90,
  180 or 365 days) expire on their own and move to the system Trash.
- A **refresh button** beside the workspace search control re-pulls the session
  list, so a changed session shows up without restarting DSH.
