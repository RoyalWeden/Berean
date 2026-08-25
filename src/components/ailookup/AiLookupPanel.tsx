import { useEffect, useRef, useState, useLayoutEffect, Fragment } from 'react'
import { X, Send, Loader2, Plus, History as HistoryIcon, Sparkles, ChevronDown, ChevronRight, BookMarked, Link2, MessageSquareText, SearchCheck, Pencil, StickyNote, BookOpenText, Quote, Copy, Check, Eye, Youtube } from 'lucide-react'
import { useAppStore } from '@/store'
import { recordNavigation } from '@/lib/verseNavigation'
import { VerseCopyMenu, useVerseCopyMenu } from '@/components/bible/VerseCopyMenu'
import { applyWordReplacer } from '@/lib/wordReplacer'
import type { AiLookupChatMessage, AiLookupResponse, AiLookupResult, AiLookupNoteResult, AiLookupStrongsCard, AiLookupTabContextRef, AiLookupVideoResult } from '@/types/electron'
import ChatHistoryList from './ChatHistoryList'

// Resizable (Round 10) — these are now the MINIMUM size (the panel's original fixed dimensions),
// enforced as a floor during drag, with a generous but bounded maximum so the panel can be made
// more useful without letting it take over the screen. See onResizeMove/clampSize below.
const MIN_WIDTH = 380
const MIN_HEIGHT = 520
const MAX_WIDTH = 700
const MAX_HEIGHT = 800
const MARGIN = 16

// Near-opaque (~92%, a genuinely subtle ~8% see-through), via an explicit color-mix()
// instead of a Tailwind arbitrary-value opacity modifier (`bg-[...]/NN`) — that approach
// rendered far more transparent than intended, so this sidesteps any ambiguity about
// whether/how Tailwind compiles opacity onto a fully custom `rgb(var(--x))` value.
const PANEL_BG = { backgroundColor: 'color-mix(in srgb, rgb(var(--color-surface-1)) 92%, transparent)' }
const HEADER_BG = { backgroundColor: 'color-mix(in srgb, rgb(var(--color-surface-2)) 92%, transparent)' }

// Rotated through for the empty-state example — one worked sample question shouldn't be the
// only thing shown every time. Covers the different question shapes the pipeline actually
// supports (a "where" lookup, a topical search, and a Strong's number).
const EXAMPLE_PROMPTS = [
  'where does Abraham leave his family because of idolatry?',
  'verses about the Sabbath being a sign forever',
  'what does H2580 mean?',
  'where is the wedding at Cana?',
  'verses about not eating blood',
]

// Best-effort inline trigger for "use the current tab as context" without turning the toggle
// on — not exhaustive NLP, just the handful of phrasings someone would naturally reach for.
// Checked against the raw message text (case-insensitive); the toggle pill is the reliable,
// always-on way to get the same behavior for every message in a stretch of conversation.
const TAB_CONTEXT_PHRASES = [
  'this chapter', 'this verse', 'this passage', 'this note', 'this entry', 'this video',
  'this page', 'current tab', 'currently viewing', 'currently open', "what i'm looking at",
  'what i am looking at', 'on screen',
]
function mentionsCurrentTab(message: string): boolean {
  const lower = message.toLowerCase()
  return TAB_CONTEXT_PHRASES.some((p) => lower.includes(p))
}

function defaultSize() {
  return { width: MIN_WIDTH, height: MIN_HEIGHT }
}

/** Enforces the min/max bounds, also capping to the viewport itself so the panel can never be
 *  dragged larger than the window on a small display even though MAX_WIDTH/MAX_HEIGHT allow it. */
function clampSize(size: { width: number; height: number }) {
  const maxW = typeof window === 'undefined' ? MAX_WIDTH : Math.min(MAX_WIDTH, window.innerWidth - MARGIN * 2)
  const maxH = typeof window === 'undefined' ? MAX_HEIGHT : Math.min(MAX_HEIGHT, window.innerHeight - MARGIN * 2)
  return {
    width: Math.min(Math.max(size.width, MIN_WIDTH), Math.max(MIN_WIDTH, maxW)),
    height: Math.min(Math.max(size.height, MIN_HEIGHT), Math.max(MIN_HEIGHT, maxH)),
  }
}

function defaultPos(size: { width: number; height: number }) {
  if (typeof window === 'undefined') return { x: 0, y: 0 }
  return {
    x: window.innerWidth - size.width - MARGIN,
    y: window.innerHeight - size.height - MARGIN,
  }
}

function clampPos(pos: { x: number; y: number }, size: { width: number; height: number }) {
  const maxX = Math.max(MARGIN, window.innerWidth - size.width - MARGIN)
  const maxY = Math.max(MARGIN, window.innerHeight - size.height - MARGIN)
  return { x: Math.min(Math.max(pos.x, MARGIN), maxX), y: Math.min(Math.max(pos.y, MARGIN), maxY) }
}

/** Wraps any of `keywords` found (case-insensitive, whole-ish word) inside `text` in a
 *  <mark>-style highlight, so a result visibly shows WHY it matched. */
function HighlightedText({ text, keywords }: { text: string; keywords: string[] }) {
  const words = [...new Set(keywords.flatMap((k) => k.split(/\s+/)).filter((w) => w.length >= 3))]
  if (words.length === 0) return <>{text}</>
  const pattern = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  const parts = text.split(pattern)
  return (
    <>
      {parts.map((part, i) =>
        pattern.test(part) && words.some((w) => w.toLowerCase() === part.toLowerCase())
          ? <mark key={i} className="bg-[rgb(var(--highlight-yellow)/0.4)] text-inherit rounded-[2px]">{part}</mark>
          : <Fragment key={i}>{part}</Fragment>
      )}
    </>
  )
}

// Auto-grows with content up to a max height (~4 lines) then scrolls internally — replaces the
// old fixed-height single-line <input> for both the composer and the edit-message field, so a
// long message wraps and stays fully visible/editable instead of scrolling horizontally inside
// a box too short to show it.
const TEXTAREA_MAX_HEIGHT = 88 // ~4 lines at this font size

function AutoGrowTextarea({ value, onChange, onKeyDown, placeholder, disabled, autoFocus, className }: {
  value: string
  onChange: (v: string) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  placeholder?: string
  disabled?: boolean
  autoFocus?: boolean
  className?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT)}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      rows={1}
      autoFocus={autoFocus}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      disabled={disabled}
      style={{ maxHeight: TEXTAREA_MAX_HEIGHT, resize: 'none' }}
      className={className}
    />
  )
}

/** A real, DB-verified Strong's word card — definition-only by default (occurrences render
 *  separately, as ordinary verse chips, only when the question actually asked for them — see
 *  STRONGS_OCCURRENCES_REQUESTED_RE in aiLookup.ts). Clickable via the same ensureTab('lexicon')
 *  → openLexiconEntry → setActiveSpace('lexicon') primitive used everywhere else in the app. */
function StrongsCard({ card }: { card: AiLookupStrongsCard }) {
  const ensureTab = useAppStore((s) => s.ensureTab)
  const openLexiconEntry = useAppStore((s) => s.openLexiconEntry)
  const setActiveSpace = useAppStore((s) => s.setActiveSpace)
  return (
    <button
      onClick={() => { ensureTab('lexicon'); openLexiconEntry(card.strongsNum); setActiveSpace('lexicon') }}
      className="w-full text-left rounded-shell border border-[rgb(var(--color-surface-4))] hover:border-[rgb(var(--color-accent))] bg-[rgb(var(--color-surface-2))] px-3 py-2.5 transition-colors cursor-pointer"
    >
      <div className="flex items-center gap-1.5 mb-1">
        <BookOpenText size={12} className="flex-shrink-0 text-[rgb(var(--color-accent))]" />
        <span className="text-[11px] font-semibold text-[rgb(var(--color-text-primary))]">{card.strongsNum}</span>
        {card.transliteration && <span className="text-[11px] italic text-[rgb(var(--color-text-secondary))]">{card.transliteration}</span>}
        {card.lemma && <span className="text-[11px] text-[rgb(var(--color-text-muted))]">{card.lemma}</span>}
      </div>
      {card.gloss && (
        <p className="text-[11px] text-[rgb(var(--color-text-secondary))] leading-snug">
          <span className="text-[rgb(var(--color-text-muted))]">Renders as: </span>{card.gloss}
        </p>
      )}
      {card.derivation && (
        <p className="text-[11px] text-[rgb(var(--color-text-muted))] leading-snug mt-0.5">
          <span className="text-[rgb(var(--color-text-muted))]">Derivation: </span>{card.derivation}
        </p>
      )}
      <p className="text-[10px] text-[rgb(var(--color-text-muted))] mt-1">
        {card.occurrenceCount} occurrence{card.occurrenceCount === 1 ? '' : 's'} in Scripture · click for full entry
      </p>
    </button>
  )
}

/** A note result — clickable via the same ensureTab('note') → setActiveSpace('notes') →
 *  requestOpenNote primitive used everywhere else in the app. */
function NoteCard({ note }: { note: AiLookupNoteResult }) {
  const ensureTab = useAppStore((s) => s.ensureTab)
  const setActiveSpace = useAppStore((s) => s.setActiveSpace)
  const requestOpenNote = useAppStore((s) => s.requestOpenNote)
  return (
    <button
      onClick={() => { ensureTab('note'); setActiveSpace('notes'); requestOpenNote(note.id) }}
      className="w-full text-left rounded-shell border border-[rgb(var(--color-surface-4))] hover:border-[rgb(var(--color-accent))] bg-[rgb(var(--color-surface-2))] px-2.5 py-2 transition-colors cursor-pointer"
    >
      <div className="flex items-center gap-1.5 mb-0.5">
        <StickyNote size={11} className="flex-shrink-0 text-[rgb(var(--color-text-muted))]" />
        <span className="text-[11px] font-semibold text-[rgb(var(--color-text-primary))] truncate">{note.title}</span>
        {note.isIdiom && (
          <span className="flex-shrink-0 text-[9px] px-1.5 py-0.5 rounded-full bg-[rgb(var(--color-accent))/15] text-[rgb(var(--color-accent))]">
            idiom{note.idiomTerm ? `: ${note.idiomTerm}` : ''}
          </span>
        )}
      </div>
      {note.snippet && <p className="text-[11px] text-[rgb(var(--color-text-secondary))] leading-snug line-clamp-2">{note.snippet}</p>}
    </button>
  )
}

/** Round 11 — "find me a video about X". Searched from the local, already-synced,
 *  allowlisted-channel library only (see CLAUDE.md §12), same reuse-primitive pattern as
 *  NoteCard above. */
function VideoCard({ video }: { video: AiLookupVideoResult }) {
  const openYouTubeVideoInNewTab = useAppStore((s) => s.openYouTubeVideoInNewTab)
  const setActiveSpace = useAppStore((s) => s.setActiveSpace)
  // startMs/snippet are only set for a transcript-content match (see mergeVideoSearchResults in
  // aiLookup.ts) — a plain title match has no single "moment" to deep-link to, so it opens at 0
  // exactly like before this feature existed.
  const startSeconds = video.startMs != null ? Math.floor(video.startMs / 1000) : 0
  return (
    <button
      onClick={() => { openYouTubeVideoInNewTab(video.videoId, startSeconds); setActiveSpace('youtube') }}
      className="w-full text-left rounded-shell border border-[rgb(var(--color-surface-4))] hover:border-[rgb(var(--color-accent))] bg-[rgb(var(--color-surface-2))] px-2.5 py-2 transition-colors cursor-pointer flex items-center gap-2"
    >
      {video.thumbnailUrl
        ? <img src={video.thumbnailUrl} alt="" className="w-14 h-9 rounded object-cover flex-shrink-0" />
        : <Youtube size={20} className="flex-shrink-0 text-[rgb(var(--color-text-muted))]" />}
      <div className="min-w-0">
        <p className="text-[11px] font-semibold text-[rgb(var(--color-text-primary))] leading-snug line-clamp-2">{video.title}</p>
        <p className="text-[10px] text-[rgb(var(--color-text-muted))] truncate">
          {video.channelName}{video.startMs != null ? ` — at ${formatTimestamp(startSeconds)}` : ''}
        </p>
        {video.snippet && <p className="text-[10px] text-[rgb(var(--color-text-secondary))] leading-snug line-clamp-2 mt-0.5">"{video.snippet}"</p>}
      </div>
    </button>
  )
}

/** mm:ss (or h:mm:ss past the hour mark) for a transcript-match deep-link label — plain
 *  arithmetic, no Intl/date library needed for a duration this short. */
function formatTimestamp(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** A small pill/badge for a deterministic (non-AI-prose) summary line — cross-ref/quote-lookup
 *  answers set `summary` to a fixed template string, not AI-generated prose (unless Commentary
 *  is on, in which case it IS real AI narration — still shown here, just with the same neutral
 *  badge framing rather than looking like a chat reply, per the request that these should read
 *  as a label, not a sentence of AI prose). */
function SourceBadge({ text }: { text: string }) {
  return (
    <div className="inline-flex items-start gap-1.5 max-w-full text-[10px] text-[rgb(var(--color-text-muted))] bg-[rgb(var(--color-surface-2))] rounded-full px-2.5 py-1 border border-[rgb(var(--color-surface-4))]">
      <Quote size={10} className="flex-shrink-0 mt-0.5 opacity-70" />
      <span>{text}</span>
    </div>
  )
}

/** The answer-bearing fields of a pipeline response, in the shape a chat message carries them.
 *  Shared by the progressive-partial handler and the final response so the two can never drift
 *  into rendering a different subset of the same payload — a partial and the final answer differ
 *  ONLY by commentary having landed, never by which fields the UI knows how to show. */
function messageFieldsFrom(res: AiLookupResponse): Partial<AiLookupChatMessage> {
  return {
    results: res.results,
    visibleCount: res.visibleCount,
    keywords: res.keywords,
    related: res.related,
    relatedNote: res.relatedNote,
    summary: res.summary,
    strongsCard: res.strongsCard,
    notes: res.notes,
    notesAreThePrimaryAnswer: res.notesAreThePrimaryAnswer,
    videos: res.videos,
  }
}

export default function AiLookupPanel() {
  // LazyOnce (App.tsx) mounts this once `aiLookupPanelOpen` first becomes true and then
  // keeps it mounted forever (same pattern as SettingsModal/HistoryModal/TasksPanel) — so
  // this component, not LazyOnce, is responsible for hiding itself on later closes.
  const open = useAppStore((s) => s.aiLookupPanelOpen)
  const setOpen = useAppStore((s) => s.setAiLookupPanelOpen)
  const settingsOpen = useAppStore((s) => s.settingsOpen)
  const commentaryOn = useAppStore((s) => s.aiLookupCommentaryOn)
  const setCommentaryOn = useAppStore((s) => s.setAiLookupCommentaryOn)
  const agenticOn = useAppStore((s) => s.aiLookupAgenticOn)
  const setAgenticOn = useAppStore((s) => s.setAiLookupAgenticOn)
  const useTabContext = useAppStore((s) => s.aiLookupUseTabContext)
  const setUseTabContext = useAppStore((s) => s.setAiLookupUseTabContext)
  const storedPos = useAppStore((s) => s.aiLookupPanelPos)
  const setStoredPos = useAppStore((s) => s.setAiLookupPanelPos)
  const storedSize = useAppStore((s) => s.aiLookupPanelSize)
  const setStoredSize = useAppStore((s) => s.setAiLookupPanelSize)
  const activeChatId = useAppStore((s) => s.aiLookupActiveChatId)
  const setActiveChatId = useAppStore((s) => s.setAiLookupActiveChatId)
  const addTab = useAppStore((s) => s.addTab)
  const updateTabState = useAppStore((s) => s.updateTabState)
  const setActiveSpace = useAppStore((s) => s.setActiveSpace)
  const wordReplacerEnabled = useAppStore((s) => s.wordReplacerEnabled)
  const wordReplacerRules = useAppStore((s) => s.wordReplacerRules)
  // Enabled, non-Strong's rules only — Strong's-number rules apply to KJVA tagged-word
  // rendering elsewhere, not plain verse text or FTS search, and don't fit this shape.
  const activeWordReplacerRules = wordReplacerEnabled
    ? wordReplacerRules.filter((r) => r.enabled && !r.strongsNum)
    : []

  const [size, setSize] = useState(() => clampSize(storedSize ?? defaultSize()))
  const [pos, setPos] = useState(() => clampPos(storedPos ?? defaultPos(size), size))
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)
  const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null)

  const verseCopy = useVerseCopyMenu()

  const [availability, setAvailability] = useState<{ checked: boolean; available: boolean }>({ checked: false, available: false })
  const [messages, setMessages] = useState<AiLookupChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [progressStatus, setProgressStatus] = useState('Searching…')
  const [historyOpen, setHistoryOpen] = useState(false)
  // How many primary results are shown per message index, keyed by message index —
  // starts at that message's own visibleCount, bumped by "Show more".
  const [expanded, setExpanded] = useState<Record<number, number>>({})
  // Cross-references are collapsed by default (each answer was reported as "way too long"
  // with them always open) — tracked per "messageIndex-resultIndex" key, toggled open on click.
  const [crossRefsOpen, setCrossRefsOpen] = useState<Record<string, boolean>>({})
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')
  // Briefly shows a checkmark in place of the copy icon after a successful copy — cleared by
  // its own timeout, keyed by message index so only the button just clicked flips.
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Bumped at the start of every question — see the onPartial effect below for why a straggling
  // partial from an abandoned question must not paint over a newer answer.
  const partialSeqRef = useRef(0)
  const [examplePrompt] = useState(() => EXAMPLE_PROMPTS[Math.floor(Math.random() * EXAMPLE_PROMPTS.length)])
  const bodyRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    window.aiLookup.checkAvailable().then((r) => setAvailability({ checked: true, available: r.available })).catch(() => setAvailability({ checked: true, available: false }))
  }, [])

  // Live status text for the loading state (e.g. "Searching Jubilees…") — registered once,
  // not per-query, same pattern as the other progress bridges (youtube.ts's onProgress etc).
  useEffect(() => {
    window.aiLookup.onProgress((status) => setProgressStatus(status))
  }, [])

  // ── Progressive results (speed round) ───────────────────────────────────────
  // Retrieval finishes well before the pipeline does. By the time runLookup calls emitPartial
  // (aiLookup.ts, just before step 7) every real DB-verified verse the user will ever see
  // already exists in memory — all that remains is the optional Commentary pass, a second ~4s
  // Ollama call that writes prose over those SAME results and never introduces a new reference.
  // Waiting for it meant sitting on a blank spinner while the finished answer was already on the
  // other side of an IPC boundary.
  //
  // So: a partial paints the assistant message immediately, and the final `query` response
  // replaces it in place once commentary lands. `partialSeqRef` is what makes that safe — it's
  // bumped at the start of every send(), and a partial is dropped unless its sequence still
  // matches, so a straggling partial from an abandoned question can't paint over the answer to a
  // newer one. Same "latest request wins" guard NotesPanel.tsx uses for its own async loads.
  //
  // Registered ONCE rather than per-query: preload's onPartial does
  // removeAllListeners('ailookup:partial') before subscribing, so re-registering per query would
  // be harmless today but would quietly break the moment a second panel existed.
  useEffect(() => {
    window.aiLookup.onPartial((partial) => {
      const seq = partialSeqRef.current
      setMessages((prev) => {
        if (seq !== partialSeqRef.current) return prev
        // Only ever fills the placeholder this panel appended for the in-flight question —
        // never rewrites an already-completed answer.
        const last = prev[prev.length - 1]
        if (!last || last.role !== 'assistant' || !last.pending) return prev
        return [...prev.slice(0, -1), { ...last, ...messageFieldsFrom(partial), pending: true }]
      })
    })
  }, [])

  useEffect(() => {
    if (activeChatId) {
      window.aiLookup.getChat(activeChatId).then((chat) => {
        if (chat) { setMessages(chat.messages); setExpanded({}); setCrossRefsOpen({}) }
      }).catch(() => {})
    }
  }, [activeChatId])

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, loading])

  function onDragStart(e: React.PointerEvent) {
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  function onDragMove(e: React.PointerEvent) {
    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.startX
    const dy = e.clientY - dragRef.current.startY
    setPos(clampPos({ x: dragRef.current.origX + dx, y: dragRef.current.origY + dy }, size))
  }
  function onDragEnd() {
    dragRef.current = null
    setStoredPos(pos)
  }

  // Resize handle, bottom-right corner — grows down/right only (position stays anchored at its
  // current top-left, matching the standard resize-handle convention). Min = the panel's
  // original fixed size, max is capped generous-but-bounded (see MAX_WIDTH/MAX_HEIGHT) so the
  // panel can be made more useful without taking over the screen — current size is the enforced
  // floor, never smaller than where it started.
  function onResizeStart(e: React.PointerEvent) {
    e.stopPropagation() // don't also trigger the header's own drag handler
    resizeRef.current = { startX: e.clientX, startY: e.clientY, origW: size.width, origH: size.height }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  function onResizeMove(e: React.PointerEvent) {
    if (!resizeRef.current) return
    const dx = e.clientX - resizeRef.current.startX
    const dy = e.clientY - resizeRef.current.startY
    const next = clampSize({ width: resizeRef.current.origW + dx, height: resizeRef.current.origH + dy })
    setSize(next)
    // Growing can push the panel's bottom/right edge past the viewport if it was positioned
    // near an edge — re-clamp position against the new size every frame so it stays fully
    // visible instead of just letting the resize handle drift off-screen.
    setPos((p) => clampPos(p, next))
  }
  function onResizeEnd() {
    resizeRef.current = null
    setStoredSize(size)
    setStoredPos(pos)
  }

  // Builds a lightweight {type, ref} pointer from whatever tab is active in whichever space the
  // user is currently in — the main process fetches the REAL content server-side from just this
  // reference (see buildTabContextBlock in aiLookup.ts), never trusting renderer-supplied text.
  // Returns undefined if the active tab's type isn't one this feature supports yet (search/pdf)
  // or nothing is open.
  function getActiveTabContextRef(): AiLookupTabContextRef | undefined {
    const state = useAppStore.getState()
    const space = state.activeSpace
    const activeId = state.activeTabId[space]
    const tab = activeId ? state.tabs[space].find((t) => t.id === activeId) : null
    if (!tab) return undefined
    if (tab.type === 'bible') {
      const s = tab.state as { bookId: string; chapter: number; translation: string }
      return { type: 'bible', bookId: s.bookId, chapter: s.chapter, translation: s.translation }
    }
    if (tab.type === 'note') {
      const s = tab.state as { noteId: string | null }
      return s.noteId ? { type: 'note', noteId: s.noteId } : undefined
    }
    if (tab.type === 'lexicon') {
      const s = tab.state as { strongsNum: string | null }
      return s.strongsNum ? { type: 'lexicon', strongsNum: s.strongsNum } : undefined
    }
    if (tab.type === 'youtube') {
      const s = tab.state as { videoId: string | null }
      return s.videoId ? { type: 'youtube', videoId: s.videoId } : undefined
    }
    return undefined
  }

  function navigateToResult(r: AiLookupResult, question?: string) {
    const state = useAppStore.getState()
    const activeId = state.activeTabId.scripture
    const activeScripture = activeId ? state.tabs.scripture.find((t) => t.id === activeId) : null
    const priorState = activeScripture?.state as { bookId?: string; chapter?: number; targetVerse?: number } | undefined
    const title = `${r.bookName} ${r.chapter}:${r.verse}${r.endVerse ? '-' + r.endVerse : ''}`
    if (activeScripture) {
      updateTabState('scripture', activeScripture.id, { bookId: r.bookId, chapter: r.chapter, targetVerse: r.verse, endVerse: r.endVerse, scrollPosition: 0, translation: r.textId.toUpperCase() })
    } else {
      addTab({
        id: `bible-${Date.now()}`,
        spaceId: 'scripture', type: 'bible', title,
        state: { bookId: r.bookId, chapter: r.chapter, targetVerse: r.verse, endVerse: r.endVerse, translation: r.textId.toUpperCase(), showStrongs: false, scrollPosition: 0 },
      })
    }
    setActiveSpace('scripture')
    // Tier 1 — the AI Lookup's suggestion IS the reason; the asked question is threaded
    // through as the connection's reason text so it reads as "why" in the Study Trail map.
    // A NESTED cross-ref result (r.crossRefOf set) additionally knows exactly which verse's
    // cross-ref list it came from — previously dropped entirely, since this whole function
    // always recorded kind:'ai-lookup' with no verse info at all, unlike the equivalent
    // right-panel cross-ref click.
    recordNavigation(
      { bookId: priorState?.bookId, chapter: priorState?.chapter, verse: priorState?.targetVerse },
      { bookId: r.bookId, chapter: r.chapter, verse: r.verse },
      { kind: 'ai-lookup', question: question ?? '', fromVerse: r.crossRefOf?.verse },
    )
  }

  async function persist(nextMessages: AiLookupChatMessage[]) {
    const title = nextMessages.find((m) => m.role === 'user')?.content.slice(0, 60) || 'AI Lookup'
    // `pending` is live-render state only (see the onPartial effect) — strip it on the way to
    // the DB so a chat reopened later can never contain a message frozen mid-flight.
    const clean = nextMessages.map(({ pending: _pending, ...m }) => m)
    const saved = await window.aiLookup.saveChat({ id: activeChatId ?? undefined, title, messages: clean })
    if (!activeChatId) setActiveChatId(saved.id)
  }

  // Shared by both a normal send and an edit-and-regenerate — `base` is everything the new
  // question should be appended after (the full thread for a normal send, or everything
  // before the edited turn for an edit, which is how the edit truncates/replaces the rest).
  async function runQuery(question: string, base: AiLookupChatMessage[]) {
    const userMsg: AiLookupChatMessage = { role: 'user', content: question, createdAt: new Date().toISOString() }
    const withUser = [...base, userMsg]
    setMessages(withUser)
    setLoading(true)
    setProgressStatus('Reading your question…')
    try {
      // Recent turns only, role+content — enough for a follow-up ("what about the next
      // chapter") to resolve against without the prompt growing unbounded over a long chat.
      const history = base.slice(-6).map((m) => ({ role: m.role, content: m.content }))
      // Tab context: sent when the toggle is on, OR the message itself mentions the current
      // tab inline (e.g. "this chapter") even with the toggle off — either way is a one-off
      // per-message decision, not persisted state on the message itself.
      const tabContext = (useTabContext || mentionsCurrentTab(question)) ? getActiveTabContextRef() : undefined
      // Placeholder the partial handler fills in. Appended BEFORE the query so a partial that
      // arrives mid-flight has something to attach to; `pending` marks it as the only message
      // partials are ever allowed to overwrite.
      const seq = ++partialSeqRef.current
      setMessages([...withUser, { role: 'assistant', content: '', pending: true, createdAt: new Date().toISOString() }])

      const res = await window.aiLookup.query(question, {
        commentary: commentaryOn,
        agentic: agenticOn,
        wordReplacerRules: activeWordReplacerRules.length > 0
          ? activeWordReplacerRules.map((r) => ({ queries: r.queries, replacement: r.replacement }))
          : undefined,
        history,
        tabContext,
      })
      // "Nothing found" only applies when NOTHING at all came back — a Strong's card, a notes
      // answer, or a summary/badge line are all legitimate complete answers on their own, even
      // when `results` (verse chips) is empty.
      const hasAnyAnswer = res.results.length > 0 || !!res.strongsCard || (res.notes?.length ?? 0) > 0 || (res.videos?.length ?? 0) > 0 || !!res.summary
      const assistantMsg: AiLookupChatMessage = {
        role: 'assistant',
        content: res.error === 'ollama-unavailable'
          ? "Ollama isn't running — start it locally to use AI Lookup."
          : !hasAnyAnswer
            ? "No matching verses found — try rephrasing."
            : '',
        ...messageFieldsFrom(res),
        createdAt: new Date().toISOString(),
        // Cleared: this is the settled answer, so no further partial may touch it.
      }
      // A response from a question the user has already moved on from must not clobber whatever
      // is on screen now — same sequence guard the partial handler uses, applied to the final
      // result too, since `query` is awaited across a window in which send() can be called again.
      if (seq !== partialSeqRef.current) return
      const withAssistant = [...withUser, assistantMsg]
      setMessages(withAssistant)
      await persist(withAssistant)
    } catch {
      setMessages([...withUser, { role: 'assistant', content: 'Something went wrong reaching the AI Lookup pipeline.', createdAt: new Date().toISOString() }])
    } finally {
      setLoading(false)
    }
  }

  async function send() {
    const question = input.trim()
    if (!question || loading) return
    setInput('')
    await runQuery(question, messages)
  }

  function copyMessage(mi: number, content: string) {
    navigator.clipboard.writeText(content).then(() => {
      setCopiedIndex(mi)
      if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current)
      copiedTimeoutRef.current = setTimeout(() => setCopiedIndex(null), 1500)
    }).catch(() => {})
  }

  // Editing a past question truncates everything after it (its old answer + any later turns)
  // and regenerates from there — same behavior as ChatGPT/Claude, keeps the chat a single
  // coherent thread rather than branching.
  async function submitEdit(mi: number) {
    const question = editValue.trim()
    if (!question || loading) return
    setEditingIndex(null)
    const base = messages.slice(0, mi)
    setExpanded({})
    setCrossRefsOpen({})
    await runQuery(question, base)
  }

  function newChat() {
    setActiveChatId(null)
    setMessages([])
    setExpanded({})
    setCrossRefsOpen({})
    setHistoryOpen(false)
  }

  function openChat(id: string) {
    setActiveChatId(id)
    setHistoryOpen(false)
  }

  if (!open) return null

  return (
    <div
      // Deliberately near-opaque, not a real translucent "glass" panel — see PANEL_BG comment.
      // z-[600] (Round 11, was z-50): the note editor's own popups/menus/toolbar dropdowns use
      // z-[9999]/z-[10000]/z-60 — clicking one of those while it happened to overlap this
      // panel's screen position was painting ABOVE the panel and intercepting the click (z-50
      // lost to all of them), which read as "the note thinks I'm clicking on it" even though the
      // user was clicking the panel. z-[600] sits comfortably above ordinary app chrome/floating
      // surfaces (the highest other one found was z-[500]) but still well below the 9998+ tier
      // reserved for context menus/popups — including the ones this panel spawns itself
      // (VerseCopyMenu/StrongsContextMenu, both z-[10000]), so those still correctly paint above
      // it, same as before. `.no-drag` on the FULL container now too, not just the header/resize
      // handle — this codebase has hit Electron's OS-level drag-region hit-testing bug before
      // (it ignores paint order/visibility, only screen-space overlap), and a user-resizable,
      // user-draggable panel like this one can end up overlapping the top drag-region strip.
      //
      // While Settings is open, drop below its z-50 overlay (which is otherwise well under this
      // panel's normal z-[600]) instead of sitting on top of the modal — Settings' own backdrop
      // (bg-black/50 + blur(4px)) then dims/blurs this panel exactly like it already does to the
      // rest of the app, with no separate dim treatment needed here. Also disabled so nothing
      // underneath the modal is clickable/scrollable while it's covered.
      className={`no-drag fixed flex flex-col rounded-shell-lg border border-[rgb(var(--color-surface-4))] backdrop-blur-[1px] shadow-2xl overflow-hidden ${settingsOpen ? 'z-40 pointer-events-none' : 'z-[600]'}`}
      style={{ left: pos.x, top: pos.y, width: size.width, height: size.height, ...PANEL_BG }}
    >
      {/* Header — drag handle */}
      <div
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        className="no-drag flex items-center gap-2 px-3 py-2 border-b border-[rgb(var(--color-surface-4))] cursor-grab active:cursor-grabbing select-none"
        style={HEADER_BG}
      >
        <Sparkles size={14} className="text-[rgb(var(--color-accent))] flex-shrink-0" />
        <span className="text-xs font-semibold text-[rgb(var(--color-text-primary))] flex-1 truncate">Berean Chat</span>
        <button onClick={newChat} title="New chat" className="p-1 rounded hover:bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] cursor-pointer">
          <Plus size={14} />
        </button>
        <button onClick={() => setHistoryOpen((v) => !v)} title="Chat history" className={`p-1 rounded hover:bg-[rgb(var(--color-surface-4))] cursor-pointer ${historyOpen ? 'text-[rgb(var(--color-accent))]' : 'text-[rgb(var(--color-text-muted))]'}`}>
          <HistoryIcon size={14} />
        </button>
        <button
          // Speed round: used to also call window.aiLookup.unloadModel() here, which forced an
          // immediate Ollama unload on every panel close — guaranteeing the NEXT open pays a cold
          // model load (~2.7s) even if the user reopens seconds later (e.g. accidental close, or
          // closing just to glance at a verse). The idle-unload timer in electron/ollama.ts
          // already reclaims the memory once the user has genuinely stopped asking questions;
          // closing the panel doesn't need its own, more aggressive unload path on top of that.
          onClick={() => setOpen(false)}
          title="Close"
          className="p-1 rounded hover:bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] cursor-pointer"
        >
          <X size={14} />
        </button>
      </div>

      {/* Commentary / Deep search — floating pill toggles sharing one row instead of two
          full-width settings rows. No bg of their own, so the panel's own near-opaque
          background shows through. Hidden while viewing chat history — these settings apply
          to the NEXT question, which isn't relevant while just browsing past chats. */}
      {!historyOpen && (
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-[rgb(var(--color-surface-4))]">
          <button
            onClick={() => setCommentaryOn(!commentaryOn)}
            className={`flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full border transition-colors cursor-pointer ${
              commentaryOn
                ? 'bg-[rgb(var(--color-accent))] border-[rgb(var(--color-accent))] text-white shadow-sm'
                : 'border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] hover:border-[rgb(var(--color-accent))]'
            }`}
          >
            <MessageSquareText size={11} /> Commentary
          </button>
          <button
            onClick={() => setAgenticOn(!agenticOn)}
            title="Verifies the results actually answer your question and refines the search (up to twice more) if not — slower, off by default."
            className={`flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full border transition-colors cursor-pointer ${
              agenticOn
                ? 'bg-[rgb(var(--color-accent))] border-[rgb(var(--color-accent))] text-white shadow-sm'
                : 'border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] hover:border-[rgb(var(--color-accent))]'
            }`}
          >
            <SearchCheck size={11} /> Deep search
          </button>
          <button
            onClick={() => setUseTabContext(!useTabContext)}
            title="Sends whatever's in your currently active tab (chapter, note, lexicon entry, video) as extra context — you can also just mention it inline, e.g. 'this chapter', without turning this on."
            className={`flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full border transition-colors cursor-pointer ${
              useTabContext
                ? 'bg-[rgb(var(--color-accent))] border-[rgb(var(--color-accent))] text-white shadow-sm'
                : 'border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] hover:border-[rgb(var(--color-accent))]'
            }`}
          >
            <Eye size={11} /> This tab
          </button>
        </div>
      )}

      {historyOpen ? (
        <ChatHistoryList onSelect={openChat} onClose={() => setHistoryOpen(false)} />
      ) : (
        <>
          <div ref={bodyRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
            {!availability.available && availability.checked && (
              <div className="text-xs text-[rgb(var(--color-text-muted))] bg-[rgb(var(--color-surface-2))] rounded-shell p-3 leading-relaxed">
                Ollama isn't running on this machine. Install it from{' '}
                <button className="text-[rgb(var(--color-accent))] underline cursor-pointer" onClick={() => window.app.openExternal('https://ollama.com')}>ollama.com</button>
                {' '}and pull a model (e.g. <code>ollama pull gemma3:4b</code>), then reopen this panel.
              </div>
            )}
            {messages.length === 0 && availability.available && (
              <p className="text-xs text-[rgb(var(--color-text-muted))] text-center pt-6">
                Ask where something is in Scripture, or for verses about a topic — e.g. "{examplePrompt}"
              </p>
            )}
            {messages.map((m, mi) => {
              // A pending placeholder with nothing in it yet renders NOTHING — the loading
              // indicator below already says work is happening, and drawing an empty assistant
              // bubble beside it read as the panel flickering (reported during Deep search,
              // where no partial is emitted at all, so the placeholder stayed empty for the
              // whole run). The moment a partial or the final answer fills it, it renders
              // normally. Deliberately checks for real CONTENT rather than just `pending`, so a
              // partial that arrives with results still shows immediately.
              if (m.role === 'assistant' && m.pending && !m.content && !m.summary
                  && !m.results?.length && !m.strongsCard && !m.notes?.length && !m.videos?.length) {
                return null
              }
              if (m.role === 'user') {
                const isEditing = editingIndex === mi
                if (isEditing) {
                  return (
                    <div key={mi} className="flex justify-end">
                      <div className="max-w-[85%] w-full flex items-end gap-1">
                        <AutoGrowTextarea
                          autoFocus
                          value={editValue}
                          onChange={setEditValue}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitEdit(mi) }
                            if (e.key === 'Escape') setEditingIndex(null)
                          }}
                          className="flex-1 min-w-0 text-xs bg-[rgb(var(--color-surface-2))] rounded-shell px-2.5 py-1.5 outline-none border border-[rgb(var(--color-accent))] text-[rgb(var(--color-text-primary))]"
                        />
                        <button onClick={() => submitEdit(mi)} title="Save & regenerate" className="p-1 rounded hover:bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-accent))] cursor-pointer flex-shrink-0">
                          <Send size={12} />
                        </button>
                        <button onClick={() => setEditingIndex(null)} title="Cancel" className="p-1 rounded hover:bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] cursor-pointer flex-shrink-0">
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                  )
                }
                return (
                  <div key={mi} className="group flex justify-end items-center gap-1">
                    <button
                      onClick={() => copyMessage(mi, m.content)}
                      title="Copy message"
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] cursor-pointer flex-shrink-0"
                    >
                      {copiedIndex === mi ? <Check size={11} className="text-[rgb(var(--color-accent))]" /> : <Copy size={11} />}
                    </button>
                    <button
                      onClick={() => { setEditingIndex(mi); setEditValue(m.content) }}
                      title="Edit & regenerate"
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] cursor-pointer flex-shrink-0"
                    >
                      <Pencil size={11} />
                    </button>
                    <div className="max-w-[85%] rounded-shell bg-[rgb(var(--color-accent))/14] text-[rgb(var(--color-text-primary))] text-xs px-3 py-2">{m.content}</div>
                  </div>
                )
              }
              const keywords = m.keywords ?? []
              // Word-replacer-transformed for highlighting so <mark> spans still land inside
              // the also-transformed display text below (e.g. a "Jesus" keyword highlights
              // correctly even when the verse text itself now displays as "Yeshua").
              const displayKeywords = activeWordReplacerRules.length > 0
                ? keywords.map((k) => applyWordReplacer(k, activeWordReplacerRules))
                : keywords
              const primary = (m.results ?? []).filter((r) => r.source !== 'cross-ref')
              const crossRefsByParent = new Map<string, AiLookupResult[]>()
              for (const r of m.results ?? []) {
                if (r.source !== 'cross-ref' || !r.crossRefOf) continue
                const key = `${r.crossRefOf.bookId}|${r.crossRefOf.chapter}|${r.crossRefOf.verse}`
                if (!crossRefsByParent.has(key)) crossRefsByParent.set(key, [])
                crossRefsByParent.get(key)!.push(r)
              }
              const shown = expanded[mi] ?? m.visibleCount ?? primary.length
              const visiblePrimary = primary.slice(0, shown)
              const hasMore = shown < primary.length

              return (
                <div key={mi} className="flex justify-start">
                  <div className="max-w-full w-full space-y-2">
                    {m.content && <p className="text-xs text-[rgb(var(--color-text-muted))]">{m.content}</p>}
                    {m.summary && (
                      // Deterministic branches (quote-lookup, notes-only) always return
                      // `keywords: []` — the normal guess/keyword pipeline never does, since it
                      // comes straight from the extraction call. That's the signal used to pick
                      // badge (label-like, not AI prose) vs the plain italic "AI thinking out
                      // loud" styling — even when Commentary produced a real narrated summary
                      // for a deterministic branch, it still reads as a label, per feedback that
                      // these shouldn't look like a chat reply.
                      keywords.length === 0
                        ? <SourceBadge text={m.summary} />
                        : <p className="text-xs text-[rgb(var(--color-text-primary))] italic">{m.summary}</p>
                    )}
                    {m.strongsCard && <StrongsCard card={m.strongsCard} />}
                    {(m.notes ?? []).length > 0 && (
                      <div className="space-y-1.5">
                        {m.notes!.map((n) => <NoteCard key={n.id} note={n} />)}
                      </div>
                    )}
                    {(m.videos ?? []).length > 0 && (
                      <div className="space-y-1.5">
                        {m.videos!.map((v) => <VideoCard key={v.videoId} video={v} />)}
                      </div>
                    )}

                    {/* Round: item #2 — verses are supporting material now, not something
                        `notesAreThePrimaryAnswer` hides outright. Notes/videos above already
                        render first when they lead, so a scripture answer found ALONGSIDE a real
                        note match still reaches the user instead of being silently discarded —
                        the exact bug this round fixes (runLookup used to return zero verses
                        whenever a note was found, even with a genuinely better scripture answer
                        sitting right there). `notesAreThePrimaryAnswer` still means what its name
                        says — notes are the headline — it just no longer means "and nothing
                        else is shown." */}
                    {visiblePrimary.map((r, ri) => {
                      const nested = crossRefsByParent.get(`${r.bookId}|${r.chapter}|${r.verse}`) ?? []
                      const crKey = `${mi}-${ri}`
                      const crOpen = crossRefsOpen[crKey] ?? false
                      return (
                        <div key={ri}>
                          <button
                            onClick={() => navigateToResult(r, [...messages].slice(0, mi).reverse().find((mm) => mm.role === 'user')?.content)}
                            onContextMenu={(e) => verseCopy.open(e, {
                              bookId: r.bookId, chapter: r.chapter, verse: r.verse, endVerse: r.endVerse,
                              text: r.text, lxx: r.textId === 'lxx',
                            })}
                            className="w-full text-left rounded-shell border border-[rgb(var(--color-surface-4))] hover:border-[rgb(var(--color-accent))] bg-[rgb(var(--color-surface-2))] px-2.5 py-2 transition-colors cursor-pointer"
                          >
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <span className="text-[11px] font-semibold text-[rgb(var(--color-text-primary))]">
                                {r.bookName} {r.chapter}:{r.verse}{r.endVerse ? `-${r.endVerse}` : ''}
                              </span>
                              {r.noted && <BookMarked size={11} className="text-[rgb(var(--color-accent))]" />}
                            </div>
                            <p className="text-[11px] text-[rgb(var(--color-text-secondary))] leading-snug">
                              <HighlightedText
                                text={activeWordReplacerRules.length > 0 ? applyWordReplacer(r.text, activeWordReplacerRules) : r.text}
                                keywords={displayKeywords}
                              />
                            </p>
                            {r.commentary && <p className="text-[11px] text-[rgb(var(--color-accent))] mt-1 leading-snug">{r.commentary}</p>}
                          </button>
                          {nested.length > 0 && (
                            <>
                              <button
                                onClick={(e) => { e.stopPropagation(); setCrossRefsOpen((prev) => ({ ...prev, [crKey]: !crOpen })) }}
                                className="mt-1 flex items-center gap-1 text-[10px] text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-accent))] cursor-pointer"
                              >
                                {crOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                                <Link2 size={10} /> {nested.length} related
                              </button>
                              {crOpen && (
                                // Same rounded-bubble language as the primary result above, just
                                // smaller/more muted (tighter padding, smaller text, no border
                                // accent color on hover) so they read as "part of the same
                                // family" instead of a plain indented list — the earlier
                                // reported "too much line spacing" was this being laid out as a
                                // loose text row rather than a compact card like this.
                                <div className="ml-3 mt-1 flex flex-wrap gap-1">
                                  {nested.map((cr, ci) => (
                                    <button
                                      key={ci}
                                      onClick={() => navigateToResult(cr, [...messages].slice(0, mi).reverse().find((mm) => mm.role === 'user')?.content)}
                                      onContextMenu={(e) => verseCopy.open(e, { bookId: cr.bookId, chapter: cr.chapter, verse: cr.verse, text: cr.text, lxx: cr.textId === 'lxx' })}
                                      className="text-left rounded-shell border border-[rgb(var(--color-surface-4))] hover:border-[rgb(var(--color-accent))] bg-[rgb(var(--color-surface-2))]/70 px-2 py-1 transition-colors cursor-pointer max-w-full"
                                    >
                                      <span className="text-[10px] font-semibold text-[rgb(var(--color-text-secondary))]">{cr.bookName} {cr.chapter}:{cr.verse}</span>
                                      <p className="text-[10px] text-[rgb(var(--color-text-muted))] leading-tight mt-0.5 line-clamp-2">
                                        {activeWordReplacerRules.length > 0 ? applyWordReplacer(cr.text, activeWordReplacerRules) : cr.text}
                                      </p>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )
                    })}

                    {hasMore && (
                      <button
                        onClick={() => setExpanded((prev) => ({ ...prev, [mi]: primary.length }))}
                        className="w-full flex items-center justify-center gap-1 text-[11px] text-[rgb(var(--color-accent))] hover:underline py-1 cursor-pointer"
                      >
                        <ChevronDown size={12} /> Show {primary.length - shown} more
                      </button>
                    )}

                    {/* A canonical guess that surfaced alongside a focus-text (Jubilees/Enoch/
                        etc) question — kept visible but clearly secondary, not the headline
                        answer, with a note explaining why it's here instead of leading. */}
                    {(m.related ?? []).length > 0 && (
                      <div className="pt-1 border-t border-[rgb(var(--color-surface-4))] space-y-1.5">
                        {m.relatedNote && <p className="text-[10px] text-[rgb(var(--color-text-muted))] italic">{m.relatedNote}</p>}
                        {m.related!.map((r, ri) => (
                          <button
                            key={ri}
                            onClick={() => navigateToResult(r, [...messages].slice(0, mi).reverse().find((mm) => mm.role === 'user')?.content)}
                            onContextMenu={(e) => verseCopy.open(e, {
                              bookId: r.bookId, chapter: r.chapter, verse: r.verse, endVerse: r.endVerse,
                              text: r.text, lxx: r.textId === 'lxx',
                            })}
                            className="w-full text-left rounded-shell border border-[rgb(var(--color-surface-4))] hover:border-[rgb(var(--color-accent))] bg-[rgb(var(--color-surface-2))]/70 px-2.5 py-1.5 transition-colors cursor-pointer"
                          >
                            <span className="text-[10px] font-semibold text-[rgb(var(--color-text-secondary))]">
                              {r.bookName} {r.chapter}:{r.verse}{r.endVerse ? `-${r.endVerse}` : ''}
                            </span>
                            <p className="text-[10px] text-[rgb(var(--color-text-muted))] leading-snug mt-0.5">
                              {activeWordReplacerRules.length > 0 ? applyWordReplacer(r.text, activeWordReplacerRules) : r.text}
                            </p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
            {loading && (
              <div className="flex items-center gap-2 text-xs text-[rgb(var(--color-text-muted))]">
                <Loader2 size={13} className="animate-spin" /> {progressStatus}
              </div>
            )}
          </div>

          <div className="flex items-end gap-2 px-2.5 py-2 border-t border-[rgb(var(--color-surface-4))]">
            <AutoGrowTextarea
              value={input}
              onChange={setInput}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              placeholder={availability.available ? 'Ask where something is, or for verses about a topic…' : 'Ollama not running'}
              disabled={!availability.available || loading}
              className="flex-1 min-w-0 text-xs bg-[rgb(var(--color-surface-2))] rounded-shell px-2.5 py-1.5 outline-none border border-transparent focus:border-[rgb(var(--color-accent))] disabled:opacity-50 text-[rgb(var(--color-text-primary))]"
            />
            <button
              onClick={send}
              disabled={!availability.available || loading || !input.trim()}
              className="p-1.5 rounded-shell bg-[rgb(var(--color-accent))] text-white disabled:opacity-40 cursor-pointer disabled:cursor-default flex-shrink-0"
            >
              <Send size={13} />
            </button>
          </div>
        </>
      )}
      <VerseCopyMenu target={verseCopy.target} onClose={verseCopy.close} />

      {/* Resize handle — bottom-right corner, standard affordance. Min size is the panel's
          original fixed dimensions; max is bounded (see MAX_WIDTH/MAX_HEIGHT) so it can grow to
          something genuinely more useful without taking over the screen. */}
      <div
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        title="Resize"
        className="no-drag absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize touch-none"
      >
        <svg viewBox="0 0 16 16" className="w-full h-full text-[rgb(var(--color-text-muted))] opacity-50">
          <path d="M14 2 L2 14 M14 8 L8 14" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  )
}
