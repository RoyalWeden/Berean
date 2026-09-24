import React, { useEffect, useState } from 'react'
import { History, Settings as SettingsIcon, Search, Youtube, Tags, FileText, NotepadText, BookMarked } from 'lucide-react'
import { useAppStore } from '@/store'
import type { BibleTabState, LexiconEntry, Note, Tab, Verse, SearchTabState, YouTubeTabState, PdfTabState } from '@/types'
import { bookName, getTranslationForBook } from '@/lib/parseRef'
import { stripMarkdownFormatting } from '@/lib/notePreviewText'
import { customThemeKey, previewColors } from '@/lib/customTheme'
import { THEME_PRESETS } from '@/lib/themePresets'
import { readerScrollMemory } from '../reader/readerScrollMemory'
import { columnsForState, translationLabel } from '../reader/compareState'

/**
 * What a tab card shows (T23-011): a small, REAL preview of the tab's last state — never a
 * screenshot. Scripture shows the passage text from where the tab was being read, a note its
 * title and text, a search its query, YouTube the video's thumbnail, Lexicon the entry, History
 * the latest entries, Settings the current look. Data comes from the same local services the tab
 * uses, fetched once per card and cached for the session (cards are only mounted while the tab
 * cards sheet is open), so rendering previews never touches or resets the tab itself.
 */
export function TabPreview({ tab }: { tab: Tab }) {
  switch (tab.type) {
    case 'bible': return (tab.state as BibleTabState).compareMode ? <ComparePreview tab={tab} /> : <ScripturePreview tab={tab} />
    case 'note': return <NotePreview tab={tab} />
    case 'search': return <SearchPreview state={tab.state as SearchTabState} />
    case 'lexicon': return <LexiconPreview num={(tab.state as { strongsNum: string | null }).strongsNum} />
    case 'youtube': return <YouTubePreview state={tab.state as YouTubeTabState} />
    case 'history': return <HistoryPreview />
    case 'settings': return <SettingsPreview />
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

function ScripturePreview({ tab }: { tab: Tab }) {
  const st = tab.state as BibleTabState
  const textId = (st.translation ?? getTranslationForBook(st.bookId) ?? 'KJVA').toLowerCase()
  // Where the tab was being read: its remembered verse anchor (this device), else its target verse.
  const anchor = readerScrollMemory.restore(tab.id, st.bookId, st.chapter)
  const from = anchor?.verse ?? st.targetVerse ?? st.verse ?? 1
  const verses = useCached(`ch:${textId}:${st.bookId}:${st.chapter}`, () => window.bible.queryChapter(st.bookId, st.chapter, textId))
  return (
    <div className="mobile-tab-preview is-scripture">
      <div className="mobile-tab-preview-passage">{bookName(st.bookId)} {st.chapter}</div>
      <p className="mobile-tab-preview-text">
        {versesFrom(verses, from, 6).map((v) => (
          <span key={v.verse_num}><sup>{v.verse_num}</sup>{v.text} </span>
        ))}
      </p>
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
      <div className="mobile-tab-preview-passage">{bookName(a.bookId)} {a.chapter}</div>
      <div className="mobile-tab-preview-cols">
        {[{ c: a, v: left }, { c: b, v: right }].map(({ c, v }) => (
          <div key={c.textId}>
            <small>{translationLabel(c.textId)}</small>
            <p className="mobile-tab-preview-text">{versesFrom(v, 1, 3).map((x) => <span key={x.verse_num}><sup>{x.verse_num}</sup>{x.text} </span>)}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function NotePreview({ tab }: { tab: Tab }) {
  const id = (tab.state as { noteId?: string | null }).noteId ?? null
  const note = useCached<Note | null>(id ? `note:${id}` : null, () => window.notes.getNote(id!))
  if (!id) return <IconPreview icon={NotepadText} lines={['Notes', 'Folders, daily notes, pinned']} />
  const body = note ? stripMarkdownFormatting(note.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 260) : ''
  return (
    <div className="mobile-tab-preview is-note">
      <div className="mobile-tab-preview-passage">{note?.icon ? `${note.icon} ` : ''}{note?.title || 'Untitled'}</div>
      <p className="mobile-tab-preview-text is-sans">{body}</p>
    </div>
  )
}

function SearchPreview({ state }: { state: SearchTabState }) {
  const q = (state.query ?? '').trim()
  const scope = state.scope ?? 'scripture'
  return (
    <div className="mobile-tab-preview is-search">
      <div className="mobile-tab-preview-searchbar"><Search size={12} aria-hidden /> {q || 'Search'}</div>
      <p className="mobile-tab-preview-text is-sans">{q ? `Searching ${scope === 'scripture' ? 'Scripture' : scope === 'notes' ? 'notes' : 'the lexicon'}` : 'Every text, your notes, or the lexicon'}</p>
    </div>
  )
}

function LexiconPreview({ num }: { num: string | null }) {
  const entry = useCached<LexiconEntry | null>(num ? `lex:${num}` : null, () => window.lexicon.getEntry(num!))
  if (!num) return <IconPreview icon={BookMarked} lines={["Strong's lexicon", 'Hebrew and Greek entries']} />
  return (
    <div className="mobile-tab-preview is-lexicon">
      <div className="mobile-tab-preview-passage">{num} <span className="mobile-tab-preview-lemma">{entry?.lemma}</span></div>
      <p className="mobile-tab-preview-text is-sans"><em>{entry?.transliteration}</em> {entry?.gloss}</p>
    </div>
  )
}

function YouTubePreview({ state }: { state: YouTubeTabState }) {
  if (!state.videoId) return <IconPreview icon={Youtube} lines={['YouTube', 'Channels and videos']} />
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

function SettingsPreview() {
  const preset = useAppStore((s) => s.themePreset)
  const customThemes = useAppStore((s) => s.customThemes)
  const theme = useAppStore((s) => s.theme)
  const scheme = theme === 'light' ? 'light' : theme === 'dark' ? 'dark' : (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  const c = previewColors(preset, customThemes, scheme)
  const label = preset.startsWith('custom:') ? customThemes.find((t) => customThemeKey(t.id) === preset)?.name : THEME_PRESETS.find((p) => p.id === preset)?.label
  return (
    <div className="mobile-tab-preview is-settings">
      <div className="mobile-tab-preview-swatch" style={{ background: c.background, color: c.text }}>
        <span style={{ color: c.accent }}>1</span> In the beginning…
      </div>
      <div className="mobile-tab-preview-line"><SettingsIcon size={11} aria-hidden /> {label ?? 'Default'} · {theme === 'system' ? 'Auto' : theme}</div>
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
