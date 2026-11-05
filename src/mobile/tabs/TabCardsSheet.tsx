import React, { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { X, Pin, Layers, Search, Archive, Plus, List, LayoutGrid, XCircle } from 'lucide-react'
import { useAppStore } from '@/store'
import type { SpaceId, Tab } from '@/types'
import { haptic } from '../primitives/haptics'
import type { SheetApi, SheetSubView } from '../primitives/Sheet'
import { actionListView } from '../primitives/ActionSheet'
import { SESSION_ICONS } from '@/components/shell/Sidebar'
import { TabPreview, tabTextBadge } from './TabPreview'
import { SessionSwitcher } from './SessionSwitcher'
import { ArchiveView } from './ArchivePage'
import { NewTabSheet, type MorePageRoute } from '../navigation/NewTabSheet'
import { moveInOrder, workspaceOrder } from './tabOrder'
import { displayedOrder, applyManualReorder, type TabSortMode } from './tabSort'
import './tabCards.css'
import { tabKind, tabTitle } from './tabLabels'
import { setTabInteraction } from '@/store/tabPersistenceRuntime'
import { activateTabMatch } from '@/lib/navigation/destination'
import { tabsMatchingText, type TabMatch } from '@/lib/navigation/tabResolution'
import { TabList, OtherSessionMatches } from './TabList'

export const SPACE_ORDER: SpaceId[] = ['scripture', 'notes', 'lexicon', 'youtube', 'search']
export { tabKind, tabTitle }

/** Every tab of the current workspace, all types together (TEST-022), in the workspace's display
 *  order — the same unified order the desktop sidebar shows (T23-008). */
export function workspaceTabs(tabs: Record<SpaceId, Tab[]>, stored: readonly string[] = []): Array<{ space: SpaceId; tab: Tab }> {
  const all = SPACE_ORDER.flatMap((space) => (tabs[space] ?? []).map((tab) => ({ space, tab })))
  const byId = new Map(all.map((x) => [x.tab.id, x]))
  return workspaceOrder(stored, all.map((x) => x.tab.id)).map((id) => byId.get(id)!).filter(Boolean)
}

const LIFT_MS = 380
const SLOP_PX = 8

type Gesture = {
  id: string; pointerId: number; x0: number; y0: number; grabX: number; grabY: number
  lifted: boolean; dragged: boolean; timer: ReturnType<typeof setTimeout> | null
}

/**
 * Tab cards (TEST-031; reworked T23-005/007/008/011/012). Every tab of the workspace is a CARD
 * previewing its last state (TabPreview) — a spatial, physical surface:
 *   • tap → open the tab; × → close it;
 *   • press and HOLD → the card lifts (haptic); drag → reorder while the other cards make room;
 *     release without dragging → the tab's actions, INSIDE this sheet ("‹ Tabs");
 *   • the workspace chip and the New tab card also open inside this sheet ("‹ Tabs").
 * The card layer owns the gesture (idle → pressing → lifted → dragging → drop): while a card is
 * pressed nothing underneath can be text-selected or highlighted, and a finger that moves before
 * the lift is an ordinary scroll. Reordering writes the unified display order, so the Mac's
 * sidebar shows the same order.
 * A "Recent | Custom" segmented control sorts the cards (SEP25, tabSort.ts): Recent = most recently
 * used first; Custom = that manual order. Dragging while Recent is shown switches to Custom and
 * saves the dragged order as the custom order.
 */
export function TabCardsSheet({ api, openMore }: { api: SheetApi; openMore: (route: MorePageRoute | 'archive') => void }) {
  const tabs = useAppStore((s) => s.tabs)
  const activeSpace = useAppStore((s) => s.activeSpace)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const setActiveTab = useAppStore((s) => s.setActiveTab)
  const closeTab = useAppStore((s) => s.closeTab)
  const sessionId = useAppStore((s) => s.currentSessionId)
  const stored = useAppStore((s) => s.sessionDisplayOrders[s.currentSessionId])
  const session = useAppStore((s) => s.sessions.find((x) => x.id === s.currentSessionId))
  const sortMode = useAppStore((s) => s.mobileTabSort)
  const mru = useAppStore((s) => s.tabMRUList)
  const view = useAppStore((s) => s.mobileTabView)
  const sessions = useAppStore((s) => s.sessions)
  const lastAccessed = useAppStore((s) => s.tabLastAccessed)
  const custom = useMemo(() => workspaceTabs(tabs, stored), [tabs, stored])
  const ordered = useMemo(() => {
    const byTab = new Map(custom.map((x) => [x.tab.id, x]))
    return displayedOrder(sortMode, custom.map((x) => x.tab.id), mru.map((m) => m.tabId)).map((id) => byTab.get(id)!)
  }, [custom, sortMode, mru])
  // Tab search (QO-003): every typed word against the title + kind; other sessions' matches below.
  const [query, setQuery] = useState('')
  const q = query.trim()
  const all = useMemo(() => {
    if (!q) return ordered
    const words = q.toLowerCase().split(/\s+/)
    return ordered.filter(({ tab }) => { const hay = `${tabTitle(tab)} ${tabKind(tab).label} ${tab.title}`.toLowerCase(); return words.every((w) => hay.includes(w)) })
  }, [ordered, q])
  const otherMatches = useMemo(() => (q
    ? tabsMatchingText(q, { tabs, sessions, currentSessionId: sessionId }, (t) => `${tabTitle(t)} ${tabKind(t).label}`).filter((m) => !m.current)
    : []), [q, tabs, sessions, sessionId])
  const searchable = ordered.length >= 6 || !!q
  // Select mode (bulk close) — off the default path, behind "Select".
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const toggle = (id: string) => setSelected((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const endSelect = () => { setSelecting(false); setSelected(new Set()) }
  const closeSelected = () => {
    const st = useAppStore.getState()
    let n = 0
    for (const { space, tab } of all) if (selected.has(tab.id) && !tab.isPinned) { st.closeTab(space, tab.id); n++ }
    if (n) void haptic.light()
    endSelect()
  }
  const byId = useMemo(() => new Map(all.map((x) => [x.tab.id, x])), [all])
  const isActive = (space: SpaceId, id: string) => space === activeSpace && activeTabId[space] === id
  const SessionIcon = (SESSION_ICONS.find((i) => i.name === session?.icon) ?? { Icon: Layers }).Icon

  const gridRef = useRef<HTMLDivElement>(null)
  const cardEls = useRef(new Map<string, HTMLDivElement>())
  const g = useRef<Gesture | null>(null)
  const suppressClickUntil = useRef(0)
  const [liveOrder, setLiveOrder] = useState<string[] | null>(null)
  const [liftedId, setLiftedId] = useState<string | null>(null)
  const [dragXY, setDragXY] = useState({ x: 0, y: 0 })
  const order = liveOrder ?? all.map((x) => x.tab.id)

  // Gesture ownership at the card layer (T23-005): while a card is pressed, no text selection,
  // callout or context menu underneath; while lifted, the finger doesn't scroll the sheet (a
  // non-passive touchmove — WebKit then keeps delivering pointer moves instead of cancelling).
  useEffect(() => {
    const el = gridRef.current
    if (!el) return
    // A lifted card owns the finger: nothing scrolls and the sheet's body gesture never sees the
    // move (stopPropagation — the sheet listens on an ancestor). Before the lift the touch is an
    // ordinary sheet/list drag (TEST 2026-09-29: a drag that began on a card never moved the sheet).
    const onTouchMove = (e: TouchEvent) => { if (g.current?.lifted) { e.preventDefault(); e.stopPropagation() } }
    const block = (e: Event) => { if (g.current) e.preventDefault() }
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('contextmenu', block)
    el.addEventListener('selectstart', block)
    return () => {
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('contextmenu', block)
      el.removeEventListener('selectstart', block)
    }
  }, [view]) // the grid only exists in the cards view
  // Show the current tab's card when the sheet opens.
  useEffect(() => {
    const id = activeTabId[activeSpace]
    if (id) cardEls.current.get(id)?.scrollIntoView({ block: 'nearest' })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const reset = () => {
    if (g.current?.timer) clearTimeout(g.current.timer)
    if (g.current?.lifted) setTabInteraction(false)
    g.current = null
    setLiftedId(null)
    setLiveOrder(null)
  }

  const onPointerDown = (id: string) => (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.mobile-tab-card-close')) return
    if (q) return // reordering a filtered subset would scramble the hidden tabs' order
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const card = e.currentTarget
    const r = card.getBoundingClientRect()
    const st: Gesture = { id, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, grabX: e.clientX - r.left, grabY: e.clientY - r.top, lifted: false, dragged: false, timer: null }
    st.timer = setTimeout(() => {
      if (g.current !== st) return
      st.lifted = true
      setTabInteraction(true)
      try { card.setPointerCapture(st.pointerId) } catch { /* pointer already released */ }
      window.getSelection()?.removeAllRanges()
      void haptic.medium()
      setLiftedId(id)
      setDragXY({ x: 0, y: 0 })
      setLiveOrder(all.map((x) => x.tab.id))
    }, LIFT_MS)
    g.current = st
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = g.current
    if (!st || e.pointerId !== st.pointerId) return
    const far = Math.abs(e.clientX - st.x0) > SLOP_PX || Math.abs(e.clientY - st.y0) > SLOP_PX
    if (!st.lifted) { if (far) reset(); return } // moved before the lift → a scroll, not ours
    st.dragged = st.dragged || far
    const grid = gridRef.current
    const el = cardEls.current.get(st.id)
    if (!grid || !el) return
    const gr = grid.getBoundingClientRect()
    const px = e.clientX - gr.left, py = e.clientY - gr.top
    // Nearest slot by layout position (offsets ignore the lifted card's own transform).
    const cur = liveOrder ?? order
    let best = cur.indexOf(st.id), bestD = Infinity
    cur.forEach((id, i) => {
      const c = cardEls.current.get(id)
      if (!c) return
      const d = (c.offsetLeft + c.offsetWidth / 2 - px) ** 2 + (c.offsetTop + c.offsetHeight / 2 - py) ** 2
      if (d < bestD) { bestD = d; best = i }
    })
    if (best !== cur.indexOf(st.id)) { void haptic.selection(); setLiveOrder(moveInOrder(cur, st.id, best)) }
    setDragXY({ x: px - st.grabX - el.offsetLeft, y: py - st.grabY - el.offsetTop })
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = g.current
    if (!st || e.pointerId !== st.pointerId) return
    if (st.lifted) {
      // The click that follows a lift must not also open the tab.
      suppressClickUntil.current = Date.now() + 400
      if (st.dragged && liveOrder) {
        const k = liveOrder.indexOf(st.id)
        const changed = liveOrder.join('|') !== all.map((x) => x.tab.id).join('|')
        // Any manual reorder is the Custom order — in Recent it switches to Custom (tabSort.ts).
        if (changed && k >= 0) {
          const r = applyManualReorder(liveOrder)
          const store = useAppStore.getState()
          store.setTabDisplayOrder(sessionId, r.customOrder)
          if (store.mobileTabSort !== r.mode) store.setMobileTabSort(r.mode)
        }
        void haptic.light()
      } else {
        const it = byId.get(st.id)
        if (it) api.push(tabActionsView(it.space, it.tab))
      }
    }
    reset()
  }

  const openTab = (space: SpaceId, id: string) => {
    if (Date.now() < suppressClickUntil.current) return
    void haptic.selection()
    setActiveTab(space, id)
    api.close()
  }
  const toOtherSession = (m: TabMatch) => { void haptic.selection(); api.close(); activateTabMatch(m) }
  const setView = (v: 'list' | 'cards') => { void haptic.selection(); useAppStore.getState().setMobileTabView(v) }
  const selectedClosable = all.filter((x) => selected.has(x.tab.id) && !x.tab.isPinned).length

  return (
    <div className="mobile-tab-cards-sheet">
      <div className="mobile-tab-grid-head">
        <button type="button" className="mobile-chip" aria-label={`Session: ${session?.name ?? 'Session'}. Switch session`} onClick={() => api.push(sessionsView())}>
          <SessionIcon size={16} aria-hidden /> {session?.name ?? 'Session'}
        </button>
        <span className="mobile-muted">{ordered.length} tab{ordered.length === 1 ? '' : 's'}</span>
        <div className="mobile-tab-grid-head-actions">
          {view === 'list' && ordered.length > 1 && (
            <button type="button" className={`mobile-chip m-tab-select${selecting ? ' is-on' : ''}`} aria-pressed={selecting} onClick={() => { void haptic.selection(); if (selecting) endSelect(); else setSelecting(true) }}>{selecting ? 'Done' : 'Select'}</button>
          )}
          {!selecting && (
            <button type="button" className="mobile-chip" aria-label={view === 'list' ? 'Show tabs as cards' : 'Show tabs as a list'} onClick={() => setView(view === 'list' ? 'cards' : 'list')}>
              {view === 'list' ? <LayoutGrid size={14} aria-hidden /> : <List size={14} aria-hidden />}
            </button>
          )}
          {/* Archive opens INSIDE this sheet (NEW-016) — no page or panel on top. */}
          {!selecting && <button type="button" className="mobile-chip" aria-label="Archived tabs" onClick={() => api.push({ key: 'archive', title: 'Archived tabs', render: (a) => <ArchiveView api={a} /> })}><Archive size={14} aria-hidden /></button>}
        </div>
      </div>
      {searchable && (
        <form className="mobile-search-field m-tab-search" role="search" onSubmit={(e) => { e.preventDefault(); (document.activeElement as HTMLElement | null)?.blur() }}>
          <Search size={16} aria-hidden />
          <input className="mobile-search-input" type="search" enterKeyHint="search" autoCorrect="off" spellCheck={false} placeholder="Search tabs"
            value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search open tabs" data-no-sheet-drag />
          {query && <button type="button" className="mobile-newtab-clear" aria-label="Clear" onClick={() => setQuery('')}><XCircle size={16} aria-hidden /></button>}
        </form>
      )}
      <div className="mobile-segmented m-tab-sort" role="radiogroup" aria-label="Sort tabs">
        {([['recent', 'Recent'], ['custom', 'Custom']] as Array<[TabSortMode, string]>).map(([m, label]) => (
          <button key={m} type="button" role="radio" aria-checked={sortMode === m} className={sortMode === m ? 'is-on' : ''}
            onClick={() => { if (sortMode !== m) { void haptic.selection(); useAppStore.getState().setMobileTabSort(m) } }}>{label}</button>
        ))}
      </div>
      {ordered.length === 0 && <div className="mobile-empty">No open tabs in this session.</div>}
      {q && all.length === 0 && otherMatches.length === 0 && <div className="mobile-empty">No open tab matches “{q}”.</div>}
      {view === 'list' ? (
        <>
          <TabList items={all} isActive={isActive} onOpen={openTab} onClose={(space, id) => closeTab(space, id)}
            onActions={(space, tab) => api.push(tabActionsView(space, tab))}
            selecting={selecting} selected={selected} onToggle={toggle}
            lastUsed={sortMode === 'recent' ? (space, id) => lastAccessed[`${space}:${id}`] : undefined} />
          <OtherSessionMatches matches={otherMatches} onPick={toOtherSession} />
          {selecting ? (
            <div className="m-tab-select-bar">
              <button type="button" className="mobile-link-button" onClick={() => setSelected(new Set(all.filter((x) => !x.tab.isPinned).map((x) => x.tab.id)))}>Select All</button>
              <button type="button" className="mobile-button is-destructive" disabled={!selectedClosable} onClick={closeSelected}>
                {selectedClosable ? `Close ${selectedClosable} Tab${selectedClosable === 1 ? '' : 's'}` : 'Close'}
              </button>
            </div>
          ) : (
            <button type="button" className="m-tab-new" onClick={() => api.push({ key: 'new-tab', title: 'New Tab', render: (a) => <NewTabSheet api={a} openMore={(r) => { a.close(); openMore(r) }} /> })}>
              <Plus size={18} aria-hidden /><span>New Tab</span>
            </button>
          )}
        </>
      ) : (
      <>
      <div ref={gridRef} className={`mobile-tab-cards${liftedId ? ' is-dragging' : ''}`} data-no-sheet-drag={liftedId ? '' : undefined} role="list" aria-label="Tabs">
        {order.map((id) => {
          const it = byId.get(id)
          if (!it) return null
          const { space, tab } = it
          const K = tabKind(tab)
          const title = tabTitle(tab)
          const badge = tabTextBadge(tab)
          const active = isActive(space, id)
          const lifted = liftedId === id
          return (
            <motion.div
              key={id}
              ref={(el: HTMLDivElement | null) => { if (el) cardEls.current.set(id, el); else cardEls.current.delete(id) }}
              layout={!lifted}
              transition={{ type: 'spring', stiffness: 520, damping: 40 }}
              className={`mobile-tab-card${active ? ' is-active' : ''}${lifted ? ' is-lifted' : ''}`}
              style={lifted ? { x: dragXY.x, y: dragXY.y, zIndex: 5 } : { x: 0, y: 0 }}
              animate={{ scale: lifted ? 1.06 : 1 }}
              role="listitem"
              onPointerDown={onPointerDown(id)} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={reset}
            >
              <button type="button" className="mobile-tab-card-main" onClick={() => openTab(space, id)}
                aria-current={active ? 'true' : undefined} aria-label={`${K.label}: ${title}${badge ? `, ${badge}` : ''}${active ? ', current tab' : ''}`}>
                <span className="mobile-tab-card-head">
                  <K.icon size={13} aria-hidden />
                  <span className="mobile-tab-card-title">{title}</span>
                  {badge && <span className="mobile-tab-card-badge">{badge}</span>}
                  {tab.isPinned && <Pin size={11} aria-label="Pinned" />}
                </span>
                <span className="mobile-tab-card-preview" aria-hidden><TabPreview tab={tab} /></span>
              </button>
              {/* Actions without the long-press, for VoiceOver / Switch Control. */}
              <button type="button" className="mobile-sr-only" aria-label={`Actions for ${title}`} onClick={() => api.push(tabActionsView(space, tab))}>Actions</button>
              {!tab.isPinned && (
                <button type="button" className="mobile-tab-card-close" aria-label={`Close ${title}`} onClick={() => { void haptic.light(); closeTab(space, id) }}>
                  <X size={14} aria-hidden />
                </button>
              )}
            </motion.div>
          )
        })}
        <button type="button" className="mobile-tab-card is-new" aria-label="New tab"
          onClick={() => api.push({ key: 'new-tab', title: 'New Tab', render: (a) => <NewTabSheet api={a} openMore={(r) => { a.close(); openMore(r) }} /> })}>
          <Plus size={24} aria-hidden /><span>New tab</span>
        </button>
      </div>
      <OtherSessionMatches matches={otherMatches} onPick={toOtherSession} />
      </>
      )}
    </div>
  )
}

/** A tab's actions as a view inside the tab-cards sheet (T23-012). Reordering is the drag; "Move
 *  earlier / later" are its accessible equivalent. Rows that change the list return to the cards. */
function tabActionsView(space: SpaceId, t: Tab): SheetSubView {
  const s = useAppStore.getState()
  // The order the cards show (Recent or Custom); moving saves it as the Custom order, like a drag.
  const custom = workspaceTabs(s.tabs, s.sessionDisplayOrders[s.currentSessionId]).map((x) => x.tab.id)
  const order = displayedOrder(s.mobileTabSort, custom, s.tabMRUList.map((m) => m.tabId))
  const k = order.indexOf(t.id)
  const move = (to: number) => { const r = applyManualReorder(moveInOrder(order, t.id, to)); st().setTabDisplayOrder(s.currentSessionId, r.customOrder); st().setMobileTabSort(r.mode) }
  const others = s.sessions.filter((x) => x.id !== s.currentSessionId)
  const st = () => useAppStore.getState()
  return actionListView(`tab-actions-${t.id}`, tabTitle(t), [
    { id: 'rename', label: 'Rename…', stay: true, onSelect: () => { const n = prompt('Tab name', t.title); if (n?.trim()) st().renameTab(space, t.id, n.trim()) } },
    { id: 'duplicate', label: 'Duplicate tab', onSelect: () => { st().duplicateTab(space, t.id) } },
    { id: 'earlier', label: 'Move earlier', stay: true, disabled: k <= 0, onSelect: () => move(k - 1) },
    { id: 'later', label: 'Move later', stay: true, disabled: k < 0 || k >= order.length - 1, onSelect: () => move(k + 1) },
    ...(others.length ? [{ id: 'move', label: 'Move to session', onSelect: () => {}, view: () => actionListView(`tab-move-${t.id}`, 'Move to', others.map((x) => ({ id: x.id, label: x.name, onSelect: () => st().moveTabToSession(space, t.id, x.id) }))) }] : []),
    { id: 'archive', label: 'Archive tab', stay: true, onSelect: () => st().archiveTab(space, t.id) },
    { id: 'close-others', label: 'Close other tabs of this type', stay: true, onSelect: () => { for (const o of st().tabs[space]) if (o.id !== t.id && !o.isPinned && o.type === t.type) st().closeTab(space, o.id) } },
    { id: 'close', label: 'Close tab', destructive: true, stay: true, onSelect: () => st().closeTab(space, t.id) },
  ])
}

/** Workspaces as a view inside the tab-cards sheet (T23-012): "‹ Tabs" returns to the cards; a
 *  workspace's actions and its icon picker go one level deeper in the same sheet. */
function sessionsView(): SheetSubView {
  return {
    key: 'sessions', title: 'Sessions',
    render: (a) => (
      <SessionSwitcher close={() => a.pop()} onActions={(id) => {
        const s = useAppStore.getState()
        const session = s.sessions.find((x) => x.id === id)
        a.push(actionListView(`session-${id}`, session?.name ?? 'Session', [
          { id: 'rename', label: 'Rename…', stay: true, onSelect: () => { const n = prompt('Session name', session?.name ?? ''); if (n?.trim()) s.renameSession(id, n.trim()) } },
          // archiveAllTabs acts on the live (current) workspace's tabs only.
          ...(id === s.currentSessionId ? [{ id: 'archive-all', label: 'Archive all tabs in this session', stay: true, onSelect: () => s.archiveAllTabs(session?.name) }] : []),
          { id: 'delete', label: 'Delete session', destructive: true, stay: true, disabled: s.sessions.length <= 1, onSelect: () => { if (confirm(`Delete "${session?.name}" and close its tabs?`)) s.deleteSession(id) } },
          { id: 'icon', label: 'Icon', onSelect: () => {}, view: () => actionListView(`session-icon-${id}`, 'Icon', SESSION_ICONS.map((i) => ({ id: i.name, label: i.name, icon: i.Icon, stay: true, onSelect: () => s.setSessionIcon(id, i.name) }))) },
        ]))
      }} />
    ),
  }
}
