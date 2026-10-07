import React, { useEffect, useState } from 'react'
import { ChevronDown, ArrowUpRight, SquarePlus, Hash, Copy } from 'lucide-react'
import { useAppStore } from '@/store'
import { bookChapterVerseLabel, bookName } from '@/lib/parseRef'
import { displayChapter } from '@/lib/chapterNumbering'
import { copyVerse, copyVerseRef } from '@/lib/verseClipboard'
import { useScriptureText } from '@/lib/scriptureText'
import { loadChapterXRefs, normalizeVerseXRefs, resolveXRefTexts, type XRefItem, type XRefResult, type XRefSource } from '@/lib/crossRefs/xrefModel'
import type { NavIntent } from '@/lib/navigation/destination'
import { useActionSheet } from '../primitives/ActionSheet'
import { useLongPress } from '../primitives/useLongPress'
import { haptic } from '../primitives/haptics'
import { useVerseCrossRefs, type CrossRefSourceId } from './useVerseCrossRefs'
import './xrefs.css'

/**
 * Cross references as cards (XREF-002) — the ONE presentation every iPhone surface uses (caret
 * Cross References and My Notes, verse sheet, selection sheet, multi-verse sheet, study view).
 *
 * A card reads as one flowing paragraph: **Romans 5:8** — the full verse text. Long passages and
 * ranges are clamped to a few lines; the whole text is always there (no "Show full verse" link).
 *   tap the reference            → open it in THIS tab (the caret / sheet context's own tab)
 *   tap the text / the chevron   → expand or collapse the card in place
 *   long press                   → Open · Open in New Tab · Copy Reference · Copy Verse
 * Variants only change density: `compact` (caret), `regular` (sheets).
 */
export type XRefVariant = 'compact' | 'regular'
export type XRefOpen = (item: XRefItem, intent: Extract<NavIntent, 'current-tab' | 'new-tab'>) => void

export function xrefLabel(i: Pick<XRefItem, 'bookId' | 'chapter' | 'verse' | 'endVerse' | 'lxx'>): string {
  const base = i.verse
    ? `${bookChapterVerseLabel(i.bookId, i.chapter, i.verse)}${i.endVerse && i.endVerse !== i.verse ? `–${i.endVerse}` : ''}`
    : `${bookName(i.bookId)} ${displayChapter(i.bookId, i.chapter)}`
  return i.lxx ? `${base} LXX` : base
}

const SOURCE_LABEL: Record<XRefSource, string> = { tske: 'TSK/e', classic: 'Classic', notes: 'My Notes', taylor: 'Taylor' }
/** Clamp only what is long enough to need it (≈ three phone lines). */
const LONG = 150

export function XRefCard({ item, variant = 'regular', onOpen, showSource }: { item: XRefItem; variant?: XRefVariant; onOpen: XRefOpen; showSource?: boolean }) {
  const [open, setOpen] = useState(false)
  const actions = useActionSheet()
  const { displayVerseText } = useScriptureText()
  const label = xrefLabel(item)
  const displayText = item.text ? displayVerseText(item.text, item.textTagged ?? null, item.textId ?? 'kjv') : item.text
  const long = (displayText?.length ?? 0) > LONG || (!!item.endVerse && item.endVerse > item.verse)
  const lp = useLongPress(() => {
    void haptic.medium()
    actions(`xref-${item.key}`, label, [
      { id: 'open', label: 'Open', icon: ArrowUpRight, onSelect: () => onOpen(item, 'current-tab') },
      { id: 'new-tab', label: 'Open in New Tab', icon: SquarePlus, onSelect: () => onOpen(item, 'new-tab') },
      { id: 'copy-ref', label: 'Copy Reference', icon: Hash, onSelect: () => { copyVerseRef(item.bookId, item.chapter, item.verse || 1, !!item.lxx, item.endVerse ?? undefined); void haptic.success() } },
      ...(displayText ? [{ id: 'copy-verse', label: item.endVerse && item.endVerse > item.verse ? 'Copy Verses' : 'Copy Verse', icon: Copy, onSelect: () => { copyVerse(item.bookId, item.chapter, item.verse || 1, displayText!, !!item.lxx, item.endVerse ?? undefined); void haptic.success() } }] : []),
    ])
  })
  const meta = [
    item.isCurrent ? 'This verse' : null,
    item.fromVerses.length > 1 ? `v. ${item.fromVerses.join(', ')}` : null,
    item.noteTitle ? (item.noteRole === 'cites' ? `${item.noteTitle} cites this chapter` : item.noteTitle) : null,
    showSource ? SOURCE_LABEL[item.source] : null,
  ].filter(Boolean) as string[]
  return (
    <div className={`m-xref is-${variant}${item.isCurrent ? ' is-current' : ''}${open ? ' is-open' : ''}`} role="listitem" {...lp} onContextMenu={(e) => e.preventDefault()}>
      <p className={`m-xref-body${long && !open ? ' is-clamped' : ''}`}>
        <button type="button" className="m-xref-ref" onClick={() => { void haptic.light(); onOpen(item, 'current-tab') }} aria-label={`Open ${label}`}>{label}</button>
        {displayText
          ? <span className="m-xref-text" role={long ? 'button' : undefined} tabIndex={long ? 0 : undefined} aria-expanded={long ? open : undefined}
              aria-label={long ? `${open ? 'Collapse' : 'Expand'} the text of ${label}` : undefined}
              onClick={long ? () => setOpen((o) => !o) : undefined}
              onKeyDown={long ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((o) => !o) } } : undefined}>{' — '}{displayText}</span>
          : !item.verse ? <span className="m-xref-text is-muted"> — whole chapter</span> : null}
      </p>
      {(long || meta.length > 0) && (
        <div className="m-xref-foot">
          {meta.length > 0 && <span className="m-xref-meta">{meta.join(' · ')}</span>}
          {long && (
            <button type="button" className="m-xref-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={open ? `Collapse ${label}` : `Show all of ${label}`}>
              <ChevronDown size={16} aria-hidden />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** Sections of cards (TSK/e headings, "v. 5" for a selection, note groups), plus "Mentioned in". */
export function XRefList({ result, variant = 'regular', onOpen, showSource, empty }: {
  result: XRefResult | null; variant?: XRefVariant; onOpen: XRefOpen; showSource?: boolean; empty?: string
}) {
  if (!result) return <div className="mobile-muted mobile-study-pad">Loading…</div>
  if (result.total === 0 && result.mentions.length === 0) return <div className="mobile-muted mobile-study-pad">{empty ?? 'No cross references.'}</div>
  return (
    <div className={`m-xref-list is-${variant}`}>
      {result.sections.map((s) => (
        <section key={s.id} className="m-xref-section" aria-label={s.heading ?? 'Cross references'}>
          {s.heading && <h4 className="m-xref-heading">{s.heading}</h4>}
          <div role="list">{s.items.map((i) => <XRefCard key={i.key} item={i} variant={variant} onOpen={onOpen} showSource={showSource} />)}</div>
        </section>
      ))}
      {result.mentions.length > 0 && (
        <section className="m-xref-section" aria-label="Mentioned in">
          <h4 className="m-xref-heading">Mentioned in</h4>
          <p className="m-xref-mentions">{result.mentions.join(' · ')}</p>
        </section>
      )}
    </div>
  )
}

/**
 * The shared query (XREF-001): verse context → the chosen source's references for the selected
 * verses (de-duplicated); chapter context (no verse) → the chapter-level references. Texts are
 * resolved in one batch, off the render path; the list shows as soon as the references are known
 * and fills in texts that needed a lookup.
 */
export function useXRefs(ctx: { bookId: string; chapter: number; verses: readonly number[]; textId: string }, source: CrossRefSourceId): XRefResult | null {
  const chapterMode = ctx.verses.length === 0
  const raw = useVerseCrossRefs(ctx.bookId, ctx.chapter, chapterMode ? [] : ctx.verses, ctx.textId, source)
  const token = useAppStore((s) => s.noteChangeToken)
  const [result, setResult] = useState<XRefResult | null>(null)
  const key = `${ctx.bookId}.${ctx.chapter}.${ctx.verses.join(',')}.${ctx.textId}.${source}`
  useEffect(() => {
    let alive = true
    const finish = async (base: XRefResult) => {
      if (!alive) return
      setResult(base)
      const all = base.sections.flatMap((s) => s.items)
      if (!all.some((i) => !i.text && i.verse)) return
      const resolved = new Map((await resolveXRefTexts(all)).map((i) => [i.key, i]))
      if (alive) setResult({ ...base, sections: base.sections.map((s) => ({ ...s, items: s.items.map((i) => resolved.get(i.key) ?? i) })) })
    }
    if (chapterMode) {
      setResult(null)
      void loadChapterXRefs(ctx.bookId, ctx.chapter, ctx.textId, token).then(finish).catch(() => { if (alive) setResult({ sections: [], mentions: [], total: 0 }) })
    } else if (raw) {
      void finish(normalizeVerseXRefs(raw, source, ctx))
    } else setResult(null)
    return () => { alive = false }
  }, [key, raw, token]) // eslint-disable-line react-hooks/exhaustive-deps
  return result
}
