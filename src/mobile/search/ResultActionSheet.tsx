import React from 'react'
import { ArrowUpRight, SquarePlus, Hash, Copy, Share2, NotepadText, Highlighter, X, Eraser, BookMarked, type LucideIcon } from 'lucide-react'
import type { HighlightColor, LexiconEntry, Note } from '@/types'
import { useAppStore } from '@/store'
import { bookChapterVerseLabel } from '@/lib/parseRef'
import { buildVerseDisplayText } from '@/lib/verseUtils'
import { copyVerse, copyVerseRef } from '@/lib/verseClipboard'
import { stripMarkdownFormatting } from '@/lib/notePreviewText'
import { HIGHLIGHT_COLOR_IDS, HIGHLIGHT_LABELS, highlightDotColor } from '@/styles/highlightPalette'
import type { ScriptureHit } from '@/lib/scriptureSearch'
import { useActionSheet, type SheetAction } from '../primitives/ActionSheet'
import type { SheetApi } from '../primitives/Sheet'
import { haptic } from '../primitives/haptics'
import { useLongPress } from '../primitives/useLongPress'
import { searchResultActions, type SearchResultActionId, type SearchResultKind } from './resultActions'
import './resultActions.css'

const ICONS: Partial<Record<SearchResultActionId, LucideIcon>> = {
  'open': ArrowUpRight, 'open-new-tab': SquarePlus, 'open-lexicon-tab': BookMarked, 'search-new-tab': SquarePlus,
  'copy-ref': Hash, 'copy-verse': Copy, 'copy-title': Copy, 'copy-strongs': Hash, 'copy-query': Copy,
  'share': Share2, 'add-note': NotepadText, 'highlight': Highlighter, 'cancel': X,
}

async function share(title: string, text: string) {
  const { Share } = await import('@capacitor/share')
  await Share.share({ title, text }).catch(() => {})
}
const copyText = (s: string) => { navigator.clipboard.writeText(s).catch(() => {}); void haptic.success() }

type Handlers = Partial<Record<SearchResultActionId, () => void>>

/** Build the SheetAction list for a result from the pure spec + handlers. */
function toActions(kind: SearchResultKind, handlers: Handlers, highlightView?: SheetAction['view']): SheetAction[] {
  return searchResultActions(kind).map((spec) => ({
    id: spec.id, label: spec.label, icon: ICONS[spec.id],
    onSelect: handlers[spec.id] ?? (() => {}),
    ...(spec.submenu && highlightView ? { view: highlightView } : {}),
  }))
}

/** The highlight colours as a sub-view of the result's sheet ("‹ Genesis 1:1"). */
function HighlightChoices({ hit, api }: { hit: ScriptureHit; api: SheetApi }) {
  const apply = async (color: HighlightColor) => {
    void haptic.light()
    await window.highlights.toggle({ bookId: hit.book_id, chapter: hit.chapter, verseNum: hit.verse_num, color, textId: hit.textId, startChar: 0, endChar: hit.text.length }).catch(() => {})
    useAppStore.getState().bumpHighlightToken()
    api.close()
  }
  const clear = async () => {
    void haptic.light()
    await window.highlights.remove(hit.book_id, hit.chapter, hit.verse_num, hit.textId).catch(() => {})
    useAppStore.getState().bumpHighlightToken()
    api.close()
  }
  return (
    <div className="search-result-highlight">
      <div className="mobile-swatch-row is-scroll" role="group" aria-label="Highlight verse" data-no-sheet-drag>
        {HIGHLIGHT_COLOR_IDS.map((c) => (
          <button key={c} type="button" className="mobile-swatch" style={{ backgroundColor: highlightDotColor(c) }} aria-label={HIGHLIGHT_LABELS[c]} onClick={() => { void apply(c) }} />
        ))}
        <button type="button" className="mobile-swatch is-clear" aria-label="Remove highlight" onClick={() => { void clear() }}><Eraser size={16} aria-hidden /></button>
      </div>
    </div>
  )
}

/**
 * Long-press menus for Search results (SEP24). `openHit` / `openNote` / `openEntry` / `runRecent`
 * are the page's own tap behaviours, so "Open" is exactly what a tap does.
 */
export function useSearchResultActions(page: {
  openHit: (h: ScriptureHit) => void
  openNote: (n: Note) => void
  openEntry: (e: LexiconEntry) => void
  runRecent: (q: string) => void
  scope: 'scripture' | 'notes' | 'lexicon'
}) {
  const sheet = useActionSheet()
  const st = () => useAppStore.getState()

  const scripture = (h: ScriptureHit) => {
    const label = bookChapterVerseLabel(h.book_id, h.chapter, h.verse_num)
    const lxx = h.textId === 'lxx'
    const display = () => buildVerseDisplayText(h.text, h.text_tagged ?? null, h.textId, st().wordReplacerEnabled, st().wordReplacerRules)
    sheet(`search-hit-${h.textId}-${h.book_id}-${h.chapter}-${h.verse_num}`, label, toActions('scripture', {
      'open': () => page.openHit(h),
      'open-new-tab': () => { st().createTab('bible'); page.openHit(h) },
      'copy-ref': () => { copyVerseRef(h.book_id, h.chapter, h.verse_num, lxx); void haptic.success() },
      'copy-verse': () => { copyVerse(h.book_id, h.chapter, h.verse_num, display(), lxx); void haptic.success() },
      'share': () => { void share(label, `${label} ${display()}`) },
      'add-note': () => {
        void window.notes.createNote({ type: 'verse', title: label, verseRef: `${h.book_id}.${h.chapter}.${h.verse_num}`, content: '', textId: h.textId }).then((r) => {
          if (!r.success || !r.note) return
          const s = st()
          s.bumpNoteToken(); s.bumpVerseNoteToken(); void haptic.success()
          s.setActiveSpace('notes'); s.requestOpenNote(r.note.id)
        }).catch(() => {})
      },
    }, () => ({ key: 'highlight', title: 'Highlight', render: (api: SheetApi) => <HighlightChoices hit={h} api={api} /> })))
  }

  const note = (n: Note) => {
    const title = n.title || 'Untitled'
    sheet(`search-note-${n.id}`, title, toActions('note', {
      'open': () => page.openNote(n),
      'open-new-tab': () => { const s = st(); s.createTab('note'); s.requestOpenNote(n.id) },
      'copy-title': () => copyText(title),
      'share': () => { void share(title, `${title}\n\n${stripMarkdownFormatting(n.content ?? '').trim()}`) },
    }))
  }

  const entry = (e: LexiconEntry) => {
    sheet(`search-lex-${e.strongsNum}`, `${e.strongsNum}${e.lemma ? ` · ${e.lemma}` : ''}`, toActions('lexicon', {
      'open': () => page.openEntry(e),
      'open-lexicon-tab': () => { const s = st(); s.createTab('lexicon'); s.openLexiconEntry(e.strongsNum) },
      'copy-strongs': () => copyText(e.strongsNum),
    }))
  }

  const recent = (q: string) => {
    sheet(`search-recent-${q}`, q, toActions('recent', {
      'open': () => page.runRecent(q),
      'search-new-tab': () => {
        const s = st()
        s.createTab('search')
        const id = useAppStore.getState().activeTabId.search
        if (id) { s.updateTabState('search', id, { query: q, scope: page.scope }); s.renameTab('search', id, `“${q}”`) }
      },
      'copy-query': () => copyText(q),
    }))
  }

  return { scripture, note, entry, recent }
}

/** A result row that opens its action sheet on a long press (tap still opens it). The wrapper
 *  blocks text selection / the iOS callout so the press never starts selecting the snippet;
 *  useLongPress swallows the click that follows a completed press. */
export function LongPressResult({ onLongPress, children }: { onLongPress: () => void; children: React.ReactNode }) {
  const lp = useLongPress(() => { void haptic.medium(); onLongPress() })
  return <div className="search-result-lp" {...lp} onContextMenu={(e) => e.preventDefault()}>{children}</div>
}
