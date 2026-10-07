import React from 'react'
import { BookOpen, Library, Hash, NotepadText, ChevronRight, Loader2 } from 'lucide-react'
import type { LexiconEntry, Note } from '@/types'
import { bookChapterVerseLabel } from '@/lib/parseRef'
import { TRANSLATIONS } from '@/lib/bibleTexts'
import { applyFindHighlight } from '@/lib/highlight'
import { buildAllWordsSnippet } from '@/components/bible/ScriptureSearchView'
import { stripMarkdownFormatting } from '@/lib/notePreviewText'
import { useScriptureText, displayHitText } from '@/lib/scriptureText'
import type { ScriptureHit } from '@/lib/scriptureSearch'
import type { WordMode } from '@/lib/scriptureHighlight'
import { hitSourceLabel, type GoToItem, type UnifiedResults as Results, type UnifiedScope } from '@/lib/search/unifiedSearch'
import { LongPressResult } from './ResultActionSheet'
import { displayNoteTitle } from '@/lib/noteTitle'

/** What a row opens — the surface decides WHERE (current tab / new tab). */
export type UnifiedPick =
  | { kind: 'goto'; item: GoToItem }
  | { kind: 'verse'; hit: ScriptureHit }
  | { kind: 'entry'; entry: LexiconEntry }
  | { kind: 'note'; note: Note }

/** Rows per group before "All N …" (the group's full list opens in the Search tab / scope). */
const GROUP_ROWS = { verses: 8, entries: 4, notes: 4 }

/**
 * Search results grouped like the desktop's Floating Search (Go to · Verses · Lexicon · Notes —
 * the same group names, order and source badges), as iPhone inset-grouped rows (SRCH-004). Shared
 * by the plus / caret search sheet and the Search tab's "All" scope. Tap = the surface's open;
 * long press = its alternatives (e.g. Open in New Tab).
 */
export function UnifiedResultsList({ results, query, wordMode, loading, onPick, onLongPick, onSeeAll, full = false }: {
  results: Results | null
  query: string
  wordMode: WordMode
  loading?: boolean
  onPick: (p: UnifiedPick) => void
  onLongPick?: (p: UnifiedPick) => void
  /** "All N verses / entries / notes": the complete list of one group. */
  onSeeAll: (scope: Exclude<UnifiedScope, 'all'>) => void
  /** Inside the Search tab: groups show more rows. */
  full?: boolean
}) {
  const { displayVerseText } = useScriptureText()
  if (!results) return loading ? <SearchStatus loading /> : null
  const { goTo, verses, entries, notes, intent } = results
  const text = intent.text
  const rows = (n: number) => (full ? n * 3 : n)
  const empty = goTo.length === 0 && !verses?.length && !entries?.length && !notes?.length
  const wrap = (p: UnifiedPick, node: React.ReactNode, key: string) =>
    onLongPick ? <LongPressResult key={key} onLongPress={() => onLongPick(p)}>{node}</LongPressResult> : <React.Fragment key={key}>{node}</React.Fragment>

  return (
    <div className="m-usearch" aria-busy={loading || undefined}>
      {loading && <SearchStatus loading />}
      {goTo.length > 0 && (
        <Group title="Go to">
          {goTo.map((g, i) => wrap({ kind: 'goto', item: g }, (
            <Row icon={g.kind === 'strongs' ? Hash : g.kind === 'notes' ? NotepadText : g.kind === 'passage' ? BookOpen : Library} primary={i === 0}
              title={g.label} meta={g.subtitle} onClick={() => onPick({ kind: 'goto', item: g })} />
          ), g.key))}
        </Group>
      )}
      {verses && verses.length > 0 && (
        <Group title="Verses" count={verses.length}>
          {verses.slice(0, rows(GROUP_ROWS.verses)).map((h) => {
            const hText = displayHitText(h)
            return wrap({ kind: 'verse', hit: h }, (
              <Row icon={BookOpen} onClick={() => onPick({ kind: 'verse', hit: h })}
                title={<>{bookChapterVerseLabel(h.book_id, h.chapter, h.verse_num)}{sourceBadge(h.textId)}</>}
                sub={applyFindHighlight(buildAllWordsSnippet(hText, text, 110).text, h.strongsWords ? '' : text, wordMode)} />
            ), `${h.textId}-${h.book_id}-${h.chapter}-${h.verse_num}`)
          })}
          {verses.length > rows(GROUP_ROWS.verses) && <SeeAll label={`All ${verses.length} verses`} onClick={() => onSeeAll('scripture')} />}
        </Group>
      )}
      {entries && entries.length > 0 && (
        <Group title="Lexicon" count={entries.length}>
          {entries.slice(0, rows(GROUP_ROWS.entries)).map((e) => wrap({ kind: 'entry', entry: e }, (
            <Row icon={Hash} onClick={() => onPick({ kind: 'entry', entry: e })}
              title={<><span className="mobile-strongs-num">{e.strongsNum}</span> {e.lemma} <span className="mobile-muted">{e.transliteration}</span></>}
              sub={e.gloss ?? undefined} />
          ), e.strongsNum))}
          {entries.length > rows(GROUP_ROWS.entries) && <SeeAll label={`All ${entries.length} entries`} onClick={() => onSeeAll('lexicon')} />}
        </Group>
      )}
      {notes && notes.length > 0 && (
        <Group title="Notes" count={notes.length}>
          {notes.slice(0, rows(GROUP_ROWS.notes)).map((n) => wrap({ kind: 'note', note: n }, (
            <Row icon={NotepadText} onClick={() => onPick({ kind: 'note', note: n })} title={displayNoteTitle(n.title)}
              sub={applyFindHighlight(stripMarkdownFormatting(n.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 110), text, wordMode)} />
          ), n.id))}
          {notes.length > rows(GROUP_ROWS.notes) && <SeeAll label={`All ${notes.length} notes`} onClick={() => onSeeAll('notes')} />}
        </Group>
      )}
      {empty && !loading && <div className="mobile-empty">Nothing matches “{query.trim()}”.</div>}
    </div>
  )
}

function sourceBadge(textId: string) {
  const l = hitSourceLabel(textId, TRANSLATIONS)
  return l ? <span className="m-usearch-badge">{l}</span> : null
}

function Group({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="mobile-newtab-section" aria-label={title}>
      <div className="mobile-newtab-section-head"><h3>{title}{count != null ? <span className="m-usearch-count"> · {count}</span> : null}</h3></div>
      <div className="mobile-newtab-list">{children}</div>
    </section>
  )
}

function Row({ icon: Icon, title, sub, meta, primary, onClick }: { icon: typeof BookOpen; title: React.ReactNode; sub?: React.ReactNode; meta?: string; primary?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`mobile-newtab-row${primary ? ' is-primary' : ''}`} onClick={onClick}>
      <span className="mobile-newtab-row-icon"><Icon size={18} aria-hidden /></span>
      <span className="mobile-newtab-row-text"><span>{title}</span>{sub != null && sub !== '' && <small className="m-usearch-snippet">{sub}</small>}</span>
      {meta && <span className="mobile-newtab-row-meta">{meta}</span>}
    </button>
  )
}

function SeeAll({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="mobile-newtab-row m-usearch-all" onClick={onClick}>
      <span className="mobile-newtab-row-icon" />
      <span className="mobile-newtab-row-text"><span>{label}</span></span>
      <ChevronRight size={17} aria-hidden className="m-usearch-chevron" />
    </button>
  )
}

export function SearchStatus({ loading }: { loading?: boolean }) {
  return loading ? <div className="m-usearch-status" role="status"><Loader2 size={15} aria-hidden className="m-usearch-spin" /> Searching…</div> : null
}
