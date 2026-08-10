import { useEffect, useRef, useState, useLayoutEffect, Fragment } from 'react'
import { X, Send, Loader2, Plus, History as HistoryIcon, Sparkles, ChevronDown, ChevronRight, BookMarked, Link2, MessageSquareText, SearchCheck, Pencil, StickyNote, BookOpenText, Quote } from 'lucide-react'
import { useAppStore } from '@/store'
import { VerseCopyMenu, useVerseCopyMenu } from '@/components/bible/VerseCopyMenu'
import { applyWordReplacer } from '@/lib/wordReplacer'
import type { AiLookupChatMessage, AiLookupResult, AiLookupNoteResult, AiLookupStrongsCard } from '@/types/electron'
import ChatHistoryList from './ChatHistoryList'

const PANEL_WIDTH = 380
const PANEL_HEIGHT = 520
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

function defaultPos() {
  if (typeof window === 'undefined') return { x: 0, y: 0 }
  return {
    x: window.innerWidth - PANEL_WIDTH - MARGIN,
    y: window.innerHeight - PANEL_HEIGHT - MARGIN,
  }
}

function clampPos(pos: { x: number; y: number }) {
  const maxX = Math.max(MARGIN, window.innerWidth - PANEL_WIDTH - MARGIN)
  const maxY = Math.max(MARGIN, window.innerHeight - PANEL_HEIGHT - MARGIN)
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

export default function AiLookupPanel() {
  // LazyOnce (App.tsx) mounts this once `aiLookupPanelOpen` first becomes true and then
  // keeps it mounted forever (same pattern as SettingsModal/HistoryModal/TasksPanel) — so
  // this component, not LazyOnce, is responsible for hiding itself on later closes.
  const open = useAppStore((s) => s.aiLookupPanelOpen)
  const setOpen = useAppStore((s) => s.setAiLookupPanelOpen)
  const commentaryOn = useAppStore((s) => s.aiLookupCommentaryOn)
  const setCommentaryOn = useAppStore((s) => s.setAiLookupCommentaryOn)
  const agenticOn = useAppStore((s) => s.aiLookupAgenticOn)
  const setAgenticOn = useAppStore((s) => s.setAiLookupAgenticOn)
  const storedPos = useAppStore((s) => s.aiLookupPanelPos)
  const setStoredPos = useAppStore((s) => s.setAiLookupPanelPos)
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

  const [pos, setPos] = useState(() => storedPos ?? defaultPos())
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)

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
    setPos(clampPos({ x: dragRef.current.origX + dx, y: dragRef.current.origY + dy }))
  }
  function onDragEnd() {
    dragRef.current = null
    setStoredPos(pos)
  }

  function navigateToResult(r: AiLookupResult) {
    const state = useAppStore.getState()
    const activeId = state.activeTabId.scripture
    const activeScripture = activeId ? state.tabs.scripture.find((t) => t.id === activeId) : null
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
  }

  async function persist(nextMessages: AiLookupChatMessage[]) {
    const title = nextMessages.find((m) => m.role === 'user')?.content.slice(0, 60) || 'AI Lookup'
    const saved = await window.aiLookup.saveChat({ id: activeChatId ?? undefined, title, messages: nextMessages })
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
      const res = await window.aiLookup.query(question, {
        commentary: commentaryOn,
        agentic: agenticOn,
        wordReplacerRules: activeWordReplacerRules.length > 0
          ? activeWordReplacerRules.map((r) => ({ queries: r.queries, replacement: r.replacement }))
          : undefined,
        history,
      })
      // "Nothing found" only applies when NOTHING at all came back — a Strong's card, a notes
      // answer, or a summary/badge line are all legitimate complete answers on their own, even
      // when `results` (verse chips) is empty.
      const hasAnyAnswer = res.results.length > 0 || !!res.strongsCard || (res.notes?.length ?? 0) > 0 || !!res.summary
      const assistantMsg: AiLookupChatMessage = {
        role: 'assistant',
        content: res.error === 'ollama-unavailable'
          ? "Ollama isn't running — start it locally to use AI Lookup."
          : !hasAnyAnswer
            ? "No matching verses found — try rephrasing."
            : '',
        results: res.results,
        visibleCount: res.visibleCount,
        keywords: res.keywords,
        related: res.related,
        relatedNote: res.relatedNote,
        summary: res.summary,
        strongsCard: res.strongsCard,
        notes: res.notes,
        notesAreThePrimaryAnswer: res.notesAreThePrimaryAnswer,
        createdAt: new Date().toISOString(),
      }
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
      className="fixed z-50 flex flex-col rounded-shell-lg border border-[rgb(var(--color-surface-4))] backdrop-blur-[1px] shadow-2xl overflow-hidden"
      style={{ left: pos.x, top: pos.y, width: PANEL_WIDTH, height: PANEL_HEIGHT, ...PANEL_BG }}
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
        <button onClick={() => setOpen(false)} title="Close" className="p-1 rounded hover:bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] cursor-pointer">
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

                    {!m.notesAreThePrimaryAnswer && visiblePrimary.map((r, ri) => {
                      const nested = crossRefsByParent.get(`${r.bookId}|${r.chapter}|${r.verse}`) ?? []
                      const crKey = `${mi}-${ri}`
                      const crOpen = crossRefsOpen[crKey] ?? false
                      return (
                        <div key={ri}>
                          <button
                            onClick={() => navigateToResult(r)}
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
                                      onClick={() => navigateToResult(cr)}
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

                    {!m.notesAreThePrimaryAnswer && hasMore && (
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
                            onClick={() => navigateToResult(r)}
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
    </div>
  )
}
