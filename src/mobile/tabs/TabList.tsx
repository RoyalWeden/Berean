import React, { useEffect, useRef, useState } from 'react'
import { Pin, Check, Circle, Layers, ChevronRight } from 'lucide-react'
import type { SpaceId, Tab } from '@/types'
import type { TabMatch } from '@/lib/navigation/tabResolution'
import { haptic } from '../primitives/haptics'
import { useLongPress } from '../primitives/useLongPress'
import { tabTextBadge } from './TabPreview'
import { tabKind, tabTitle } from './tabLabels'

/**
 * The iPhone tab switcher's default presentation (QO-003): one compact row per tab — kind icon,
 * title, kind (+ text badge, or "used 5m ago" in Recent), the current tab marked by an accent bar
 * AND "Current" (never colour alone). Closing is iOS's swipe-left → Close (a tap on the revealed
 * button; no full-swipe, so nothing closes by accident); long press → the tab's actions; a hidden
 * "Actions" button for VoiceOver / Switch Control. Select mode shows checkboxes instead.
 */
export interface TabListItem { space: SpaceId; tab: Tab }

const REVEAL = 84

export function TabList({ items, isActive, onOpen, onClose, onActions, selecting, selected, onToggle, lastUsed }: {
  items: TabListItem[]
  isActive: (space: SpaceId, id: string) => boolean
  onOpen: (space: SpaceId, id: string) => void
  onClose: (space: SpaceId, id: string) => void
  onActions: (space: SpaceId, tab: Tab) => void
  selecting: boolean
  selected: ReadonlySet<string>
  onToggle: (id: string) => void
  /** Recent sort: epoch ms of last use, shown as "5m ago". */
  lastUsed?: (space: SpaceId, id: string) => number | undefined
}) {
  const [openRow, setOpenRow] = useState<string | null>(null)
  useEffect(() => { if (selecting) setOpenRow(null) }, [selecting])
  const listRef = useRef<HTMLDivElement>(null)
  // Show the current tab's row when the switcher opens.
  useEffect(() => {
    listRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [])
  return (
    <div ref={listRef} className="m-tablist" role="list" aria-label="Tabs">
      {items.map(({ space, tab }) => (
        <TabRow key={tab.id} space={space} tab={tab} active={isActive(space, tab.id)}
          open={openRow === tab.id} setOpen={(v) => setOpenRow(v ? tab.id : null)}
          onOpen={() => { if (openRow) { setOpenRow(null); return } onOpen(space, tab.id) }}
          onClose={() => { setOpenRow(null); onClose(space, tab.id) }}
          onActions={() => { setOpenRow(null); onActions(space, tab) }}
          selecting={selecting} checked={selected.has(tab.id)} onToggle={() => onToggle(tab.id)}
          used={lastUsed?.(space, tab.id)} />
      ))}
    </div>
  )
}

function TabRow({ tab, active, open, setOpen, onOpen, onClose, onActions, selecting, checked, onToggle, used }: {
  space: SpaceId; tab: Tab; active: boolean; open: boolean; setOpen: (v: boolean) => void
  onOpen: () => void; onClose: () => void; onActions: () => void
  selecting: boolean; checked: boolean; onToggle: () => void; used?: number
}) {
  const K = tabKind(tab)
  const title = tabTitle(tab)
  const badge = tabTextBadge(tab)
  const closable = !tab.isPinned
  const [dx, setDx] = useState(0)
  // The Close button exists only while revealed: rows are translucent glass, so a button parked
  // underneath would show through every row.
  const [swiping, setSwiping] = useState(false)
  const drag = useRef<{ x: number; y: number; base: number; horizontal: boolean | null } | null>(null)
  const lp = useLongPress(() => { if (!selecting && !drag.current?.horizontal) { void haptic.medium(); onActions() } })
  const offset = drag.current?.horizontal ? dx : open ? -REVEAL : 0

  const down = (e: React.PointerEvent) => {
    lp.onPointerDown(e)
    if (selecting || !closable) return
    drag.current = { x: e.clientX, y: e.clientY, base: open ? -REVEAL : 0, horizontal: null }
  }
  const move = (e: React.PointerEvent) => {
    lp.onPointerMove(e)
    const d = drag.current
    if (!d) return
    const mx = e.clientX - d.x, my = e.clientY - d.y
    if (d.horizontal === null && (Math.abs(mx) > 10 || Math.abs(my) > 10)) d.horizontal = Math.abs(mx) > Math.abs(my) * 1.4
    if (d.horizontal && !swiping) setSwiping(true)
    if (d.horizontal) setDx(Math.max(-REVEAL * 1.25, Math.min(0, d.base + mx)))
  }
  const up = () => {
    lp.onPointerUp()
    const d = drag.current
    drag.current = null
    if (d?.horizontal) {
      const reveal = dx < -REVEAL / 2
      if (reveal !== open) void haptic.selection()
      setOpen(reveal)
      setDx(0)
      setSwiping(false)
    }
  }
  // "Lexicon — Lexicon": an untitled tab is named by its kind already.
  const kindLine = title === K.label ? '' : K.label
  const sub = used != null ? [kindLine, ago(used)].filter(Boolean).join(' · ') : kindLine

  return (
    <div className={`m-tabrow${active ? ' is-active' : ''}${open ? ' is-open' : ''}`} role="listitem">
      {closable && !selecting && (open || swiping) && (
        <button type="button" className="m-tabrow-close" tabIndex={open ? 0 : -1} aria-hidden={!open || undefined} onClick={() => { void haptic.light(); onClose() }}>Close</button>
      )}
      <div className="m-tabrow-slide" style={{ transform: `translateX(${offset}px)`, transition: drag.current?.horizontal ? 'none' : undefined }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={lp.onPointerLeave} onClickCapture={lp.onClickCapture}>
        <button type="button" className="m-tabrow-main" onClick={() => (selecting ? onToggle() : onOpen())}
          aria-current={active ? 'true' : undefined} aria-pressed={selecting ? checked : undefined}
          aria-label={`${K.label}: ${title}${badge ? `, ${badge}` : ''}${active ? ', current tab' : ''}${tab.isPinned ? ', pinned' : ''}`}>
          {selecting && (
            <span className={`m-tabrow-check${checked ? ' is-on' : ''}`} aria-hidden>{checked ? <Check size={14} strokeWidth={3} /> : <Circle size={22} strokeWidth={1.5} />}</span>
          )}
          <span className="m-tabrow-icon" aria-hidden><K.icon size={18} /></span>
          <span className="m-tabrow-text">
            <span className="m-tabrow-title">{title}</span>
            {(sub || badge) && <span className="m-tabrow-sub">{sub}{badge ? <span className="m-tabrow-badge">{badge}</span> : null}</span>}
          </span>
          {tab.isPinned && <Pin size={13} aria-hidden className="m-tabrow-pin" />}
          {active && <span className="m-tabrow-current" aria-hidden>Current</span>}
        </button>
        {!selecting && <button type="button" className="mobile-sr-only" aria-label={`Actions for ${title}`} onClick={onActions}>Actions</button>}
        {!selecting && closable && <button type="button" className="mobile-sr-only" aria-label={`Close ${title}`} onClick={onClose}>Close</button>}
      </div>
    </div>
  )
}

/** Matches in OTHER sessions for the tab search: tap switches to that session and the tab. */
export function OtherSessionMatches({ matches, onPick }: { matches: TabMatch[]; onPick: (m: TabMatch) => void }) {
  if (!matches.length) return null
  return (
    <section className="m-tablist-other" aria-label="In other sessions">
      <h3 className="m-tablist-head">In other sessions</h3>
      <div className="m-tablist" role="list">
        {matches.map((m) => {
          const K = tabKind(m.tab)
          const title = tabTitle(m.tab)
          return (
            <div key={`${m.sessionId}|${m.tab.id}`} className="m-tabrow" role="listitem">
              <div className="m-tabrow-slide">
                <button type="button" className="m-tabrow-main" onClick={() => onPick(m)} aria-label={`${K.label}: ${title}, in ${m.sessionName}. Switch to that session`}>
                  <span className="m-tabrow-icon" aria-hidden><K.icon size={18} /></span>
                  <span className="m-tabrow-text">
                    <span className="m-tabrow-title">{title}</span>
                    <span className="m-tabrow-sub"><Layers size={11} aria-hidden /> {m.sessionName}</span>
                  </span>
                  <ChevronRight size={16} aria-hidden className="m-tabrow-chevron" />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

export function ago(t: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  return d < 7 ? `${d}d ago` : `${Math.round(d / 7)}w ago`
}
