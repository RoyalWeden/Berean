import React, { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { X, Pin, Layers, BookOpen, NotepadText, BookMarked, Youtube, Search, FileText, Tags, Archive, Plus, History, Settings as SettingsIcon, type LucideIcon } from 'lucide-react'
import { useAppStore } from '@/store'
import type { SpaceId, Tab } from '@/types'
import { haptic } from '../primitives/haptics'
import type { SheetApi, SheetSubView } from '../primitives/Sheet'
import { actionListView } from '../primitives/ActionSheet'
import { SESSION_ICONS } from '@/components/shell/Sidebar'
import { TabPreview, tabTextBadge } from './TabPreview'
import { SessionSwitcher } from './SessionSwitcher'
import { NewTabSheet, type MorePageRoute } from '../navigation/NewTabSheet'
import { moveInOrder, workspaceOrder } from './tabOrder'

export const SPACE_ORDER: SpaceId[] = ['scripture', 'notes', 'lexicon', 'youtube', 'search']

/** Icon + short kind label for a tab. */
export function tabKind(t: Tab): { icon: LucideIcon; label: string } {
  if (t.type === 'bible') return { icon: BookOpen, label: (t.state as { compareMode?: boolean }).compareMode ? 'Compare' : 'Scripture' }
  if (t.type === 'pdf') return { icon: FileText, label: 'PDF' }
  if (t.type === 'note') return { icon: NotepadText, label: 'Note' }
  if (t.type === 'tags') return { icon: Tags, label: 'Tags' }
  if (t.type === 'lexicon') return { icon: BookMarked, label: 'Lexicon' }
  if (t.type === 'youtube') return { icon: Youtube, label: 'YouTube' }
  if (t.type === 'history') return { icon: History, label: 'History' }
  if (t.type === 'settings') return { icon: SettingsIcon, label: 'Settings' }
  return { icon: Search, label: 'Search' }
}

export function tabTitle(t: Tab): string {
  return t.title || tabKind(t).label
}

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
  const all = useMemo(() => workspaceTabs(tabs, stored), [tabs, stored])
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
    const onTouchMove = (e: TouchEvent) => { if (g.current?.lifted) e.preventDefault() }
    const block = (e: Event) => { if (g.current) e.preventDefault() }
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('contextmenu', block)
    el.addEventListener('selectstart', block)
    return () => {
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('contextmenu', block)
      el.removeEventListener('selectstart', block)
    }
  }, [])
  // Show the current tab's card when the sheet opens.
  useEffect(() => {
    const id = activeTabId[activeSpace]
    if (id) cardEls.current.get(id)?.scrollIntoView({ block: 'nearest' })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const reset = () => {
    if (g.current?.timer) clearTimeout(g.current.timer)
    g.current = null
    setLiftedId(null)
    setLiveOrder(null)
  }

  const onPointerDown = (id: string) => (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.mobile-tab-card-close')) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const card = e.currentTarget
    const r = card.getBoundingClientRect()
    const st: Gesture = { id, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, grabX: e.clientX - r.left, grabY: e.clientY - r.top, lifted: false, dragged: false, timer: null }
    st.timer = setTimeout(() => {
      if (g.current !== st) return
      st.lifted = true
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
        const n = k < liveOrder.length - 1 ? { id: liveOrder[k + 1], before: true } : { id: liveOrder[k - 1], before: false }
        if (changed && n.id) useAppStore.getState().reorderTabDisplay(sessionId, st.id, n.id, n.before)
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

  return (
    <div className="mobile-tab-cards-sheet">
      <div className="mobile-tab-grid-head">
        <button type="button" className="mobile-chip" aria-label={`Workspace: ${session?.name ?? 'Workspace'}. Switch workspace`} onClick={() => api.push(sessionsView())}>
          <SessionIcon size={16} aria-hidden /> {session?.name ?? 'Workspace'}
        </button>
        <span className="mobile-muted">{all.length} tab{all.length === 1 ? '' : 's'}</span>
        <div className="mobile-tab-grid-head-actions">
          <button type="button" className="mobile-chip" aria-label="Archived tabs" onClick={() => { api.close(); openMore('archive') }}><Archive size={14} aria-hidden /></button>
        </div>
      </div>
      {all.length === 0 && <div className="mobile-empty">No open tabs in this workspace.</div>}
      <div ref={gridRef} className={`mobile-tab-cards${liftedId ? ' is-dragging' : ''}`} data-no-sheet-drag role="list" aria-label="Tabs">
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
          onClick={() => api.push({ key: 'new-tab', title: 'New Tab', expand: true, render: (a) => <NewTabSheet close={a.close} openMore={(r) => { a.close(); openMore(r) }} /> })}>
          <Plus size={24} aria-hidden /><span>New tab</span>
        </button>
      </div>
    </div>
  )
}

/** A tab's actions as a view inside the tab-cards sheet (T23-012). Reordering is the drag; "Move
 *  earlier / later" are its accessible equivalent. Rows that change the list return to the cards. */
function tabActionsView(space: SpaceId, t: Tab): SheetSubView {
  const s = useAppStore.getState()
  const order = workspaceTabs(s.tabs, s.sessionDisplayOrders[s.currentSessionId]).map((x) => x.tab.id)
  const k = order.indexOf(t.id)
  const others = s.sessions.filter((x) => x.id !== s.currentSessionId)
  const st = () => useAppStore.getState()
  return actionListView(`tab-actions-${t.id}`, tabTitle(t), [
    { id: 'rename', label: 'Rename…', stay: true, onSelect: () => { const n = prompt('Tab name', t.title); if (n?.trim()) st().renameTab(space, t.id, n.trim()) } },
    { id: 'duplicate', label: 'Duplicate tab', onSelect: () => { st().addTab({ ...t, id: `${t.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, state: JSON.parse(JSON.stringify(t.state)) }) } },
    { id: 'earlier', label: 'Move earlier', stay: true, disabled: k <= 0, onSelect: () => st().reorderTabDisplay(s.currentSessionId, t.id, order[k - 1], true) },
    { id: 'later', label: 'Move later', stay: true, disabled: k < 0 || k >= order.length - 1, onSelect: () => st().reorderTabDisplay(s.currentSessionId, t.id, order[k + 1], false) },
    ...(others.length ? [{ id: 'move', label: 'Move to workspace', onSelect: () => {}, view: () => actionListView(`tab-move-${t.id}`, 'Move to', others.map((x) => ({ id: x.id, label: x.name, onSelect: () => st().moveTabToSession(space, t.id, x.id) }))) }] : []),
    { id: 'archive', label: 'Archive tab', stay: true, onSelect: () => st().archiveTab(space, t.id) },
    { id: 'close-others', label: 'Close other tabs of this type', stay: true, onSelect: () => { for (const o of st().tabs[space]) if (o.id !== t.id && !o.isPinned && o.type === t.type) st().closeTab(space, o.id) } },
    { id: 'close', label: 'Close tab', destructive: true, stay: true, onSelect: () => st().closeTab(space, t.id) },
  ])
}

/** Workspaces as a view inside the tab-cards sheet (T23-012): "‹ Tabs" returns to the cards; a
 *  workspace's actions and its icon picker go one level deeper in the same sheet. */
function sessionsView(): SheetSubView {
  return {
    key: 'sessions', title: 'Workspaces', expand: true,
    render: (a) => (
      <SessionSwitcher close={() => a.pop()} onActions={(id) => {
        const s = useAppStore.getState()
        const session = s.sessions.find((x) => x.id === id)
        a.push(actionListView(`session-${id}`, session?.name ?? 'Workspace', [
          { id: 'rename', label: 'Rename…', stay: true, onSelect: () => { const n = prompt('Workspace name', session?.name ?? ''); if (n?.trim()) s.renameSession(id, n.trim()) } },
          { id: 'archive-all', label: 'Archive all tabs in this workspace', stay: true, onSelect: () => s.archiveAllTabs(session?.name) },
          { id: 'delete', label: 'Delete workspace', destructive: true, stay: true, disabled: s.sessions.length <= 1, onSelect: () => { if (confirm(`Delete "${session?.name}" and close its tabs?`)) s.deleteSession(id) } },
          { id: 'icon', label: 'Icon', onSelect: () => {}, view: () => actionListView(`session-icon-${id}`, 'Icon', SESSION_ICONS.map((i) => ({ id: i.name, label: i.name, icon: i.Icon, stay: true, onSelect: () => s.setSessionIcon(id, i.name) }))) },
        ]))
      }} />
    ),
  }
}
