import React, { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Note } from '@/types'

/**
 * The Notes Home note list, windowed (TEST 2026-10-17 "when i click on all notes it takes a few
 * seconds to actually open"). All Notes used to mount every row: 3,865 swipeable rows, ~38,000 DOM
 * nodes and ~25 markdown regexes per row, 675 ms of main thread on the simulator before the first
 * frame. Now only the rows near the viewport exist; the rest is a correctly sized spacer.
 *
 * It keeps the grouped-card look: each section is a header plus a run of rows that together draw
 * one rounded card (`is-first` / `is-last` round the corners, rows below the first draw the
 * separator), so nothing changes visually. The scroller is the page body (the whole page scrolls
 * as one, large title included); `scrollMargin` is where this list starts inside it.
 */
export interface NoteListSection {
  id: string
  title: string
  notes: Note[]
  /** Collapsible date / group header (folder views). Static titles (search) can't collapse. */
  collapsible?: boolean
  collapsed?: boolean
  /** No header at all (a single unnamed run). */
  bare?: boolean
}

type Item =
  | { kind: 'header'; key: string; section: NoteListSection; first: boolean }
  | { kind: 'row'; key: string; note: Note; first: boolean; last: boolean }
  | { kind: 'cards'; key: string; notes: Note[]; first: boolean }

/** Gallery grid geometry (notesHome.css `.m-notes-gallery`: auto-fill, minmax(150px, 1fr), 14px gap). */
const CARD_MIN_W = 150
const CARD_GAP_X = 14
export function galleryColumns(width: number): number {
  return Math.max(1, Math.floor((width + CARD_GAP_X) / (CARD_MIN_W + CARD_GAP_X)))
}

export function flattenSections(sections: readonly NoteListSection[], layout: 'list' | 'gallery', columns: number): Item[] {
  const out: Item[] = []
  sections.forEach((s, si) => {
    if (!s.bare) out.push({ kind: 'header', key: `h:${s.id}`, section: s, first: si === 0 })
    if (s.collapsed) return
    if (layout === 'gallery') {
      for (let i = 0; i < s.notes.length; i += columns) out.push({ kind: 'cards', key: `c:${s.id}:${s.notes[i].id}`, notes: s.notes.slice(i, i + columns), first: i === 0 })
    } else {
      s.notes.forEach((n, i) => out.push({ kind: 'row', key: `r:${s.id}:${n.id}`, note: n, first: i === 0, last: i === s.notes.length - 1 }))
    }
  })
  return out
}

export function VirtualNoteList({ sections, layout, renderHeader, renderRow, renderCard, estimateRow = 78 }: {
  sections: readonly NoteListSection[]
  layout: 'list' | 'gallery'
  renderHeader: (s: NoteListSection) => React.ReactNode
  renderRow: (n: Note) => React.ReactNode
  renderCard: (n: Note) => React.ReactNode
  estimateRow?: number
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const [scroller, setScroller] = useState<HTMLElement | null>(null)
  const [margin, setMargin] = useState(0)
  const [width, setWidth] = useState(0)
  const measureRef = useRef<(() => void) | null>(null)

  // The scroller and this list's offset in it (everything above it — large title, subfolders —
  // scrolls with the page). Re-measured when the page body or the content above changes size.
  useLayoutEffect(() => {
    const el = listRef.current
    const sc = el?.closest('.mobile-page-body') as HTMLElement | null
    if (!el || !sc) return
    setScroller(sc)
    const measure = () => {
      const top = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop
      setMargin((m) => (Math.abs(m - top) > 0.5 ? top : m))
      setWidth((w) => (Math.abs(w - el.clientWidth) > 0.5 ? el.clientWidth : w))
    }
    measureRef.current = measure
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(sc)
    return () => { ro.disconnect(); measureRef.current = null }
  }, [])
  // Content above the list (large title, subtitle, subfolders) can change on any render.
  useLayoutEffect(() => { measureRef.current?.() })

  const columns = layout === 'gallery' ? galleryColumns(width || 360) : 1
  const items = useMemo(() => flattenSections(sections, layout, columns), [sections, layout, columns])
  const cardRowH = useMemo(() => {
    const cardW = width ? (width - CARD_GAP_X * (columns - 1)) / columns : 160
    return Math.round(cardW * 1.3 + 44 + 16)
  }, [width, columns])

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scroller,
    estimateSize: (i) => (items[i].kind === 'header' ? (items[i].first ? 34 : 56) : items[i].kind === 'cards' ? cardRowH : estimateRow),
    getItemKey: (i) => items[i].key,
    overscan: 10,
    scrollMargin: margin,
  })

  const renderItem = (it: Item) => it.kind === 'header' ? renderHeader(it.section)
    : it.kind === 'row' ? renderRow(it.note)
    : <div className="m-notes-gallery" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>{it.notes.map((n) => <div key={n.id}>{renderCard(n)}</div>)}</div>
  const clsOf = (it: Item) => it.kind === 'header' ? `m-vlist-item is-header${it.first ? ' is-first' : ''}`
    : it.kind === 'row' ? `m-vlist-item is-row${it.first ? ' is-first' : ''}${it.last ? ' is-last' : ''}`
    : `m-vlist-item is-cards${it.first ? ' is-first' : ''}`

  // First render: the scroller is found in the layout effect above, before the first paint — render
  // the empty container only (rendering everything here was the whole cost of opening All Notes).
  if (!scroller) return <div ref={listRef} className="m-vlist" role="list" />
  // No measurable viewport (no layout engine — tests): the same items in normal flow, unwindowed.
  if (scroller.clientHeight === 0) {
    return (
      <div ref={listRef} className="m-vlist" role="list">
        {items.map((it) => <div key={it.key} className={clsOf(it)} role={it.kind === 'header' ? undefined : 'listitem'}>{renderItem(it)}</div>)}
      </div>
    )
  }

  const virtual = virtualizer.getVirtualItems()
  return (
    <div ref={listRef} className="m-vlist" role="list" style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
      {virtual.map((v) => {
        const it = items[v.index]
        return (
          <div key={v.key} data-index={v.index} ref={virtualizer.measureElement} className={clsOf(it)}
            role={it.kind === 'header' ? undefined : 'listitem'}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${v.start - margin}px)` }}>
            {renderItem(it)}
          </div>
        )
      })}
    </div>
  )
}
