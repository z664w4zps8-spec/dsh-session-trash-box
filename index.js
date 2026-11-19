/**
 * Host half of the session-trash bundle.
 *
 * Session persistence ships no deletion API, so this plugin owns the one
 * out-of-band operation a user can ask for: archive the Session (the same
 * durable write the GUI's own "archive" action performs) and move its stored
 * directory into the trash instead of leaving it in place. The trash is then a
 * listable holding area that can restore a Session, delete one entry, hand
 * every remaining entry to the operating system's own Trash, and expire old
 * entries on its own.
 */
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'

/** Host services this plugin needs. */
export const inject = ['connection', 'sessionPersistence', 'workspaceRegistry']

/** Exact Fetch routes served by the Host half; exact routes live under the /api channel. */
const ROUTES = {
  list: '/api/session-trash/list',
  purge: '/api/session-trash/purge',
  restore: '/api/session-trash/restore',
  delete: '/api/session-trash/delete',
  clear: '/api/session-trash/clear',
  batch: '/api/session-trash/batch',
  settings: '/api/session-trash/settings',
  sweep: '/api/session-trash/sweep',
}

/** Only a well-formed Session identity may reach the filesystem. */
const SESSION_ID = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Only a well-formed trash identity may reach the filesystem. */
const TRASH_ID = /^t-[0-9TZ]+-[0-9a-f]+$/

/** Default retention: entries older than this many days expire on their own. */
const DEFAULT_RETENTION_DAYS = 30

/** Retention choices the Client offers; 0 means "never expire". */
const RETENTION_CHOICES = [0, 1, 7, 14, 30, 90, 180, 365]

/** How often the Host looks for expired entries, in minutes. */
const SWEEP_INTERVAL_MINUTES = 60

/**
 * Answer one request with a JSON body.
 * @param body - JSON-serializable payload.
 * @param status - HTTP status.
 * @returns the JSON response.
 */
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/**
 * Trash identity: a sortable timestamp plus random entropy, matching the
 * records the retired session-purge plugin left behind.
 * @returns the trash id.
 */
function trashId() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  return `t-${stamp}-${randomBytes(4).toString('hex')}`
}

/**
 * Resolve the Harness data root the same way the shipped helper does: an
 * explicit environment value wins, then the default under the user home.
 * @returns the absolute Harness home directory.
 */
function dshHome() {
  const configured = process.env.DSH_HOME?.trim()
  if (configured !== undefined && configured !== '') return configured
  return join(homedir(), '.dsh')
}

/**
 * The directory holding trashed sessions.
 * @returns the absolute trash root.
 */
function trashRoot() {
  return join(dshHome(), 'session-purge', 'trash')
}

/**
 * The file holding this plugin's own settings.
 * @returns the absolute settings path.
 */
function settingsPath() {
  return join(trashRoot(), '.settings.json')
}

/**
 * Read the plugin's settings, falling back to the defaults.
 * @returns the stored settings.
 */
async function readSettings() {
  try {
    const parsed = JSON.parse(await readFile(settingsPath(), 'utf8'))
    const days = Number(parsed?.retentionDays)
    return {
      retentionDays: RETENTION_CHOICES.includes(days) ? days : DEFAULT_RETENTION_DAYS,
    }
  } catch {
    return { retentionDays: DEFAULT_RETENTION_DAYS }
  }
}

/**
 * Write the plugin's settings.
 * @param settings - the settings to store.
 * @returns the stored settings.
 */
async function writeSettings(settings) {
  await mkdir(trashRoot(), { recursive: true })
  await writeFile(settingsPath(), `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
  return settings
}

/**
 * Total size of a directory tree one level deep.
 * @param dir - directory to measure.
 * @returns the summed byte size.
 */
async function directorySize(dir) {
  let total = 0
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    try {
      const info = await stat(path)
      total += info.isDirectory() ? 0 : info.size
    } catch {
      // A file that vanished mid-measurement contributes nothing.
    }
  }
  return total
}

/**
 * Move a directory, falling back to copy-and-remove across devices.
 * @param from - source directory.
 * @param to - destination directory.
 */
async function moveDirectory(from, to) {
  try {
    await rename(from, to)
  } catch (error) {
    if (error?.code !== 'EXDEV') throw error
    await cp(from, to, { recursive: true, force: true })
    await rm(from, { recursive: true, force: true })
  }
}

/**
 * Read every trash record, newest first, one entry per Session.
 *
 * A Session can be trashed twice: the first move carries its files, a second
 * one finds nothing left to move. The entry that still owns the files wins,
 * so the list shows one row per Session and keeps the files reachable.
 * @returns the parsed records.
 */
async function readRecords() {
  const root = trashRoot()
  let entries = []
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const records = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json') || entry.name === '.settings.json') continue
    try {
      const parsed = JSON.parse(await readFile(join(root, entry.name), 'utf8'))
      if (typeof parsed?.trashId !== 'string') continue
      records.push(parsed)
    } catch {
      // A record that cannot be read is skipped; its directory stays on disk.
    }
  }
  records.sort((a, b) => String(b.deletedAt ?? '').localeCompare(String(a.deletedAt ?? '')))
  const bySession = new Map()
  for (const record of records) {
    const key = typeof record.id === 'string' ? record.id : record.trashId
    const held = bySession.get(key)
    if (held === undefined) {
      bySession.set(key, record)
      continue
    }
    const heldHasFiles = typeof held.originalDir === 'string' && held.originalDir !== ''
    const recordHasFiles = typeof record.originalDir === 'string' && record.originalDir !== ''
    if (recordHasFiles && !heldHasFiles) bySession.set(key, record)
  }
  return [...bySession.values()]
}

/**
 * Remove every other record that belongs to the same Session.
 * @param id - trash identity being acted on.
 * @param sessionId - Session identity the record belongs to.
 */
async function removeSiblingRecords(id, sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') return
  const root = trashRoot()
  let entries = []
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    const path = join(root, entry.name)
    if (path === join(root, `${id}.json`)) continue
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8'))
      if (parsed?.id === sessionId) await rm(path, { force: true })
    } catch {
      // A record that cannot be read is left alone.
    }
  }
}

/**
 * Whether one record has outlived the retention window.
 * @param record - stored trash record.
 * @param retentionDays - retention window in days; 0 never expires.
 * @returns true when the entry is due for expiry.
 */
function isExpired(record, retentionDays) {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return false
  const deletedAt = Date.parse(String(record.deletedAt ?? ''))
  if (Number.isNaN(deletedAt)) return false
  return Date.now() - deletedAt > retentionDays * 24 * 60 * 60 * 1000
}

/**
 * One record's public shape for the Client.
 * @param record - stored trash record.
 * @param retentionDays - retention window in days.
 * @returns the view the Client renders.
 */
function recordView(record, retentionDays) {
  return {
    trashId: record.trashId,
    id: record.id,
    title: typeof record.title === 'string' && record.title !== '' ? record.title : record.id,
    cwd: typeof record.cwd === 'string' ? record.cwd : null,
    sizeBytes: typeof record.sizeBytes === 'number' ? record.sizeBytes : 0,
    deletedAt: typeof record.deletedAt === 'string' ? record.deletedAt : null,
    restorable: typeof record.originalDir === 'string' && record.originalDir !== '',
    expired: isExpired(record, retentionDays),
  }
}

/**
 * Move one Session's stored directory into the trash and archive the Session.
 * @param ctx - plugin context owning persistence, the registry, and the logger.
 * @param sessionId - identity of the Session to trash.
 * @param title - title shown in the trash record.
 * @returns the trash record summary.
 */
async function purge(ctx, sessionId, title) {
  // A Session that is already in the trash keeps its entry: deleting it a
  // second time must not create a second record for the same Session.
  const existing = (await readRecords()).find(record => record.id === sessionId)
  if (existing !== undefined) {
    return {
      ok: true,
      trashId: existing.trashId,
      alreadyTrashed: true,
      moved: false,
      archived: true,
      sizeBytes: typeof existing.sizeBytes === 'number' ? existing.sizeBytes : 0,
    }
  }

  const snapshot = await ctx.sessionPersistence.stat(sessionId).catch(() => undefined)
  const artifact = snapshot?.location?.path
  const sessionDir = artifact ? dirname(artifact) : undefined

  // The stored directory is named after the Session; anything else is not ours.
  if (sessionDir !== undefined && basename(sessionDir) !== sessionId) {
    throw new Error(`stored directory ${basename(sessionDir)} does not match ${sessionId}`)
  }
  const cwd = snapshot?.header?.cwd
  const sessionsRoot = sessionDir === undefined ? undefined : dirname(dirname(sessionDir))
  const wasArchived = ctx.workspaceRegistry.archivedSessionIds.includes(sessionId)

  const root = trashRoot()
  await mkdir(root, { recursive: true })

  const id = trashId()
  const trashDir = join(root, id)
  const sizeBytes = sessionDir === undefined ? 0 : await directorySize(sessionDir)
  let moved = false
  if (sessionDir !== undefined) {
    await moveDirectory(sessionDir, trashDir)
    moved = true
  }

  // Archive the Session: the durable archive set hides it from the sidebar and
  // blocks every later wake. An already archived Session resolves without
  // writing, which is why the Client also refreshes its own list afterwards.
  await ctx.workspaceRegistry.archiveSession(sessionId, { stopActivity: true })

  const record = {
    schema: 1,
    trashId: id,
    id: sessionId,
    title: typeof title === 'string' && title.trim() !== '' ? title.trim() : sessionId,
    cwd: cwd ?? null,
    originalDir: sessionDir ?? null,
    sessionsRoot: sessionsRoot ?? null,
    deletedAt: new Date().toISOString(),
    sizeBytes,
    wasArchived,
    hasFiles: moved,
    status: 'trashed',
    trashedBy: 'dsh-session-trash',
  }
  await writeFile(join(root, `${id}.json`), `${JSON.stringify(record, null, 2)}\n`, 'utf8')

  return { ok: true, trashId: id, path: trashDir, sizeBytes, moved, archived: true }
}

/**
 * Put one trashed Session back where it came from.
 * @param ctx - plugin context owning the registry.
 * @param id - trash identity to restore.
 * @returns the restored record.
 */
async function restore(ctx, id) {
  const root = trashRoot()
  const recordPath = join(root, `${id}.json`)
  const record = JSON.parse(await readFile(recordPath, 'utf8'))
  const trashDir = join(root, id)
  const originalDir = record.originalDir
  if (typeof originalDir !== 'string' || originalDir === '') {
    throw new Error('this trash entry has no original directory')
  }
  // The stored directory is named after the Session; a record whose target is
  // named otherwise is not ours to write into.
  if (typeof record.id === 'string' && record.id !== '' && basename(originalDir) !== record.id) {
    throw new Error('the trash record does not match its original directory')
  }
  await mkdir(dirname(originalDir), { recursive: true })
  // A directory already sitting there is a stale re-creation of the same
  // Session; the trashed history replaces it.
  await rm(originalDir, { recursive: true, force: true })
  await moveDirectory(trashDir, originalDir)
  await rm(recordPath, { force: true })
  await removeSiblingRecords(id, record.id)
  if (typeof record.id === 'string') {
    // The archive write that hid the Session is undone by the same registry.
    await ctx.workspaceRegistry.unarchiveSession(record.id).catch(() => undefined)
  }
  return { ok: true, trashId: id, id: record.id, restored: true }
}

/**
 * The operating system's own trash, so a permanently deleted session can
 * still be recovered from the file manager.
 *
 * macOS keeps the per-user Trash in `~/.Trash`; Linux follows the
 * freedesktop.org spec and uses `~/.local/share/Trash`; Windows has no
 * per-user folder, so its Recycle Bin is reached through the shell. A
 * platform without a usable destination falls back to this plugin's own
 * folder, and the caller is told which one it used.
 * @returns the trash kind and the directory that receives the files.
 */
function systemTrashTarget() {
  if (process.platform === 'darwin') return { kind: 'macos', dir: join(homedir(), '.Trash') }
  if (process.platform === 'linux') {
    return { kind: 'linux', dir: join(homedir(), '.local', 'share', 'Trash', 'files') }
  }
  if (process.platform === 'win32') return { kind: 'windows', dir: null }
  return { kind: 'fallback', dir: join(dshHome(), 'session-purge', 'os-trash') }
}

/**
 * Hand one directory to the operating system's own trash.
 *
 * @param dir - the directory to hand over.
 * @param name - the name it should carry there.
 * @returns where it went, and whether the file manager will show it.
 */
async function handToSystemTrash(dir, name) {
  const target = systemTrashTarget()
  if (target.kind === 'windows') {
    // Windows has no per-user trash folder to move into; the shell owns the
    // Recycle Bin, so the move goes through it.
    const script = `$p = ${JSON.stringify(dir)}; Add-Type -AssemblyName Microsoft.VisualBasic; ` +
      `[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, ` +
      `'OnlyErrorDialogs', 'SendToRecycleBin')`
    const { spawn } = await import('node:child_process')
    const ok = await new Promise((resolve) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'ignore' })
      child.on('error', () => resolve(false))
      child.on('exit', code => resolve(code === 0))
    })
    if (ok) return { kind: 'windows', path: dir, visible: true }
    // The shell refused it; the files still have to land somewhere.
    const fallback = join(dshHome(), 'session-purge', 'os-trash')
    await mkdir(fallback, { recursive: true })
    await moveDirectory(dir, join(fallback, name))
    return { kind: 'fallback', path: join(fallback, name), visible: false }
  }

  await mkdir(target.dir, { recursive: true })
  let destination = join(target.dir, name)
  let suffix = 1
  while (await stat(destination).then(() => true, () => false)) {
    suffix += 1
    destination = join(target.dir, `${name} ${suffix}`)
  }
  await moveDirectory(dir, destination)

  if (target.kind === 'linux') {
    // The freedesktop.org spec wants a .trashinfo file beside the payload or
    // the file manager treats the entry as a plain file it may clean up.
    const infoDir = join(dirname(target.dir), 'info')
    await mkdir(infoDir, { recursive: true })
    const when = new Date().toISOString().replace(/[:]/g, '-')
    await writeFile(join(infoDir, `${basename(destination)}.trashinfo`),
      `[Trash Info]\nPath=${destination}\nDeletionDate=${when}\n`, 'utf8')
  }
  return { kind: target.kind, path: destination, visible: true }
}

/**
 * Hand one trashed Session to the operating system's own Trash.
 *
 * A trash entry without a stored directory is an entry whose Session never
 * had files to move; it leaves the list without touching the file system.
 * @param id - trash identity to delete.
 * @returns the deletion summary.
 */
async function deleteEntry(id) {
  const root = trashRoot()
  const recordPath = join(root, `${id}.json`)
  const trashDir = join(root, id)
  const record = JSON.parse(await readFile(recordPath, 'utf8'))

  const hasFiles = await stat(trashDir).then(info => info.isDirectory(), () => false)
  let target = null
  let visible = false
  if (hasFiles) {
    // The record travels with the files so the system Trash keeps its history.
    await writeFile(join(trashDir, '.dsh-session-trash.json'), `${JSON.stringify(record, null, 2)}\n`, 'utf8')
    const base = typeof record.id === 'string' && record.id !== '' ? record.id : id
    const handed = await handToSystemTrash(trashDir, base)
    target = handed.path
    visible = handed.visible
  }
  await rm(recordPath, { force: true })
  await removeSiblingRecords(id, record.id)
  return { ok: true, trashId: id, path: target, moved: hasFiles, visibleInFileManager: visible, deleted: true }
}

/**
 * Hand every trashed Session to the operating system's own Trash.
 *
 * One entry that cannot move does not stop the others; the failures are
 * reported so the Client can tell the user what stayed behind.
 * @returns the deletion summary.
 */
async function clearAll() {
  const records = await readRecords()
  const deleted = []
  const failed = []
  for (const record of records) {
    try {
      await deleteEntry(record.trashId)
      deleted.push(record.trashId)
    } catch (error) {
      failed.push({ trashId: record.trashId, error: String(error?.message ?? error) })
    }
  }
  return { ok: failed.length === 0, deleted, failed }
}

/**
 * Run one batch operation over many trash entries.
 * @param ctx - plugin context owning the registry.
 * @param action - "restore" or "delete".
 * @param ids - trash identities to act on.
 * @returns the batch summary.
 */
async function batch(ctx, action, ids) {
  const done = []
  const failed = []
  for (const id of ids) {
    try {
      if (action === 'restore') await restore(ctx, id)
      else await deleteEntry(id)
      done.push(id)
    } catch (error) {
      failed.push({ trashId: id, error: String(error?.message ?? error) })
    }
  }
  return { ok: failed.length === 0, done, failed }
}

/**
 * Expire every entry that outlived the retention window.
 * @returns the sweep summary.
 */
async function sweep() {
  const { retentionDays } = await readSettings()
  if (retentionDays <= 0) return { ok: true, expired: [], retentionDays }
  const records = await readRecords()
  const expired = []
  const failed = []
  for (const record of records) {
    if (!isExpired(record, retentionDays)) continue
    try {
      await deleteEntry(record.trashId)
      expired.push(record.trashId)
    } catch (error) {
      failed.push({ trashId: record.trashId, error: String(error?.message ?? error) })
    }
  }
  return { ok: failed.length === 0, expired, failed, retentionDays }
}

/**
 * Register one exact Fetch route.
 * @param ctx - plugin context.
 * @param path - route path.
 * @param handler - request handler returning the JSON body.
 */
function route(ctx, path, handler) {
  ctx.effect(() => ctx.connection.fetch.register({
    path,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      let input = {}
      try {
        input = await request.json()
      } catch {
        return json({ error: 'invalid-json' }, 400)
      }
      try {
        return json(await handler(input))
      } catch (error) {
        ctx.logger?.warn?.('session-trash: %s failed: %s', path, String(error?.message ?? error))
        return json({ error: String(error?.message ?? error) }, 500)
      }
    },
  }), `session-trash: ${path}`)
}

/**
 * Read one trash identity from a request body.
 * @param input - the request body.
 * @returns the validated identity.
 */
function trashIdOf(input) {
  const id = typeof input?.trashId === 'string' ? input.trashId.trim() : ''
  if (!TRASH_ID.test(id)) throw new Error('invalid-trash-id')
  return id
}

/**
 * Mount the trash routes on the Host connection.
 * @param ctx - plugin context.
 */
export function apply(ctx) {
  ctx.effect(() => ctx.connection.fetch.register({
    path: ROUTES.list,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => {
      const settings = await readSettings()
      // Listing is the cheapest moment to notice entries that have aged out.
      await sweep().catch(() => undefined)
      const records = await readRecords()
      return json({
        ok: true,
        items: records.map(record => recordView(record, settings.retentionDays)),
        retentionDays: settings.retentionDays,
        retentionChoices: RETENTION_CHOICES,
      })
    },
  }), `session-trash: ${ROUTES.list}`)

  route(ctx, ROUTES.purge, async (input) => {
    const sessionId = typeof input?.sessionId === 'string' ? input.sessionId.trim() : ''
    if (!SESSION_ID.test(sessionId)) throw new Error('invalid-session-id')
    return purge(ctx, sessionId, input?.title)
  })

  route(ctx, ROUTES.restore, async (input) => restore(ctx, trashIdOf(input)))

  route(ctx, ROUTES.delete, async (input) => deleteEntry(trashIdOf(input)))

  route(ctx, ROUTES.clear, async () => clearAll())

  route(ctx, ROUTES.batch, async (input) => {
    const action = input?.action === 'restore' ? 'restore' : input?.action === 'delete' ? 'delete' : undefined
    if (action === undefined) throw new Error('invalid-action')
    const ids = Array.isArray(input?.trashIds) ? input.trashIds : []
    // An identity the filesystem may not touch is reported, never dropped:
    // a silent no-op would look like a successful batch.
    const valid = []
    const failed = []
    for (const id of ids) {
      if (typeof id === 'string' && TRASH_ID.test(id)) valid.push(id)
      else failed.push({ trashId: String(id), error: 'invalid-trash-id' })
    }
    const result = await batch(ctx, action, valid)
    return { ...result, ok: result.failed.length === 0 && failed.length === 0, failed: [...failed, ...result.failed] }
  })

  route(ctx, ROUTES.settings, async (input) => {
    const days = Number(input?.retentionDays)
    if (!RETENTION_CHOICES.includes(days)) throw new Error('invalid-retention-days')
    return { ok: true, ...(await writeSettings({ retentionDays: days })) }
  })

  route(ctx, ROUTES.sweep, async () => sweep())

  // A periodic sweep keeps the retention window honest even when nobody
  // opens the panel; the interval ends with the plugin's own lifetime.
  ctx.effect(() => {
    const timer = setInterval(() => { void sweep().catch(() => undefined) }, SWEEP_INTERVAL_MINUTES * 60 * 1000)
    timer.unref?.()
    return () => clearInterval(timer)
  }, 'session-trash: retention sweep')
}
