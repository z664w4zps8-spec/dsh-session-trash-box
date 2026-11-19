# Session trash

Adds two things to the DeepSeek Harness workspace sidebar.

1. A **delete** action on every session row: right-click a session and choose
   **删除会话并移入回收站** / **Delete session and move to trash**.
2. A **trash** entry at the foot of the left sidebar, next to Settings, that
   lists every deleted session and can restore, delete, batch, or empty them.

A third, smaller control sits beside the workspace search button: a refresh
that re-pulls the session list.

## Deleting a session

1. Right-click a session in the workspace sidebar and choose the trash action.
2. The Host archives the session with the same durable write the built-in
   **归档** action performs, so the session leaves the sidebar and any running
   work is stopped. The Client then refreshes its own session list, so the row
   disappears immediately.
3. The Host then moves the session's stored directory out of the session store
   and into the trash:

   ```
   <DSH_HOME>/session-purge/trash/<trashId>/        the session's own files
   <DSH_HOME>/session-purge/trash/<trashId>.json    the trash record
   <DSH_HOME>/session-purge/trash/.settings.json    the retention window
   ```

   The record keeps the session id, title, working directory, original path,
   byte size, and deletion time, in the same shape the retired session-purge
   plugin left behind, so older trash entries are listed too.

The action is offered only for a session that is neither archived nor already
in the trash: a session with no stored files left has nothing to move, and
deleting it again would only create a second, empty entry. A session that is
already in the trash keeps its original entry.

## The trash list

The sidebar foot button shows the number of trashed sessions. Opening it
lists each one with its size and deletion time:

- **恢复 / Restore** puts the session back: its files move to their original
  location and the archive write that hid it is undone, so it reappears in the
  sidebar.
- **彻底删除 / Delete permanently** hands the session to the operating
  system's own Trash (`~/.Trash` on macOS), so Finder can still recover it.
- **清空回收站 / Empty trash** does the same for every entry at once; it asks
  for a second click to confirm.
- **批量 / Batch** ticks rows (or selects all) and restores or deletes the
  selection in one go.
- **保留期 / Retention** sets how long an entry stays before it expires on its
  own. `永不` / `Never` turns expiry off. Expired entries move to the system
  Trash like a permanent delete, so they are still recoverable there.

An entry whose session never had stored files carries no directory: deleting
it only removes the record, and it never blocks the rest of the operation.

Only sessions deleted through this plugin's action are collected. The built-in
**归档** action still only archives.

## Refreshing the list

The refresh button beside the workspace search control re-pulls the session
list from the Host. A session whose files changed on disk — or one removed by
another tool — shows up without restarting DSH.

## Limitations

- Session persistence ships no deletion API, so the file move is an
  out-of-band operation performed by this plugin's Host half. Moving the
  directory does not rewrite the session index; a session that is opened again
  after being restored starts from an empty log until the backend materializes
  it again.
- Only the session's own storage directory is moved. Workspace membership,
  the archived set, and any deliverables produced by the session are untouched.
- A session can only be restored while its stored directory still exists; an
  entry whose files were removed elsewhere is listed but cannot be restored.
- The retention window is enforced when the trash is listed and by an hourly
  sweep, so an entry can sit at most an hour past its window.
