# Changelog

## 1.0.0

First release.

- Right-click a session in the workspace sidebar and choose
  **删除会话并移入回收站** / **Delete session and move to trash**. The session
  is archived through the Host's own archive command and its stored directory
  moves into `<DSH_HOME>/session-purge/trash/`.
- A **🗑 Trash** button at the foot of the left sidebar opens a panel listing
  every deleted session with its size and deletion time.
- **Restore** puts a session back: its files move to their original location
  and the archive write that hid it is undone.
- **Delete permanently** hands a session to the operating system's own Trash
  (`~/.Trash` on macOS, `~/.local/share/Trash` on Linux, the Recycle Bin on
  Windows), so the file manager can still recover it.
- **Empty trash** does the same for every entry, behind a second click.
- **Batch selection**: tick rows or use *Select all*, then restore or delete
  the selection in one go.
- **Retention**: entries older than the chosen window (never, 1, 7, 14, 30, 90,
  180 or 365 days) expire on their own and move to the system Trash.
- A **refresh button** beside the workspace search control re-pulls the session
  list, re-reads the Host's archive set, and clears the rows whose session
  files are gone, so a changed session shows up without restarting DSH.

### Notes on the archive set

The archive set is the one piece of workspace state a client does not receive
by push: it arrives in the reply of the Host's own archive command. The
plugin therefore archives and unarchives through those commands rather than
writing the registry directly, and a session whose files are gone — which the
Host cannot archive at all — is folded into the client's own archive set, so
its row leaves the list either way.
