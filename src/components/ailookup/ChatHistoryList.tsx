import { forwardRef, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { MessagesSquare, MessageCircle, Pencil, Trash2, MoreHorizontal, Sparkles, Pin, PinOff, Folder, FolderPlus, FolderMinus, FolderInput, ChevronRight, Check, Inbox } from 'lucide-react'
import { IconButton, SearchField, TextField, MenuItem, MenuSeparator, MenuSub, EmptyState, AlertSheet, useContextMenu, cx } from '@/components/ui'
import type { AiLookupChatSummary } from '@/types/electron'
import { formatDayHeading, formatTime, messagePreviewText, messageTime, cleanFolder, UNFILED_CHAT_ID, UNFILED_CHAT_TITLE } from './chatModel'
import { filterConversations } from './ChatComposerControls'
import type { ChatController } from './useChatController'
import './chatLayout.css'

const DAY_MS = 86_400_000
const DAYS_COLLAPSED = 7

export interface HistoryGroup { key: string; label: string; items: AiLookupChatSummary[] }

const lastActivity = (s: AiLookupChatSummary) => s.lastMessageAt ?? s.updated_at
const startOfDay = (t: number) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() }
/** Whole calendar days between `t` and `now` (DST-safe). */
const daysAgo = (t: number, now: number) => Math.round((startOfDay(now) - startOfDay(t)) / DAY_MS)

/**
 * Conversations grouped by last activity, newest first: Today · Yesterday · Previous 7 Days ·
 * Previous 30 Days · then one group per month ("September 2026").
 */
export function groupConversationsByDate(summaries: readonly AiLookupChatSummary[], now = Date.now()): HistoryGroup[] {
  const sorted = [...summaries].sort((a, b) => lastActivity(b).localeCompare(lastActivity(a)))
  const groups: HistoryGroup[] = []
  const byKey = new Map<string, HistoryGroup>()
  for (const s of sorted) {
    const t = Date.parse(lastActivity(s))
    let key: string, label: string
    if (!Number.isFinite(t)) { key = 'earlier'; label = 'Earlier' }
    else {
      const n = daysAgo(t, now)
      if (n <= 0) { key = 'today'; label = 'Today' }
      else if (n === 1) { key = 'yesterday'; label = 'Yesterday' }
      else if (n <= 7) { key = 'week'; label = 'Previous 7 Days' }
      else if (n <= 30) { key = 'month'; label = 'Previous 30 Days' }
      else {
        const d = new Date(t)
        key = `m:${d.getFullYear()}-${d.getMonth()}`
        label = d.toLocaleDateString([], { month: 'long', year: 'numeric' })
      }
    }
    let g = byKey.get(key)
    if (!g) { g = { key, label, items: [] }; byKey.set(key, g); groups.push(g) }
    g.items.push(s)
  }
  return groups
}

/** Row time: a time today, "Yesterday", a weekday this week, else a short date. */
export function formatHistoryTime(at: string | number | undefined, now = Date.now()): string {
  const t = typeof at === 'number' ? at : at ? Date.parse(at) : NaN
  if (!Number.isFinite(t)) return ''
  const n = daysAgo(t, now)
  if (n <= 0) return formatTime(t)
  if (n === 1) return 'Yesterday'
  const d = new Date(t)
  if (n < 7) return d.toLocaleDateString([], { weekday: 'short' })
  return d.getFullYear() === new Date(now).getFullYear()
    ? d.toLocaleDateString([], { month: 'short', day: 'numeric' })
    : d.toLocaleDateString([], { month: 'numeric', day: 'numeric', year: '2-digit' })
}

type RowTarget = { id: string; title: string }

/** A dialog the list asks for — rendered by ChatListDialogs (here, or by a host whose list lives
 *  in a transient popover that would unmount with it). */
export type ChatListDialog =
  | { kind: 'delete'; target: RowTarget }
  | { kind: 'new-folder'; chatId: string }
  | { kind: 'rename-folder'; folder: string }
  | { kind: 'delete-folder'; folder: string }

/** Pinned (newest pin first), folders (A→Z, conversations newest first) and the rest by date —
 *  a pinned conversation shows under Pinned only, a filed one inside its folder only. */
export function organizeConversations(summaries: readonly AiLookupChatSummary[], now = Date.now()) {
  const pinned = summaries.filter((s) => s.pinnedAt).sort((a, b) => (b.pinnedAt! > a.pinnedAt! ? 1 : b.pinnedAt! < a.pinnedAt! ? -1 : 0))
  const byFolder = new Map<string, AiLookupChatSummary[]>()
  for (const s of summaries) if (!s.pinnedAt && s.folder) { const l = byFolder.get(s.folder) ?? []; l.push(s); byFolder.set(s.folder, l) }
  const folders = [...byFolder.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, items]) => ({ name, items: [...items].sort((a, b) => lastActivity(b).localeCompare(lastActivity(a))) }))
  const groups = groupConversationsByDate(summaries.filter((s) => !s.pinnedAt && !s.folder), now)
  return { pinned, folders, groups }
}

/** Date groups the user collapsed / expanded (keys of groupConversationsByDate). Month groups
 *  start collapsed — long histories stay short — every other group starts open. Per device. */
const GROUPS_KEY = 'berean-chat-groups-v1'
const readGroupState = (): Record<string, boolean> => { try { const v = JSON.parse(localStorage.getItem(GROUPS_KEY) ?? '{}'); return v && typeof v === 'object' ? v : {} } catch { return {} } }
const writeGroupState = (v: Record<string, boolean>) => { try { localStorage.setItem(GROUPS_KEY, JSON.stringify(v)) } catch { /* per-device convenience */ } }
export const groupOpenByDefault = (key: string) => !key.startsWith('m:') && key !== 'earlier'
const DAYS_OPEN_KEY = 'berean-chat-days-open'

const FOLDERS_OPEN_KEY = 'berean-chat-folders-open'
const readOpenFolders = (): string[] => { try { const v = JSON.parse(localStorage.getItem(FOLDERS_OPEN_KEY) ?? '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [] } catch { return [] } }
const writeOpenFolders = (v: string[]) => { try { localStorage.setItem(FOLDERS_OPEN_KEY, JSON.stringify(v)) } catch { /* per-device convenience */ } }
type MenuAnchor = React.MouseEvent | KeyboardEvent | { x: number; y: number; target?: EventTarget | null }

/**
 * One conversation row: title + time, preview below; the trailing "…" replaces the time on
 * hover / keyboard focus. Selection is a quiet accent tint, never a solid fill.
 */
export function ConversationRow({ s, selected, now, onOpen, onRename, onMenu, menuOpen, showPin }: {
  s: AiLookupChatSummary
  selected: boolean
  now?: number
  onOpen: () => void
  onRename?: () => void
  /** Opens the row menu at the pointer (right-click), below the row (Shift+F10) or below "…". */
  onMenu?: (at: MenuAnchor) => void
  menuOpen?: boolean
  /** A small pin before the title (rows outside the Pinned section, e.g. the panel's recents). */
  showPin?: boolean
}) {
  return (
    <div className="chat-hist-item" data-menu-open={menuOpen || undefined} role="listitem">
      <button
        type="button"
        data-roving
        data-chat-id={s.id}
        aria-current={selected || undefined}
        className="chat-hist-row chat-hist-row-stack focus-ring"
        onClick={onOpen}
        onDoubleClick={onRename ? (e) => { e.preventDefault(); onRename() } : undefined}
        onContextMenu={onMenu}
        onKeyDown={(e) => {
          if (e.key === 'F2' && onRename) { e.preventDefault(); onRename() }
          else if (e.key === 'F10' && e.shiftKey && onMenu) onMenu(e)
        }}
      >
        <span className="chat-hist-line">
          <span className="chat-hist-title">{showPin && s.pinnedAt && <Pin size={10} className="inline -mt-0.5 mr-1 text-text-muted" aria-label="Pinned" />}{s.title}</span>
          <span className="chat-hist-time text-meta">{formatHistoryTime(lastActivity(s), now)}</span>
        </span>
        <span className="chat-hist-preview">{s.preview || 'No messages yet'}</span>
      </button>
      {onMenu && (
        <IconButton
          icon={MoreHorizontal}
          label={`Actions for ${s.title}`}
          size={20}
          variant="ghost"
          tooltip={false}
          tabIndex={-1}
          className="chat-hist-more"
          onClick={(e) => {
            e.stopPropagation()
            const r = e.currentTarget.getBoundingClientRect()
            onMenu({ x: r.left, y: r.bottom + 2, target: e.currentTarget })
          }}
        />
      )}
    </div>
  )
}

/** A collapsible date group heading ("Today ›"): the count shows only while it is collapsed. */
function GroupHeading({ label, count, open, onToggle }: { label: string; count: number; open: boolean; onToggle: () => void }) {
  return (
    <button type="button" aria-expanded={open} className="chat-hist-heading chat-group-toggle focus-ring" onClick={onToggle}
      onKeyDown={(e) => { if ((e.key === 'ArrowRight' && !open) || (e.key === 'ArrowLeft' && open)) { e.preventDefault(); onToggle() } }}>
      <span className="flex-1 text-left">{label}</span>
      {!open && <span className="chat-group-count" aria-label={`${count} conversation${count === 1 ? '' : 's'}`}>{count}</span>}
      <ChevronRight size={10} strokeWidth={2.5} className={cx('chat-group-chevron', open && 'rotate-90')} aria-hidden />
    </button>
  )
}

/**
 * The shared Berean Chat history list — the standalone window's sidebar and the embedded
 * panel's conversation switcher: search, "All Messages", a compact "Days" disclosure (one day's
 * messages across conversations), and conversations grouped by date. Rename inline (double-
 * click / F2 / menu), delete through the one confirm dialog (AlertSheet). ↑/↓ move between
 * rows, Return opens, Shift+F10 / right-click open the row menu.
 */
export const ChatHistoryList = forwardRef<HTMLInputElement, {
  c: ChatController
  /** Search results replace the list (panel switcher) instead of the transcript. */
  inlineResults?: boolean
  /** Called after something was opened (closes a popover / overlay). */
  onNavigate?: () => void
  /** Dialogs (delete, new / rename / delete folder) handled by the host (when this list lives in
   *  a transient popover that would unmount with its own dialog). Default: rendered here. */
  onRequestDialog?: (d: ChatListDialog) => void
  /** Fixed clock for tests. */
  now?: number
  className?: string
}>(function ChatHistoryList({ c, inlineResults, onNavigate, onRequestDialog, now, className }, searchRef) {
  const [daysOpen, setDaysOpenState] = useState(() => { try { return localStorage.getItem(DAYS_OPEN_KEY) === '1' } catch { return false } })
  const setDaysOpen = (fn: (v: boolean) => boolean) => setDaysOpenState((v) => { const n = fn(v); try { localStorage.setItem(DAYS_OPEN_KEY, n ? '1' : '0') } catch { /* */ } return n })
  const [groupState, setGroupState] = useState<Record<string, boolean>>(readGroupState)
  const groupOpen = (key: string) => groupState[key] ?? groupOpenByDefault(key)
  const toggleGroup = (key: string) => setGroupState((st) => { const n = { ...st, [key]: !(st[key] ?? groupOpenByDefault(key)) }; writeGroupState(n); return n })
  const [allDays, setAllDays] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [dialog, setDialog] = useState<ChatListDialog | null>(null)
  const [openFolders, setOpenFolders] = useState<string[]>(readOpenFolders)
  const toggleFolder = (name: string) => setOpenFolders((v) => { const n = v.includes(name) ? v.filter((x) => x !== name) : [...v, name]; writeOpenFolders(n); return n })
  const folderMenu = useContextMenu<{ folder: string }>()
  const renameRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const menu = useContextMenu<RowTarget>()

  // Days (and the All Messages count) are only computed while a history list is showing.
  useEffect(() => { void c.refreshDays() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (renamingId) renameRef.current?.select() }, [renamingId])

  const { pinned, folders, groups } = useMemo(() => organizeConversations(c.summaries, now), [c.summaries, now])
  const days = c.days ?? []
  const shownDays = allDays ? days : days.slice(0, DAYS_COLLAPSED)
  const searching = !!c.search.trim()

  const go = (fn: () => void) => { fn(); onNavigate?.() }
  const startRename = (t: RowTarget) => { setRenamingId(t.id); setRenameValue(t.title) }
  const commitRename = () => {
    if (renamingId && renameValue.trim()) void c.renameChat(renamingId, renameValue)
    setRenamingId(null)
  }
  const ask = (d: ChatListDialog) => { if (onRequestDialog) onRequestDialog(d); else setDialog(d) }
  const requestDelete = (t: RowTarget) => ask({ kind: 'delete', target: t })

  // ↑/↓ between rows (and from the search field into the list), Home/End.
  const rows = () => Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-roving]') ?? [])
  const onListKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    const t = e.target as HTMLElement
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return
    const items = rows()
    if (!items.length) return
    const i = items.indexOf(t)
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1
      : e.key === 'ArrowDown' ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1)
    e.preventDefault()
    items[next]?.focus()
  }
  const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'ArrowDown' || searching) return
    e.preventDefault()
    const items = rows()
    ;(items.find((el) => el.getAttribute('aria-current') === 'true') ?? items[0])?.focus()
  }

  const conversationSelected = (id: string) => c.view.kind === 'conversation' && c.activeChatId === id && !searching

  let body: ReactNode
  if (!c.summariesLoaded) {
    body = (
      <div aria-busy="true" aria-label="Loading conversations">
        {[0, 1, 2].map((i) => <div key={i} className="chat-hist-skeleton" aria-hidden><i /><i /></div>)}
      </div>
    )
  } else if (c.summaries.length === 0) {
    body = <EmptyState compact icon={MessageCircle} title="No Conversations Yet" hint="Anything you send starts one." />
  } else {
    const row = (s: AiLookupChatSummary) => renamingId === s.id ? (
      // Renaming keeps the row exactly as it was (time, preview, selection tint); only the
      // title becomes a hairline field in its own place.
      <div key={s.id} role="listitem" className="chat-hist-item">
        <div className="chat-hist-row chat-hist-row-stack" aria-current={conversationSelected(s.id) || undefined}>
          <span className="chat-hist-line">
            <span className="chat-hist-title">
              <input
                ref={renameRef}
                className="chat-rename-input"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commitRename() }
                  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setRenamingId(null) }
                }}
                onBlur={commitRename}
                aria-label="Conversation name"
                spellCheck={false}
              />
            </span>
            <span className="chat-hist-time text-meta">{formatHistoryTime(lastActivity(s), now)}</span>
          </span>
          <span className="chat-hist-preview">{s.preview || 'No messages yet'}</span>
        </div>
      </div>
    ) : (
      <ConversationRow
        key={s.id}
        s={s}
        now={now}
        selected={conversationSelected(s.id)}
        menuOpen={menu.state?.payload.id === s.id}
        onOpen={() => go(() => { c.setSearch(''); c.openConversation(s.id) })}
        onRename={() => startRename({ id: s.id, title: s.title })}
        onMenu={(at) => menu.openAt(at, { id: s.id, title: s.title })}
      />
    )
    body = (
      <>
        {pinned.length > 0 && (
          <section aria-label="Pinned" className="pt-[var(--chat-group-gap)]">
            <div className="chat-hist-heading">Pinned</div>
            <div role="list" className="flex flex-col gap-[var(--chat-row-gap)]">{pinned.map(row)}</div>
          </section>
        )}
        {folders.length > 0 && (
          <section aria-label="Folders" className="pt-[var(--chat-group-gap)]">
            <div className="chat-hist-heading">Folders</div>
            <div className="flex flex-col gap-[var(--chat-row-gap)]">
              {folders.map((f) => {
                const open = openFolders.includes(f.name) || f.items.some((s) => conversationSelected(s.id))
                return (
                  <div key={f.name}>
                    <button
                      type="button"
                      data-roving
                      aria-expanded={open}
                      className="chat-hist-row chat-folder-row focus-ring"
                      data-menu-open={folderMenu.state?.payload.folder === f.name || undefined}
                      onClick={() => toggleFolder(f.name)}
                      onContextMenu={(e) => folderMenu.openAt(e, { folder: f.name })}
                      onKeyDown={(e) => { if (e.key === 'F10' && e.shiftKey) folderMenu.openAt(e, { folder: f.name }); else if (e.key === 'ArrowRight' && !open) { e.preventDefault(); toggleFolder(f.name) } else if (e.key === 'ArrowLeft' && open) { e.preventDefault(); toggleFolder(f.name) } }}
                    >
                      <ChevronRight size={11} strokeWidth={2.25} className={cx('flex-shrink-0 text-text-muted transition-transform duration-fast', open && 'rotate-90')} aria-hidden />
                      <Folder size={14} strokeWidth={1.75} className="flex-shrink-0 text-accent" aria-hidden />
                      <span className="chat-hist-title">{f.name}</span>
                      <span className="text-meta">{f.items.length}</span>
                    </button>
                    {open && <div role="list" className="flex flex-col gap-[var(--chat-row-gap)] pl-[var(--chat-space-3)] pt-[var(--chat-row-gap)]">{f.items.map(row)}</div>}
                  </div>
                )
              })}
            </div>
          </section>
        )}
        {(pinned.length > 0 || folders.length > 0) && groups.length > 0 && <div className="chat-hist-divider" role="separator" />}
        {groups.map((g) => {
          // The open conversation's group never hides it.
          const open = groupOpen(g.key) || g.items.some((s) => conversationSelected(s.id))
          return (
            <section key={g.key} aria-label={g.label} className="pt-[var(--chat-group-gap)]">
              <GroupHeading label={g.label} count={g.items.length} open={open} onToggle={() => toggleGroup(g.key)} />
              {open && <div role="list" className="flex flex-col gap-[var(--chat-row-gap)]">{g.items.map(row)}</div>}
            </section>
          )
        })}
      </>
    )
  }

  return (
    <nav className={cx('flex flex-col min-h-0', className)} aria-label="Conversations">
      <div className="flex-shrink-0 px-[var(--chat-list-inset)] pb-[var(--chat-space-2)]">
        <SearchField ref={searchRef} value={c.search} onValueChange={c.setSearch} onKeyDown={onSearchKeyDown} placeholder="Search Messages" />
      </div>
      {inlineResults && searching ? <SearchResults c={c} onPick={onNavigate} /> : (
        <div ref={listRef} onKeyDown={onListKeyDown} className="chat-hist-scroll flex-1 min-h-0 overflow-y-auto overscroll-contain px-[var(--chat-list-inset)] pb-[var(--chat-space-3)]">
          {/* Navigation: every message as one stream, and (folded under it) one day at a time.
              The day counts are MESSAGE counts, labelled as such. */}
          <div className="flex flex-col gap-[var(--chat-row-gap)]">
            <div className="chat-hist-item">
              <button type="button" data-roving aria-current={(c.view.kind === 'all' && !searching) || undefined} className="chat-hist-row focus-ring"
                onClick={() => go(() => { c.setSearch(''); c.setView({ kind: 'all' }) })}>
                <MessagesSquare size={14} strokeWidth={1.75} className="flex-shrink-0 text-accent" />
                <span className="chat-hist-title">All Messages</span>
              </button>
              {days.length > 0 && (
                <IconButton icon={ChevronRight} label={daysOpen ? 'Hide Days' : 'Show Days'} size={20} variant="ghost" tooltip={false} tabIndex={-1}
                  aria-expanded={daysOpen} className={cx('chat-days-toggle', daysOpen && 'is-open')} onClick={() => setDaysOpen((v) => !v)} />
              )}
            </div>
            {days.length > 0 && daysOpen && (
              <>
                <div className="flex flex-col gap-[var(--chat-row-gap)] pl-[22px]" role="list" aria-label="Days">
                    {shownDays.map((d) => (
                      <button key={d.dayKey} type="button" role="listitem" data-roving aria-current={(c.view.kind === 'day' && c.view.dayKey === d.dayKey && !searching) || undefined}
                        className="chat-hist-row chat-day-row focus-ring" onClick={() => go(() => { c.setSearch(''); c.setView({ kind: 'day', dayKey: d.dayKey }) })}>
                        <span className="chat-hist-title">{formatDayHeading(d.dayKey, now)}</span>
                        <span className="text-meta" aria-label={`${d.count} message${d.count === 1 ? '' : 's'}`} title={`${d.count} message${d.count === 1 ? '' : 's'}`}>{d.count}</span>
                      </button>
                    ))}
                    {days.length > DAYS_COLLAPSED && (
                      <button type="button" className="self-start px-[var(--chat-row-px)] py-[var(--chat-space-1)] text-caption2 text-accent hover:underline focus-ring rounded-chip" onClick={() => setAllDays((v) => !v)}>
                        {allDays ? 'Show Fewer' : `Show All ${days.length} Days`}
                      </button>
                    )}
                </div>
              </>
            )}
            {/* Unfiled: every message sent to no conversation, opened like one. */}
            <button type="button" data-roving aria-current={conversationSelected(UNFILED_CHAT_ID) || undefined} className="chat-hist-row focus-ring"
              onClick={() => go(() => { c.setSearch(''); c.openConversation(UNFILED_CHAT_ID) })}>
              <Inbox size={14} strokeWidth={1.75} className="flex-shrink-0 text-accent" />
              <span className="chat-hist-title">{UNFILED_CHAT_TITLE}</span>
            </button>
          </div>
          {body}
        </div>
      )}
      <menu.Menu label="Conversation">
        {(p) => {
          const s = c.summaries.find((x) => x.id === p.id)
          return (
            <>
              <MenuItem icon={MessageCircle} label="Open" onClick={() => go(() => { c.setSearch(''); c.openConversation(p.id) })} />
              <MenuItem icon={s?.pinnedAt ? PinOff : Pin} label={s?.pinnedAt ? 'Unpin' : 'Pin'} onClick={() => void c.pinChat(p.id, !s?.pinnedAt)} />
              <MenuSub icon={FolderInput} label="Move to Folder">
                {c.folders.map((f) => (
                  <MenuItem key={f} icon={Folder} label={f} trailing={s?.folder === f ? <Check size={12} strokeWidth={2.5} aria-label="Current folder" /> : undefined} onClick={() => void c.moveToFolder(p.id, f)} />
                ))}
                {c.folders.length > 0 && <MenuSeparator />}
                <MenuItem icon={FolderPlus} label="New Folder…" onClick={() => ask({ kind: 'new-folder', chatId: p.id })} />
                {s?.folder && <MenuItem icon={FolderMinus} label="Remove from Folder" onClick={() => void c.moveToFolder(p.id, null)} />}
              </MenuSub>
              <MenuSeparator />
              <MenuItem icon={Pencil} label="Rename…" onClick={() => startRename(p)} />
              <MenuItem icon={Trash2} label="Delete Conversation…" danger onClick={() => requestDelete(p)} />
            </>
          )
        }}
      </menu.Menu>
      <folderMenu.Menu label="Folder">
        {({ folder }) => (
          <>
            <MenuItem icon={Pencil} label="Rename Folder…" onClick={() => ask({ kind: 'rename-folder', folder })} />
            <MenuSeparator />
            <MenuItem icon={Trash2} label="Delete Folder…" danger onClick={() => ask({ kind: 'delete-folder', folder })} />
          </>
        )}
      </folderMenu.Menu>
      {!onRequestDialog && <ChatListDialogs c={c} dialog={dialog} onClose={() => setDialog(null)} />}
    </nav>
  )
})

/** The list's dialogs: delete a conversation, name a new folder, rename or delete a folder. */
export function ChatListDialogs({ c, dialog, onClose }: { c: ChatController; dialog: ChatListDialog | null; onClose: () => void }) {
  return (
    <>
      <DeleteConversationAlert target={dialog?.kind === 'delete' ? dialog.target : null} onClose={onClose} onConfirm={(id) => void c.deleteChat(id)} />
      <FolderNameAlert
        open={dialog?.kind === 'new-folder' || dialog?.kind === 'rename-folder'}
        title={dialog?.kind === 'rename-folder' ? 'Rename Folder' : 'New Folder'}
        initial={dialog?.kind === 'rename-folder' ? dialog.folder : ''}
        confirmLabel={dialog?.kind === 'rename-folder' ? 'Rename' : 'Create'}
        taken={dialog?.kind === 'rename-folder' ? c.folders.filter((f) => f !== dialog.folder) : []}
        onClose={onClose}
        onConfirm={(name) => {
          if (dialog?.kind === 'new-folder') void c.moveToFolder(dialog.chatId, name)
          else if (dialog?.kind === 'rename-folder') void c.renameFolder(dialog.folder, name)
        }}
      />
      <AlertSheet
        open={dialog?.kind === 'delete-folder'}
        onOpenChange={(o) => { if (!o) onClose() }}
        icon={Trash2}
        title={`Delete the folder “${dialog?.kind === 'delete-folder' ? dialog.folder : ''}”?`}
        message="The conversations in it are kept — they just leave the folder, on all your devices."
        confirmLabel="Delete Folder"
        destructive
        defaultIsCancel
        onConfirm={() => { if (dialog?.kind === 'delete-folder') void c.renameFolder(dialog.folder, null); onClose() }}
      />
    </>
  )
}

/** Name a folder (new or renamed). A name already in use (renaming onto another folder) merges into it — said so. */
function FolderNameAlert({ open, title, initial, confirmLabel, taken, onClose, onConfirm }: {
  open: boolean; title: string; initial: string; confirmLabel: string; taken: string[]; onClose: () => void; onConfirm: (name: string) => void
}) {
  const [value, setValue] = useState(initial)
  useEffect(() => { if (open) setValue(initial) }, [open, initial])
  const clean = cleanFolder(value)
  const merges = !!clean && taken.includes(clean)
  const submit = () => { if (!clean) return; onConfirm(clean); onClose() }
  return (
    <AlertSheet
      open={open}
      onOpenChange={(o) => { if (!o) onClose() }}
      icon={FolderPlus}
      title={title}
      message={merges ? `A folder named “${clean}” exists — its conversations and these will share it.` : undefined}
      confirmLabel={confirmLabel}
      onConfirm={submit}
    >
      <TextField
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
        placeholder="Folder Name"
        aria-label="Folder name"
        maxLength={60}
      />
    </AlertSheet>
  )
}

/** The one delete confirmation (AlertSheet), shared by the window sidebar and the panel. */
export function DeleteConversationAlert({ target, onClose, onConfirm }: { target: RowTarget | null; onClose: () => void; onConfirm: (id: string) => void }) {
  return (
    <AlertSheet
      open={!!target}
      onOpenChange={(o) => { if (!o) onClose() }}
      icon={Trash2}
      title={`Delete “${target?.title ?? ''}”?`}
      message="This conversation and its messages are removed from all your devices."
      confirmLabel="Delete"
      destructive
      defaultIsCancel
      onConfirm={() => { if (target) onConfirm(target.id); onClose() }}
    />
  )
}

/** `text` with every occurrence of `q` marked (case-insensitive), trimmed to start near the first. */
export function highlightAll(text: string, q: string, lead = 40): ReactNode {
  const needle = q.trim().toLowerCase()
  if (!needle) return text
  const lower = text.toLowerCase()
  const first = lower.indexOf(needle)
  if (first < 0) return text
  const startAt = Math.max(0, first - lead)
  const parts: ReactNode[] = startAt > 0 ? ['…'] : []
  let at = startAt
  for (let i = first; i >= 0; i = lower.indexOf(needle, i + needle.length)) {
    parts.push(text.slice(at, i))
    parts.push(<mark key={i} className="chat-search-mark">{text.slice(i, i + needle.length)}</mark>)
    at = i + needle.length
  }
  parts.push(text.slice(at))
  return <>{parts}</>
}

export type SearchFilter = 'all' | 'conversations' | 'messages'

/**
 * Global Chat search (⌥⌘F / the sidebar field): conversations whose title or preview matches and
 * matching messages (conversation, excerpt with every match marked, date), filterable. Searching
 * is not composing — the host shows no composer under it. Opening a message result opens its
 * conversation with Find set to the query, on that message (useChatController.openSearchResult).
 * Distinct from the composer's conversation picker (choosing where a message goes) and from ⌘F
 * (finding inside the open conversation).
 */
export function SearchResults({ c, onPick, now }: { c: ChatController; onPick?: () => void; now?: number }) {
  const q = c.search.trim()
  const [filter, setFilter] = useState<SearchFilter>('all')
  const results = c.searchResults
  const titleHits = useMemo(() => (q ? filterConversations(c.summaries, q) : []), [c.summaries, q])
  const messages = results ?? []
  const loading = results === null
  const showConvs = filter !== 'messages'
  const showMsgs = filter !== 'conversations'
  const convs = showConvs ? titleHits.slice(0, filter === 'all' ? 5 : 200) : []
  const pick = (chatId: string, messageId?: string) => { c.openSearchResult(chatId, messageId, q); onPick?.() }
  const msgCount = messages.length === 200 ? '200+' : String(messages.length)
  const noResults = !loading && (showConvs ? titleHits.length : 0) + (showMsgs ? messages.length : 0) === 0
  return (
    <div className="flex-1 min-h-0 flex flex-col" aria-label="Search results">
      <div className="chat-search-filters px-[var(--chat-list-inset)] pb-[var(--chat-space-2)]" role="radiogroup" aria-label="Show">
        {(['all', 'conversations', 'messages'] as const).map((f) => (
          <button key={f} type="button" role="radio" aria-checked={filter === f} className={cx('chat-search-filter focus-ring', filter === f && 'is-on')} onClick={() => setFilter(f)}>
            {f === 'all' ? 'All' : f === 'conversations' ? `Conversations${q ? ` · ${titleHits.length}` : ''}` : `Messages${loading ? '' : ` · ${msgCount}`}`}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-[var(--chat-list-inset)] pb-[var(--chat-space-3)]">
        {noResults && (
          <div className="pt-[var(--chat-space-4)]"><EmptyState compact icon={MessageCircle} title="No Results" hint={`Nothing matches “${q}”${filter === 'all' ? '' : ` in ${filter}`}.`} /></div>
        )}
        {convs.length > 0 && (
          <section aria-label="Conversations">
            <div className="chat-hist-heading pt-[var(--chat-space-1)]">Conversations</div>
            <div role="list" className="flex flex-col gap-[var(--chat-row-gap)]">
              {convs.map((s) => (
                <div key={s.id} role="listitem" className="chat-hist-item">
                  <button type="button" data-roving className="chat-hist-row chat-hist-row-stack focus-ring" onClick={() => pick(s.id)}>
                    <span className="chat-hist-line">
                      <span className="chat-hist-title">{highlightAll(s.title, q, 1000)}</span>
                      <span className="chat-hist-time text-meta">{formatHistoryTime(lastActivity(s), now)}</span>
                    </span>
                    <span className="chat-hist-preview">{s.preview ? highlightAll(s.preview, q) : 'No messages yet'}</span>
                  </button>
                </div>
              ))}
            </div>
            {filter === 'all' && titleHits.length > convs.length && (
              <button type="button" className="mt-1 px-[var(--chat-row-px)] text-caption text-accent hover:underline focus-ring rounded-chip" onClick={() => setFilter('conversations')}>
                Show All {titleHits.length} Conversations
              </button>
            )}
          </section>
        )}
        {showMsgs && loading && <div className="px-[var(--chat-row-px)] pt-[var(--chat-space-3)] text-caption text-text-muted" aria-busy="true">Searching messages…</div>}
        {showMsgs && messages.length > 0 && (
          <section aria-label="Messages" className={convs.length ? 'pt-[var(--chat-group-gap)]' : undefined}>
            <div className="chat-hist-heading pt-[var(--chat-space-1)]">{msgCount} Message{messages.length === 1 ? '' : 's'}</div>
            <div role="list" className="flex flex-col gap-[var(--chat-row-gap)]">
              {messages.map((it) => (
                <div key={it.key} role="listitem" className="chat-hist-item">
                  <button type="button" data-roving className="chat-hist-row chat-hist-row-stack focus-ring" onClick={() => { if (it.chatId) pick(it.chatId, it.message.id) }}>
                    <span className="chat-hist-line">
                      {it.message.kind !== 'note' && <Sparkles size={10} className="flex-shrink-0 self-center text-accent" aria-label="Ask Berean" />}
                      <span className="chat-hist-title">{it.chatTitle}</span>
                      <span className="chat-hist-time text-meta">{formatHistoryTime(messageTime(it.message) || undefined, now)}</span>
                    </span>
                    <span className="block text-caption2 leading-snug text-text-secondary line-clamp-2 break-words">
                      {it.message.role === 'assistant' ? 'Berean: ' : ''}{highlightAll(messagePreviewText(it.message), q)}
                    </span>
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
