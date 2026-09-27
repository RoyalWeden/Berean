import React, { useEffect, useState } from 'react'
import { History, Search, Youtube, Tags, FileText, NotepadText, BookMarked, Clock } from 'lucide-react'
import { useAppStore } from '@/store'
import type { BibleTabState, LexiconEntry, LexiconTabState, Note, Tab, Verse, SearchTabState, YouTubeTabState, PdfTabState, CalendarTabState } from '@/types'
import { getTranslationForBook } from '@/lib/parseRef'
import { stripMarkdownFormatting } from '@/lib/notePreviewText'
import { buildVerseDisplayText } from '@/lib/verseUtils'
import { TRANSLATIONS } from '@/lib/bibleTexts'
import { themePresetLabel } from '../settings/ThemePresetPage'
import { monthFromKey, monthGrid, monthLabel } from '@/lib/calendarModel'
import { dailyNoteToday, toDateKey } from '@/lib/dailyNoteUtils'
import { useDailyNoteDates } from '../calendar/useDailyNoteDates'
import type { SearchPreviewSummary } from '../search/resultActions'
import './tabPreview.css'
import { readerScrollMemory } from '../reader/readerScrollMemory'
import { columnsForState, translationLabel } from '../reader/compareState'

/**
 * What a tab card shows (T23-011): a small, REAL preview of the tab's last state — never a
 * screenshot. Scripture shows the passage text from where the tab was being read, a note its
 * title and text, a search its query, YouTube the video's thumbnail, Lexicon the entry, History
 * the latest entries, Settings a miniature of its root list with current values. Search shows
 * the query and the top results from the summary SearchPage saves into the tab (`state.preview`,
 * LOCAL — never synced); no search runs for a card. Data comes from the same local services the tab
 * uses, fetched once per card and cached for the session (cards are only mounted while the tab
 * cards sheet is open), so rendering previews never touches or resets the tab itself.
 */
export function TabPreview({ tab }: { tab: Tab }) {
  switch (tab.type) {
    case 'bible': return (tab.state as BibleTabState).compareMode ? <ComparePreview tab={tab} /> : <ScripturePreview tab={tab} />
    case 'note': return <NotePreview tab={tab} />
    case 'search': return <SearchPreview state={tab.state as SearchTabState} />
    case 'lexicon': return <LexiconPreview state={tab.state as LexiconTabState} />
    case 'youtube': return <YouTubePreview state={tab.state as YouTubeTabState} />
    case 'history': return <HistoryPreview />
    case 'settings': return <SettingsPreview />
    case 'calendar': return <CalendarPreview state={tab.state as CalendarTabState} />
    case 'pdf': return <IconPreview icon={FileText} lines={[(tab.state as PdfTabState).title, (tab.state as PdfTabState).page ? `Page ${(tab.state as PdfTabState).page}` : '']} />
    case 'tags': return <IconPreview icon={Tags} lines={['Verse tags', 'Tag graph']} />
    default: return null
  }
}

/** The only translation worth naming on a tab: the Septuagint (KJV is the default — T23-007). */
export function tabTextBadge(tab: Tab): string | null {
  if (tab.type !== 'bible') return null
  const st = tab.state as BibleTabState
  if (st.compareMode) return null
  const t = (st.translation ?? getTranslationForBook(st.bookId) ?? 'KJVA').toLowerCase()
  return t === 'lxx' ? 'LXX' : null
}

// ── session cache of preview data ──────────────────────────────────────────────────────────
const cache = new Map<string, unknown>()
function useCached<T>(key: string | null, load: () => Promise<T>): T | undefined {
  const [v, setV] = useState<T | undefined>(() => (key ? (cache.get(key) as T | undefined) : undefined))
  useEffect(() => {
    if (!key) { setV(undefined); return }
    if (cache.has(key)) { setV(cache.get(key) as T); return }
    let alive = true
    load().then((r) => { cache.set(key, r); if (alive) setV(r) }).catch(() => {})
    return () => { alive = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return v
}

function versesFrom(verses: Verse[] | undefined, start: number, n: number): Verse[] {
  if (!verses) return []
  const i = Math.max(0, verses.findIndex((v) => v.verse_num >= start))
  return verses.slice(i, i + n)
}

/** Verses as the reader shows them (word replacer applied — e.g. the divine-name rules). */
function VerseLines({ verses, textId }: { verses: Verse[]; textId: string }) {
  const enabled = useAppStore((s) => s.wordReplacerEnabled)
  const rules = useAppStore((s) => s.wordReplacerRules)
  return (
    <p className="mobile-tab-preview-text">
      {verses.map((v) => (
        <span key={v.verse_num}><sup>{v.verse_num}</sup>{buildVerseDisplayText(v.text, (v as Verse & { text_tagged?: string | null }).text_tagged ?? null, textId, enabled, rules)} </span>
      ))}
    </p>
  )
}

function ScripturePreview({ tab }: { tab: Tab }) {
  const st = tab.state as BibleTabState
  const textId = (st.translation ?? getTranslationForBook(st.bookId) ?? 'KJVA').toLowerCase()
  // Where the tab was being read: its remembered verse anchor (this device), else its target verse.
  // Continuous scroll can leave the top-most verse in the neighbouring chapter (the anchor is
  // keyed by tab id, in memory for the session) — trust it within ±1 chapter, else the tab state.
  const saved = readerScrollMemory.restore(tab.id, st.bookId)
  const anchor = saved && Math.abs(saved.chapter - st.chapter) <= 1 ? saved : undefined
  const chapter = anchor?.chapter ?? st.chapter
  const from = anchor?.verse ?? st.targetVerse ?? st.verse ?? 1
  const verses = useCached(`ch:${textId}:${st.bookId}:${chapter}`, () => window.bible.queryChapter(st.bookId, chapter, textId))
  return (
    // The card header already names the passage; the preview is the text itself (no repeat).
    <div className="mobile-tab-preview is-scripture">
      <VerseLines verses={versesFrom(verses, from, 6)} textId={textId} />
    </div>
  )
}

function ComparePreview({ tab }: { tab: Tab }) {
  const cols = columnsForState(tab.state as BibleTabState)
  const [a, b] = cols ?? []
  const left = useCached(a ? `ch:${a.textId}:${a.bookId}:${a.chapter}` : null, () => window.bible.queryChapter(a!.bookId, a!.chapter, a!.textId))
  const right = useCached(b ? `ch:${b.textId}:${b.bookId}:${b.chapter}` : null, () => window.bible.queryChapter(b!.bookId, b!.chapter, b!.textId))
  if (!a || !b) return <IconPreview icon={BookMarked} lines={['Compare']} />
  return (
    <div className="mobile-tab-preview is-compare">
      <div className="mobile-tab-preview-cols">
        {[{ c: a, v: left }, { c: b, v: right }].map(({ c, v }) => (
          <div key={c.textId}>
            <small>{translationLabel(c.textId)}</small>
            <VerseLines verses={versesFrom(v, 1, 3)} textId={c.textId} />
          </div>
        ))}
      </div>
    </div>
  )
}

function NotePreview({ tab }: { tab: Tab }) {
  const id = (tab.state as { noteId?: string | null }).noteId ?? null
  // Keyed by the notes change token, so an edited note never previews stale text.
  const token = useAppStore((s) => s.noteChangeToken)
  const note = useCached<Note | null>(id ? `note:${id}:${token}` : null, () => window.notes.getNote(id!))
  if (!id) return <NotesHomePreview token={token} />
  const body = note ? stripMarkdownFormatting(note.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 260) : ''
  return (
    <div className="mobile-tab-preview is-note">
      <div className="mobile-tab-preview-passage">{note?.icon ? `${note.icon} ` : ''}{note?.title || 'Untitled'}</div>
      <p className="mobile-tab-preview-text is-sans">{body}</p>
    </div>
  )
}

/** The notes home (no note open): its list as it opens — pinned first, then the latest edited. */
function NotesHomePreview({ token }: { token: number }) {
  const notes = useCached<Note[]>(`notes-home:${token}`, () => window.notes.getNotes(40, 0))
  if (!notes) return <div className="mobile-tab-preview is-note" />
  if (notes.length === 0) return <IconPreview icon={NotepadText} lines={['Notes', 'No notes yet']} />
  const rows = [...notes.filter((n) => n.pinned), ...[...notes].filter((n) => !n.pinned).sort((a, b) => b.updatedAt - a.updatedAt)].slice(0, 5)
  return (
    <div className="mobile-tab-preview is-note is-list">
      <div className="mobile-tab-preview-passage">Notes</div>
      {rows.map((n) => (
        <div key={n.id} className="mobile-tab-preview-line"><span aria-hidden>{n.icon ?? (n.type === 'verse' ? '📖' : n.type === 'daily' ? '📅' : '📝')}</span> {n.title || 'Untitled'}</div>
      ))}
    </div>
  )
}

const SCOPE_LABEL = { all: 'All', scripture: 'Scripture', notes: 'Notes', lexicon: "Strong's" } as const

function SearchPreview({ state }: { state: SearchTabState }) {
  const q = (state.query ?? '').trim()
  const scope = state.scope ?? 'scripture'
  const recent = useAppStore((s) => s.recentSearchQueries)
  const saved = (state as SearchTabState & { preview?: SearchPreviewSummary | null }).preview
  // Only a summary of THIS query counts (a tag browse saves an empty query while tags are picked).
  const summary = saved && saved.query === q ? saved : null
  const f = (state.filters ?? {}) as { textId?: string }
  const text = f.textId && f.textId !== 'all' ? TRANSLATIONS.find((t) => t.id === f.textId)?.label ?? f.textId : null
  return (
    <div className="mobile-tab-preview is-search">
      <div className="mobile-tab-preview-searchbar"><Search size={12} aria-hidden /> {q || <span className="tab-preview-placeholder">Search</span>}</div>
      <div className="tab-preview-scope">
        {(['scripture', 'notes', 'lexicon'] as const).map((sc) => <span key={sc} className={sc === scope ? 'is-on' : undefined}>{SCOPE_LABEL[sc]}</span>)}
      </div>
      {summary ? (
        <>
          <div className="tab-preview-count">{summary.total} {scope === 'lexicon' ? (summary.total === 1 ? 'entry' : 'entries') : scope === 'notes' ? (summary.total === 1 ? 'note' : 'notes') : (summary.total === 1 ? 'verse' : 'verses')}{text ? ` · ${text}` : ''}</div>
          {summary.lines.map((l, i) => (
            <div key={i} className="tab-preview-hit"><b>{l.ref}</b> {l.snippet}</div>
          ))}
        </>
      ) : !q ? (
        recent.slice(0, 4).map((r) => <div key={r} className="mobile-tab-preview-line"><Clock size={9} aria-hidden /> {r}</div>)
      ) : (
        <div className="tab-preview-count">{SCOPE_LABEL[scope]} results</div>
      )}
    </div>
  )
}

function LexiconPreview({ state }: { state: LexiconTabState }) {
  const num = state.strongsNum
  const entry = useCached<LexiconEntry | null>(num ? `lex:${num}` : null, () => window.lexicon.getEntry(num!))
  if (!num) {
    const q = (state.searchQuery ?? '').trim()
    return q
      ? <div className="mobile-tab-preview is-search"><div className="mobile-tab-preview-searchbar"><Search size={12} aria-hidden /> {q}</div><div className="tab-preview-count">Lexicon search</div></div>
      : <IconPreview icon={BookMarked} lines={["Strong's lexicon", 'Hebrew and Greek entries']} />
  }
  const gloss = entry ? (entry.gloss || entry.definition || '').replace(/\s+/g, ' ').trim() : ''
  return (
    <div className="mobile-tab-preview is-lexicon">
      <div className="mobile-tab-preview-passage">{num} {entry?.lemma && <span className="mobile-tab-preview-lemma">{entry.lemma}</span>}</div>
      {entry?.transliteration && <div className="tab-preview-translit">{entry.transliteration}</div>}
      <p className="mobile-tab-preview-text is-sans">{gloss.slice(0, 160)}</p>
    </div>
  )
}

/** Where a YouTube tab without a video is: a playlist, a channel (@handle), or the home grid. */
const safeDecode = (v: string) => { try { return decodeURIComponent(v) } catch { return v } }
function youTubePlace(state: YouTubeTabState): string {
  if (state.playlistId) return 'Playlist'
  const url = state.url ?? ''
  const handle = url.match(/youtube\.com\/(@[^/?#]+)/i)?.[1] ?? url.match(/youtube\.com\/(?:c|channel|user)\/([^/?#]+)/i)?.[1]
  if (handle) return safeDecode(handle)
  if (/[?&]search_query=/.test(url)) return `Search: ${safeDecode((url.match(/search_query=([^&#]+)/)?.[1] ?? '').replace(/\+/g, ' '))}`
  return 'Channels and videos'
}

function YouTubePreview({ state }: { state: YouTubeTabState }) {
  if (!state.videoId) return <IconPreview icon={Youtube} lines={['YouTube', youTubePlace(state)]} />
  return (
    <div className="mobile-tab-preview is-youtube">
      <img src={`https://i.ytimg.com/vi/${encodeURIComponent(state.videoId)}/mqdefault.jpg`} alt="" loading="lazy" />
    </div>
  )
}

function HistoryPreview() {
  const history = useAppStore((s) => s.history)
  return (
    <div className="mobile-tab-preview is-history">
      {history.slice(0, 5).map((h) => <div key={h.id} className="mobile-tab-preview-line">{h.title}</div>)}
      {history.length === 0 && <IconPreview icon={History} lines={['History']} />}
    </div>
  )
}

/** A miniature of the Settings root list as it renders (SettingsPage): the first sections'
 *  rows with their current values — not a theme swatch. */
function SettingsPreview() {
  const theme = useAppStore((s) => s.theme)
  const preset = useAppStore((s) => s.themePreset)
  const customThemes = useAppStore((s) => s.customThemes)
  const glass = useAppStore((s) => s.glassAppearance)
  const translation = useAppStore((s) => s.defaultBibleTranslation)
  const fontSize = useAppStore((s) => s.bibleFontSize)
  const verseNumbers = useAppStore((s) => s.showVerseNumbers)
  const cap = (v: string) => v.charAt(0).toUpperCase() + v.slice(1)
  const sections: Array<[string, Array<[string, string]>]> = [
    ['Appearance', [['Theme', cap(theme)], ['Color preset', themePresetLabel(preset, customThemes)], ['Glass appearance', cap(String(glass))]]],
    ['Reading', [['Default translation', TRANSLATIONS.find((t) => t.id === translation)?.label ?? translation], ['Text size', `${fontSize}`], ['Verse numbers', verseNumbers ? 'On' : 'Off']]],
  ]
  return (
    <div className="mobile-tab-preview is-settings tab-preview-settings">
      {sections.map(([title, rows]) => (
        <div key={title}>
          <div className="tab-preview-section">{title}</div>
          <div className="tab-preview-group">
            {rows.map(([label, value]) => (
              <div key={label} className="tab-preview-row"><span>{label}</span><span className="tab-preview-value">{value}</span></div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function IconPreview({ icon: Icon, lines }: { icon: typeof History; lines: string[] }) {
  return (
    <div className="mobile-tab-preview is-icon">
      <Icon size={26} aria-hidden />
      {lines.filter(Boolean).map((l) => <div key={l} className="mobile-tab-preview-line">{l}</div>)}
    </div>
  )
}

/** A Calendar tab's card: its month in miniature, with the note dots (same index as the calendar). */
function CalendarPreview({ state }: { state: CalendarTabState }) {
  const month = monthFromKey(state.month, dailyNoteToday())
  const dates = useDailyNoteDates()
  const todayKey = toDateKey(dailyNoteToday())
  return (
    <div className="mobile-tab-preview is-calendar">
      <div className="mobile-tab-preview-passage">{monthLabel(month)}</div>
      <div className="tab-preview-cal">
        {monthGrid(month).flat().map((d) => (
          <span key={d.key} className={`tab-preview-cal-day${d.inMonth ? '' : ' is-out'}${d.key === todayKey ? ' is-today' : ''}${d.key === state.selected ? ' is-selected' : ''}`}>
            {d.date.getDate()}{dates?.has(d.key) && <i aria-hidden />}
          </span>
        ))}
      </div>
    </div>
  )
}
