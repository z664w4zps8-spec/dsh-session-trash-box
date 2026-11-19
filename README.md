# Session trash for DeepSeek Harness

Delete a session into a local trash instead of only archiving it.

The host offers **archive** but no **delete**: an archived session leaves the
sidebar and can be restored, yet its log keeps sitting on disk forever. This
plugin adds the missing half — a right-click action that deletes a session for
real, and a trash where you can undo that, batch it, or let it expire.

## What it does

**Right-click a session** in the workspace sidebar and choose
**删除会话并移入回收站** / **Delete session and move to trash**.

- The session is archived through the same durable write the built-in archive
  action performs, so it leaves the sidebar and any running work is stopped.
- Its stored directory moves into the trash under
  `<DSH_HOME>/session-purge/trash/<trashId>/`, next to a JSON record that keeps
  the session id, title, working directory, original path, byte size, and
  deletion time.
- The sidebar row disappears immediately — no restart needed.

**The trash** opens from the **🗑 Trash** button at the foot of the left
sidebar, next to Settings. It lists every deleted session with its size and
deletion time, and offers:

| Action | What it does |
| --- | --- |
| **Restore** / 恢复 | Puts the session back: its files move to their original location and the archive write that hid it is undone, so it reappears in the sidebar. |
| **Delete permanently** / 彻底删除 | Hands the session to the operating system's own Trash (`~/.Trash` on macOS), so the file manager can still recover it. |
| **Empty trash** / 清空回收站 | Does the same for every entry at once. It asks for a second click to confirm. |
| **Batch** / 批量 | Tick rows (or use *Select all*) and restore or delete the selection in one go. |
| **Retention** / 保留期 | Entries older than the chosen window expire on their own and move to the system Trash. `Never` turns expiry off. |

A **refresh button** sits beside the workspace search control. It re-pulls the
session list, so a session that changed on disk shows up without restarting
DSH.

## Install

From the plugin market, or straight from the sources:

```sh
dsh plugin --profile desktop add z664w4zps8-spec/dsh-session-trash
```

Requires DSH 0.2.2-alpha.3 or newer (the shared context-menu service it
contributes to arrived there) and Node 24+.

## What it does not do

- Session persistence ships no deletion API, so the file move is an
  out-of-band operation performed by this plugin's Host half. Moving the
  directory does not rewrite the session index; a session that is restored
  starts from an empty log until the backend materializes it again.
- Only the session's own storage directory moves. Workspace membership, the
  archived set, and any deliverables the session produced stay where they are.
- Only sessions deleted through this plugin's action are collected. The
  built-in archive action still only archives.
- A session can only be restored while its stored directory still exists; an
  entry whose files were removed elsewhere is listed but cannot be restored.
- The trash has no automatic sweep of its own — the retention window is what
  expires entries, and everything it expires lands in the system Trash first.

## How it is built

The plugin is one package with two halves:

- `index.js` — the Host half. It owns the trash directory, the records, the
  retention window, and five exact Fetch routes under `/api/session-trash/`.
- `client.js` — the browser half. It contributes the context-menu action and
  the trash panel through the shared `contextMenus` service and the frame's
  slots.

The routes are registered through the official `ctx.connection.fetch.register`
seam, so they carry the Host's own peer check: a page that is not the owner
gets a 403 instead of reaching them.

## License

MIT — see [LICENSE](LICENSE).
