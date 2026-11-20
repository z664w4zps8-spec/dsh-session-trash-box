/**
 * Client half of the session-trash bundle.
 *
 * Contributes one action to the shared session context menu, so the sidebar
 * session row offers "delete and move to trash" next to the built-in actions,
 * and adds a trash entry to the sidebar foot that lists every deleted session
 * with restore, delete, batch, and retention controls. A small refresh button
 * anchored to the workspace section header re-pulls the session list, so a
 * deleted session leaves the sidebar without a restart.
 */
window.__ModuleLoader__.load({
  id: '@z664w4zps8-spec/dsh-session-trash-box',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useRef, useState, useSyncExternalStore } = React

    /** Translate a key of this plugin's dictionary. */
    let t = (key) => key

    /**
     * Bring restored sessions back into the sidebar.
     *
     * The archive set lives on the Host, and a Client only learns it from the
     * reply of the Host's own unarchive command. Unarchiving behind the
     * command's back leaves the row hidden.
     * @param {string[]} sessionIds - the restored sessions.
     */
    let unarchiveRestored = async () => {}

    /**
     * Minimal observable store shared by the sidebar button and the panel.
     * @param {unknown} initial - the first state.
     * @returns the store handle.
     */
    function createStore(initial) {
      let state = initial
      const listeners = new Set()
      return {
        get: () => state,
        set: (patch) => {
          // Every write merges. A function patch computes the fields it
          // knows about; merging keeps the rest, so a background refresh
          // cannot wipe the panel's open flag.
          const next = typeof patch === 'function' ? patch(state) : patch
          state = { ...state, ...next }
          for (const listener of [...listeners]) listener()
        },
        subscribe: (listener) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      }
    }

    const store = createStore({
      open: false,
      items: [],
      selected: [],
      retentionDays: 30,
      retentionChoices: [0, 1, 7, 14, 30, 90, 180, 365],
      confirming: false,
      error: '',
      refreshing: false,
    })

    /** @returns {object} the current store state. */
    const useStore = () => useSyncExternalStore(store.subscribe, store.get, store.get)

    /**
     * Call one Host route and hand back the raw answer.
     * @param {string} path - route path.
     * @param {object} body - request body.
     * @returns {Promise<object>} the route result.
     */
    async function request(path, body) {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      })
      const payload = await response.json().catch(() => undefined)
      if (!response.ok || payload?.ok !== true) throw new Error(payload?.error ?? `HTTP ${response.status}`)
      return payload
    }

    /** Reload the trash list from the Host. */
    async function refresh() {
      try {
        const response = await fetch('/api/session-trash/list', { method: 'GET' })
        const payload = await response.json().catch(() => undefined)
        if (!response.ok || payload?.ok !== true) throw new Error(payload?.error ?? `HTTP ${response.status}`)
        const items = Array.isArray(payload.items) ? payload.items : []
        const live = new Set(items.map(item => item.trashId))
        store.set(state => ({
          items,
          retentionDays: typeof payload.retentionDays === 'number' ? payload.retentionDays : state.retentionDays,
          retentionChoices: Array.isArray(payload.retentionChoices) ? payload.retentionChoices : state.retentionChoices,
          // A selection only survives while its entry does.
          selected: state.selected.filter(id => live.has(id)),
          error: '',
        }))      } catch (error) {
        store.set({ error: String(error?.message ?? error) })
      }
    }

    /**
     * One monochrome glyph.
     * @param {object} props - glyph props.
     * @param {string[]} props.d - path data.
     * @param {number} [props.size] - rendered size in pixels.
     * @returns {object} the SVG element.
     */
    function Glyph({ d, size = 16 }) {
      return h('svg', {
        viewBox: '0 0 16 16',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.4,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
      }, d.map((segment, index) => h('path', { key: index, d: segment })))
    }

    const TRASH_GLYPH = [
      'M2.6 4.4h10.8',
      'M6.1 4.4V3.2a.7.7 0 0 1 .7-.7h2.4a.7.7 0 0 1 .7.7v1.2',
      'M4 4.4l.7 8.7a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9l.7-8.7',
      'M6.7 7v4',
      'M9.3 7v4',
    ]

    const RESTORE_GLYPH = [
      'M2.8 8a5.2 5.2 0 1 0 1.6-3.8',
      'M2.4 2.6v3.2h3.2',
    ]

    const CLOSE_GLYPH = ['M4 4l8 8', 'M12 4l-8 8']

    const REFRESH_GLYPH = [
      'M13.2 6.6a5.4 5.4 0 1 0 .2 2.6',
      'M13.4 3.2v3.6h-3.6',
    ]

    const CHECK_GLYPH = ['M3.4 8.4l3 3 6.2-6.8']

    /**
     * Format a byte count for the list.
     * @param {number} bytes - size in bytes.
     * @returns {string} the formatted size.
     */
    function formatSize(bytes) {
      const value = Number(bytes) || 0
      if (value < 1024) return `${value} B`
      if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
      return `${(value / 1024 / 1024).toFixed(1)} MB`
    }

    /**
     * Format a deletion timestamp for the list.
     * @param {string|null} value - ISO timestamp.
     * @returns {string} the formatted timestamp.
     */
    function formatTime(value) {
      if (typeof value !== 'string' || value === '') return ''
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return ''
      return date.toLocaleString()
    }

    const buttonStyle = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      minHeight: 28,
      padding: '0 8px',
      borderRadius: 'var(--dsw-radius-md)',
      border: '1px solid transparent',
      background: 'transparent',
      color: 'var(--dsw-alias-label-secondary)',
      font: 'inherit',
      fontSize: 12,
      cursor: 'pointer',
    }

    const actionStyle = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      padding: '2px 8px',
      borderRadius: 'var(--dsw-radius-sm)',
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'transparent',
      color: 'var(--dsw-alias-label-secondary)',
      font: 'inherit',
      fontSize: 12,
      cursor: 'pointer',
      whiteSpace: 'nowrap',
    }

    const dangerStyle = {
      ...actionStyle,
      color: 'var(--dsw-alias-state-error-primary)',
      borderColor: 'var(--dsw-alias-border-l2)',
    }

    const checkboxStyle = {
      width: 14,
      height: 14,
      margin: 0,
      flex: 'none',
      accentColor: 'var(--dsw-alias-state-business-primary)',
      cursor: 'pointer',
    }

    /** The sidebar foot button that opens the trash panel. */
    function TrashButton() {
      const state = useStore()
      const count = state.items.length
      return h('button', {
        type: 'button',
        'data-session-trash-button': 'true',
        title: t('trashButton'),
        'aria-label': t('trashButton'),
        onClick: () => {
          const open = store.get().open
          store.set({ open: !open, confirming: false })
          if (!open) void refresh()
        },
        style: buttonStyle,
        onMouseEnter: (event) => { event.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover)' },
        onMouseLeave: (event) => { event.currentTarget.style.background = 'transparent' },
      }, h(Glyph, { d: TRASH_GLYPH, size: 15 }), count > 0
        ? h('span', {
          style: {
            minWidth: 16,
            padding: '0 4px',
            borderRadius: 8,
            background: 'var(--dsw-alias-bg-layer-1)',
            color: 'var(--dsw-alias-label-primary)',
            fontSize: 11,
            textAlign: 'center',
          },
        }, String(count))
        : null)
    }

    /** The trash panel: every deleted session, with restore and delete. */
    function TrashPanel() {
      const state = useStore()
      const panel = useRef(null)

      useEffect(() => {
        if (!state.open) return undefined
        const onPointerDown = (event) => {
          const target = event.target
          if (panel.current?.contains(target)) return
          if (target instanceof Element && target.closest('[data-session-trash-button]')) return
          store.set({ open: false, confirming: false })
        }
        const onKeyDown = (event) => {
          if (event.key === 'Escape') store.set({ open: false, confirming: false })
        }
        document.addEventListener('pointerdown', onPointerDown, true)
        window.addEventListener('keydown', onKeyDown, true)
        return () => {
          document.removeEventListener('pointerdown', onPointerDown, true)
          window.removeEventListener('keydown', onKeyDown, true)
        }
      }, [state.open])

      if (!state.open) return null

      const run = async (operation, body) => {
        try {
          await operation(body)
          await refresh()
          store.set({ error: '' })
        } catch (error) {
          await refresh()
          store.set({ error: String(error?.message ?? error) })
        }
      }

      const selected = state.selected
      const allSelected = state.items.length > 0 && selected.length === state.items.length
      const toggleAll = () => {
        store.set({ selected: allSelected ? [] : state.items.map(item => item.trashId) })
      }
      const toggleOne = (id) => {
        store.set(state => ({
          selected: state.selected.includes(id)
            ? state.selected.filter(item => item !== id)
            : [...state.selected, id],
        }))
      }

      const retentionLabel = (days) => {
        if (days === 0) return t('retention.never')
        return t('retention.days').replace('{n}', String(days))
      }

      return h('div', {
        ref: panel,
        'data-session-trash-panel': 'true',
        style: {
          position: 'fixed',
          left: 12,
          bottom: 12,
          width: 400,
          maxHeight: '76vh',
          display: 'flex',
          flexDirection: 'column',
          pointerEvents: 'auto',
          background: 'var(--dsw-alias-bg-layer-1)',
          border: '1px solid var(--dsw-alias-border-l2)',
          borderRadius: 'var(--dsw-radius-lg)',
          boxShadow: '0 12px 40px rgba(0, 0, 0, 0.32)',
          color: 'var(--dsw-alias-label-primary)',
          fontSize: 13,
          overflow: 'hidden',
        },
      },
      h('div', {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 12px',
          borderBottom: '1px solid var(--dsw-alias-border-l1)',
        },
      },
      h(Glyph, { d: TRASH_GLYPH, size: 15 }),
      h('span', { style: { fontWeight: 600 } }, t('trashTitle')),
      h('span', { style: { color: 'var(--dsw-alias-label-tertiary)' } }, `(${state.items.length})`),
      h('span', { style: { flex: 1 } }),
      state.items.length > 0
        ? h('button', {
          type: 'button',
          onClick: () => {
            if (state.confirming) {
              void run(() => request('/api/session-trash/clear', {}))
              store.set({ confirming: false })
            } else {
              store.set({ confirming: true })
            }
          },
          style: state.confirming ? dangerStyle : actionStyle,
        }, state.confirming ? t('trashClearConfirm') : t('trashClear'))
        : null,
      h('button', {
        type: 'button',
        title: t('trashClose'),
        'aria-label': t('trashClose'),
        onClick: () => store.set({ open: false, confirming: false }),
        style: { ...actionStyle, padding: '2px 6px' },
      }, h(Glyph, { d: CLOSE_GLYPH, size: 13 }))),
      h('div', {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px',
          borderBottom: '1px solid var(--dsw-alias-border-l1)',
          fontSize: 12,
          color: 'var(--dsw-alias-label-secondary)',
        },
      },
      h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' } },
        h('input', {
          type: 'checkbox',
          checked: allSelected,
          disabled: state.items.length === 0,
          onChange: toggleAll,
          style: checkboxStyle,
        }),
        t('trashSelectAll')),
      h('span', { style: { flex: 1 } }),
      h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
        h('span', {}, t('trashRetention')),
        h('select', {
          value: String(state.retentionDays),
          onChange: (event) => {
            const days = Number(event.target.value)
            void run(() => request('/api/session-trash/settings', { retentionDays: days }))
          },
          style: {
            background: 'var(--dsw-alias-bg-base)',
            color: 'var(--dsw-alias-label-primary)',
            border: '1px solid var(--dsw-alias-border-l2)',
            borderRadius: 'var(--dsw-radius-sm)',
            font: 'inherit',
            fontSize: 12,
            padding: '1px 4px',
          },
        }, state.retentionChoices.map((days) => h('option', { key: days, value: String(days) }, retentionLabel(days))))),
      selected.length > 0
        ? h('div', {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 12px',
            borderBottom: '1px solid var(--dsw-alias-border-l1)',
            background: 'var(--dsw-alias-bg-layer-1)',
          },
        },
        h('span', { style: { flex: 1, fontSize: 12 } }, t('trashSelected').replace('{n}', String(selected.length))),
        h('button', {
          type: 'button',
          onClick: () => void run(async () => {
            const ids = store.get().items
              .filter(item => selected.includes(item.trashId))
              .map(item => item.id)
            await request('/api/session-trash/batch', { action: 'restore', trashIds: selected })
            await unarchiveRestored(ids)
          }),
          style: actionStyle,
        }, h(Glyph, { d: RESTORE_GLYPH, size: 13 }), t('trashBatchRestore')),
        h('button', {
          type: 'button',
          onClick: () => void run(() => request('/api/session-trash/batch', { action: 'delete', trashIds: selected })),
          style: dangerStyle,
        }, t('trashBatchDelete')),
        h('button', {
          type: 'button',
          onClick: () => store.set({ selected: [] }),
          style: actionStyle,
        }, t('trashClearSelection')))
        : null),
      h('div', {
        style: { flex: 1, overflowY: 'auto', padding: '4px 8px' },
      },
      state.items.length === 0
        ? h('div', {
          style: { padding: '18px 12px', color: 'var(--dsw-alias-label-tertiary)', textAlign: 'center' },
        }, t('trashEmpty'))
        : state.items.map((item) => h('div', {
          key: item.trashId,
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '7px 4px',
            borderBottom: '1px solid var(--dsw-alias-border-l1)',
          },
        },
        h('input', {
          type: 'checkbox',
          checked: selected.includes(item.trashId),
          onChange: () => toggleOne(item.trashId),
          'aria-label': item.title,
          style: checkboxStyle,
        }),
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('div', {
            title: item.title,
            style: {
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: 'var(--dsw-alias-label-primary)',
            },
          }, item.title),
          h('div', {
            style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 11 },
          }, `${formatSize(item.sizeBytes)}${item.deletedAt ? ` · ${formatTime(item.deletedAt)}` : ''}${item.expired ? ` · ${t('trashExpired')}` : ''}`)),
        item.restorable
          ? h('button', {
            type: 'button',
            title: t('trashRestore'),
            onClick: () => void run(async () => {
              await request('/api/session-trash/restore', { trashId: item.trashId })
              await unarchiveRestored([item.id])
            }),
            style: actionStyle,
          }, h(Glyph, { d: RESTORE_GLYPH, size: 13 }), t('trashRestore'))
          : null,
        h('button', {
          type: 'button',
          title: t('trashDelete'),
          onClick: () => void run(() => request('/api/session-trash/delete', { trashId: item.trashId })),
          style: dangerStyle,
        }, t('trashDelete')))),
      state.error
        ? h('div', {
          style: { padding: '8px 12px', color: 'var(--dsw-alias-state-error-primary)', fontSize: 12 },
        }, state.error)
        : null))
    }

    /**
     * The refresh button anchored beside the workspace search control.
     *
     * The workspace section header owns no plugin slot, so the button lives in
     * the frame overlay and is positioned from the header's own search button.
     * It disappears when the sidebar is collapsed or the search is expanded.
     */
    function WorkspaceRefreshButton({ onRefresh }) {
      const state = useStore()
      const [anchor, setAnchor] = useState(null)

      useEffect(() => {
        let frame = 0
        const update = () => {
          const header = document.querySelector('[data-sidebar-workspace-header]')
          if (header === null) {
            setAnchor(null)
            return
          }
          // The search control is the header's only button that reports its
          // expanded state; that finds it without reading any class name.
          const search = [...header.querySelectorAll('button')]
            .find(button => button.hasAttribute('aria-expanded'))
          if (search === undefined || search.getAttribute('aria-expanded') === 'true') {
            setAnchor(null)
            return
          }
          const rect = search.getBoundingClientRect()
          if (rect.width === 0) {
            setAnchor(null)
            return
          }
          const next = { left: Math.round(rect.left - 30), top: Math.round(rect.top + (rect.height - 22) / 2) }
          setAnchor(previous =>
            previous !== null && previous.left === next.left && previous.top === next.top ? previous : next)
        }
        const schedule = () => {
          if (frame !== 0) return
          frame = requestAnimationFrame(() => {
            frame = 0
            update()
          })
        }
        update()
        window.addEventListener('resize', schedule)
        document.addEventListener('scroll', schedule, true)
        const observer = new MutationObserver(schedule)
        observer.observe(document.body, { childList: true, subtree: true })
        return () => {
          if (frame !== 0) cancelAnimationFrame(frame)
          window.removeEventListener('resize', schedule)
          document.removeEventListener('scroll', schedule, true)
          observer.disconnect()
        }
      }, [])

      if (anchor === null) return null

      return h('button', {
        type: 'button',
        'data-session-trash-refresh': 'true',
        title: t('refreshWorkspace'),
        'aria-label': t('refreshWorkspace'),
        disabled: state.refreshing,
        onClick: () => {
          if (store.get().refreshing) return
          store.set({ refreshing: true })
          Promise.resolve()
            .then(() => onRefresh())
            .then(() => refresh())
            .catch(() => undefined)
            .then(() => store.set({ refreshing: false }))
        },
        style: {
          position: 'fixed',
          left: anchor.left,
          top: anchor.top,
          width: 22,
          height: 22,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          pointerEvents: 'auto',
          border: 'none',
          borderRadius: 'var(--dsw-radius-sm)',
          background: 'transparent',
          color: 'var(--dsw-alias-label-tertiary)',
          cursor: state.refreshing ? 'progress' : 'pointer',
        },
        onMouseEnter: (event) => { event.currentTarget.style.color = 'var(--dsw-alias-label-primary)' },
        onMouseLeave: (event) => { event.currentTarget.style.color = 'var(--dsw-alias-label-tertiary)' },
      }, h(Glyph, { d: REFRESH_GLYPH, size: 15 }))
    }

    return {
      inject: ['contextMenus', 'locale', 'slots', 'sessions', 'workspaces'],
      apply(ctx) {
        try {
          const child = ctx
          const sessions = child.get('sessions')
          const workspaces = child.get('workspaces')

          // Restored sessions come back through the Host's own unarchive
          // command, whose reply carries the new archive set.
          unarchiveRestored = async (sessionIds) => {
            for (const sessionId of sessionIds ?? []) {
              if (typeof sessionId !== 'string' || sessionId === '') continue
              try {
                await workspaces.unarchiveSession(sessionId)
              } catch {
                // The session was not archived; its files are back either way.
              }
            }
          }

          /**
           * Re-read the Host's archive set into the workspace model.
           *
           * The sidebar hides a row by asking the workspace model for the
           * archived set. A session archived in another window leaves that set
           * stale here, and the row stays until DSH restarts.
           * @returns nothing.
           */
          const refreshArchiveSet = async () => {
            try {
              const response = await fetch('/api/session-trash/list', { method: 'GET' })
              const payload = await response.json().catch(() => undefined)
              if (!response.ok || payload?.ok !== true) return
              if (!Array.isArray(payload.archivedSessionIds)) return
              const list = workspaces.list
              // The workspace model owns the archive set; this is the sink that
              // replaces it. A Host without that method simply keeps its set.
              if (typeof list.replaceArchived === 'function') {
                list.replaceArchived(payload.archivedSessionIds)
              }
            } catch {
              // The archive set stays as it was.
            }
          }

          // The refresh button and the delete action share one Host list pull.
          const refreshSessions = async () => {
            try {
              await sessions.refresh()
            } catch {
              // The list may still be stale until the next pull.
            }
            await refreshArchiveSet()
          }

          child.effect(() => child.locale.register('sessionTrash', {
            zh: {
              trashSession: '删除会话并移入回收站',
              trashFailed: '无法把该会话移入回收站',
              trashDone: '会话已移入回收站',
              trashButton: '回收站',
              trashTitle: '回收站',
              trashEmpty: '回收站是空的',
              trashRestore: '恢复',
              trashDelete: '彻底删除',
              trashClear: '清空回收站',
              trashClearConfirm: '确认清空？',
              trashClose: '关闭',
              trashSelectAll: '全选',
              trashSelected: '已选 {n} 项',
              trashBatchRestore: '批量恢复',
              trashBatchDelete: '批量删除',
              trashClearSelection: '取消选择',
              trashRetention: '保留期',
              trashExpired: '已过期',
              refreshWorkspace: '刷新工作区与会话列表',
              'retention.never': '永不',
              'retention.days': '{n} 天',
            },
            en: {
              trashSession: 'Delete session and move to trash',
              trashFailed: 'Could not move this session to the trash',
              trashDone: 'Session moved to the trash',
              trashButton: 'Trash',
              trashTitle: 'Trash',
              trashEmpty: 'The trash is empty',
              trashRestore: 'Restore',
              trashDelete: 'Delete permanently',
              trashClear: 'Empty trash',
              trashClearConfirm: 'Confirm empty?',
              trashClose: 'Close',
              trashSelectAll: 'Select all',
              trashSelected: '{n} selected',
              trashBatchRestore: 'Restore',
              trashBatchDelete: 'Delete',
              trashClearSelection: 'Clear selection',
              trashRetention: 'Retention',
              trashExpired: 'expired',
              refreshWorkspace: 'Refresh the workspace and session list',
              'retention.never': 'Never',
              'retention.days': '{n} days',
            },
          }), 'session-trash: locale')

          t = child.locale.bind('sessionTrash')

          child.slots.inject('contextMenu.icon', function* () {
            yield child.slots.register({ name: 'contextMenu.icon', key: 'session-trash.trash' }, () => h(Glyph, { d: TRASH_GLYPH, size: 14 }))
          })

          child.effect(() => child.contextMenus.register({
            id: 'session.trash',
            target: 'session',
            order: 700,
            resolve: (target) => {
              const translate = child.locale.bind('sessionTrash')
              // A session that is already archived or already trashed has no
              // stored files left to move; offering the action again would only
              // create a second, empty entry.
              const archived = workspaces.list.getSnapshot().archivedSessionIds.includes(target.sessionId)
              const trashed = store.get().items.some(item => item.id === target.sessionId)
              if (archived || trashed) return []
              return [{
                id: 'trash',
                label: translate('trashSession'),
                icon: { key: 'session-trash.trash' },
                separatorBefore: true,
                danger: true,
                failureLabel: translate('trashFailed'),
                run: async () => {
                  // Hide the session through the Host's own archive command.
                  // That command answers with the complete archive set, which is
                  // the only way this client learns that the row belongs in the
                  // trash rather than in the sidebar. Writing the registry
                  // behind the Host's back leaves the sidebar stale.
                  await workspaces.archiveSession(target.sessionId, { stopActivity: true })
                  // Now that the session is hidden, its stored directory can
                  // move into the trash.
                  const result = await request('/api/session-trash/purge', {
                    sessionId: target.sessionId,
                    title: target.displayTitle,
                  })
                  // A refresh that fails must not hide the delete that already
                  // happened.
                  await refreshSessions()
                  await refresh()
                  child.contextMenus.notify(translate('trashDone'), true)
                  return result
                },
              }]
            },
          }), 'session-trash: session menu')

          child.slots.inject('sidebar.footer.action', () => child.slots.register({
            name: 'sidebar.footer.action',
            id: 'session-trash.button',
            order: 10,
          }, () => h(TrashButton)))

          child.slots.inject('shell.overlay', () => child.slots.register({
            name: 'shell.overlay',
            id: 'session-trash.panel',
          }, () => h(TrashPanel)))

          child.slots.inject('shell.overlay', () => child.slots.register({
            name: 'shell.overlay',
            id: 'session-trash.refresh',
          }, () => h(WorkspaceRefreshButton, { onRefresh: refreshSessions })))

          // The count on the sidebar button starts from the Host's own list.
          void refresh()
        } catch (error) {
          }
      },
    }
  },
})
