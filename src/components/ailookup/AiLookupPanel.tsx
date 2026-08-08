import { useEffect, useRef, useState, Fragment } from 'react'
import { X, Send, Loader2, Plus, History as HistoryIcon, Sparkles, ChevronDown, ChevronRight, StickyNote, BookMarked, Link2 } from 'lucide-react'
import { useAppStore } from '@/store'
import Switch from '@/components/shell/Switch'
import { VerseCopyMenu, useVerseCopyMenu } from '@/components/bible/VerseCopyMenu'
import { applyWordReplacer } from '@/lib/wordReplacer'
import type { AiLookupChatMessage, AiLookupResult } from '@/types/electron'
import ChatHistoryList from './ChatHistoryList'

const PANEL_WIDTH = 380
const PANEL_HEIGHT = 520
const MARGIN = 16

const SOURCE_LABEL: Record<AiLookupResult['source'], string> = {
  keyword: 'search match',
  'ai-guess': 'AI recall',
  'cross-ref': 'cross-reference',
}
// Reuses the same alpha-varied, theme-stable accent-token pill styling as
// VerseIndicator.tsx (rounded-full, bg accent/20, text accent) — a distinct muted
// tone per source lets a user tell "the DB found this by keyword" apart from
// "the model recalled this directly" or "this came in via cross-reference" at a glance.
const SOURCE_CLASS: Record<AiLookupResult['source'], string> = {
  keyword: 'bg-[rgb(var(--color-accent))/16] text-[rgb(var(--color-accent))]',
  'ai-guess': 'bg-[rgb(var(--color-text-muted))/16] text-[rgb(var(--color-text-muted))]',
  'cross-ref': 'bg-[rgb(var(--highlight-purple)/0.20)] text-[rgb(var(--highlight-purple))]',
}

// Near-opaque (~92%, a genuinely subtle ~8% see-through), via an explicit color-mix()
// instead of a Tailwind arbitrary-value opacity modifier (`bg-[...]/NN`) — that approach
// rendered far more transparent than intended, so this sidesteps any ambiguity about
// whether/how Tailwind compiles opacity onto a fully custom `rgb(var(--x))` value.
const PANEL_BG = { backgroundColor: 'color-mix(in srgb, rgb(var(--color-surface-1)) 92%, transparent)' }
const HEADER_BG = { backgroundColor: 'color-mix(in srgb, rgb(var(--color-surface-2)) 92%, transparent)' }

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

export default function AiLookupPanel() {
  // LazyOnce (App.tsx) mounts this once `aiLookupPanelOpen` first becomes true and then
  // keeps it mounted forever (same pattern as SettingsModal/HistoryModal/TasksPanel) — so
  // this component, not LazyOnce, is responsible for hiding itself on later closes.
  const open = useAppStore((s) => s.aiLookupPanelOpen)
  const setOpen = useAppStore((s) => s.setAiLookupPanelOpen)
  const commentaryOn = useAppStore((s) => s.aiLookupCommentaryOn)
  const setCommentaryOn = useAppStore((s) => s.setAiLookupCommentaryOn)
  const storedPos = useAppStore((s) => s.aiLookupPanelPos)
  const setStoredPos = useAppStore((s) => s.setAiLookupPanelPos)
  const activeChatId = useAppStore((s) => s.aiLookupActiveChatId)
  const setActiveChatId = useAppStore((s) => s.setAiLookupActiveChatId)
  const addTab = useAppStore((s) => s.addTab)
  const updateTabState = useAppStore((s) => s.updateTabState)
  const setActiveSpace = useAppStore((s) => s.setActiveSpace)
  const requestOpenNote = useAppStore((s) => s.requestOpenNote)
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
  const [historyOpen, setHistoryOpen] = useState(false)
  // How many primary results are shown per message index, keyed by message index —
  // starts at that message's own visibleCount, bumped by "Show more".
  const [expanded, setExpanded] = useState<Record<number, number>>({})
  // Cross-references are collapsed by default (each answer was reported as "way too long"
  // with them always open) — tracked per "messageIndex-resultIndex" key, toggled open on click.
  const [crossRefsOpen, setCrossRefsOpen] = useState<Record<string, boolean>>({})
  const bodyRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    window.aiLookup.checkAvailable().then((r) => setAvailability({ checked: true, available: r.available })).catch(() => setAvailability({ checked: true, available: false }))
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

  function openNoteMatch(noteId: string) {
    requestOpenNote(noteId)
    setActiveSpace('notes')
  }

  async function persist(nextMessages: AiLookupChatMessage[]) {
    const title = nextMessages.find((m) => m.role === 'user')?.content.slice(0, 60) || 'AI Lookup'
    const saved = await window.aiLookup.saveChat({ id: activeChatId ?? undefined, title, messages: nextMessages })
    if (!activeChatId) setActiveChatId(saved.id)
  }

  async function send() {
    const question = input.trim()
    if (!question || loading) return
    setInput('')
    const userMsg: AiLookupChatMessage = { role: 'user', content: question, createdAt: new Date().toISOString() }
    const withUser = [...messages, userMsg]
    setMessages(withUser)
    setLoading(true)
    try {
      const res = await window.aiLookup.query(question, {
        commentary: commentaryOn,
        wordReplacerRules: activeWordReplacerRules.length > 0
          ? activeWordReplacerRules.map((r) => ({ queries: r.queries, replacement: r.replacement }))
          : undefined,
      })
      const assistantMsg: AiLookupChatMessage = {
        role: 'assistant',
        content: res.error === 'ollama-unavailable'
          ? "Ollama isn't running — start it locally to use AI Lookup."
          : res.results.length === 0
            ? "No matching verses found — try rephrasing."
            : '',
        results: res.results,
        visibleCount: res.visibleCount,
        keywords: res.keywords,
        noteMatches: res.noteMatches,
        summary: res.summary,
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
        <span className="text-xs font-semibold text-[rgb(var(--color-text-primary))] flex-1 truncate">AI Scripture Lookup</span>
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

      {/* Commentary toggle — no bg of its own, so the outer panel's own near-opaque
          background (see above) shows through uniformly instead of a solid patch. */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[rgb(var(--color-surface-4))]">
        <span className="text-[11px] text-[rgb(var(--color-text-muted))]">Commentary</span>
        <Switch checked={commentaryOn} onCheckedChange={() => setCommentaryOn(!commentaryOn)} />
      </div>

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
                Ask where a passage is — e.g. "where does Abraham leave his family because of idolatry?"
              </p>
            )}
            {messages.map((m, mi) => {
              if (m.role === 'user') {
                return (
                  <div key={mi} className="flex justify-end">
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
                    {m.summary && <p className="text-xs text-[rgb(var(--color-text-primary))] italic">{m.summary}</p>}

                    {(m.noteMatches ?? []).length > 0 && (
                      <div className="rounded-shell border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] p-2 space-y-1">
                        <div className="flex items-center gap-1 text-[10px] font-semibold text-[rgb(var(--color-text-muted))] uppercase tracking-wide">
                          <StickyNote size={10} /> From your notes
                        </div>
                        {m.noteMatches!.map((nm) => (
                          <button
                            key={nm.noteId}
                            onClick={() => openNoteMatch(nm.noteId)}
                            className="w-full text-left text-[11px] text-[rgb(var(--color-text-secondary))] hover:text-[rgb(var(--color-accent))] cursor-pointer"
                          >
                            <span className="font-medium">{nm.title}</span> — {nm.snippet}
                          </button>
                        ))}
                      </div>
                    )}

                    {visiblePrimary.map((r, ri) => {
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
                              <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${SOURCE_CLASS[r.source]}`}>{SOURCE_LABEL[r.source]}</span>
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
                                className="mt-0.5 flex items-center gap-1 text-[10px] text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-accent))] cursor-pointer"
                              >
                                {crOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                                <Link2 size={10} /> {nested.length} related
                              </button>
                              {crOpen && (
                                <div className="ml-3 mt-1 space-y-1 border-l-2 border-[rgb(var(--color-surface-4))] pl-2">
                                  {nested.map((cr, ci) => (
                                    <button
                                      key={ci}
                                      onClick={() => navigateToResult(cr)}
                                      onContextMenu={(e) => verseCopy.open(e, { bookId: cr.bookId, chapter: cr.chapter, verse: cr.verse, text: cr.text, lxx: cr.textId === 'lxx' })}
                                      className="w-full text-left rounded-shell hover:bg-[rgb(var(--color-surface-2))] px-1.5 py-1 transition-colors cursor-pointer"
                                    >
                                      <span className="text-[10px] font-medium text-[rgb(var(--color-text-muted))]">{cr.bookName} {cr.chapter}:{cr.verse}</span>
                                      <span className="text-[10px] text-[rgb(var(--color-text-muted))]"> — {activeWordReplacerRules.length > 0 ? applyWordReplacer(cr.text, activeWordReplacerRules) : cr.text}</span>
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
                  </div>
                </div>
              )
            })}
            {loading && (
              <div className="flex items-center gap-2 text-xs text-[rgb(var(--color-text-muted))]">
                <Loader2 size={13} className="animate-spin" /> Searching…
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 px-2.5 py-2 border-t border-[rgb(var(--color-surface-4))]">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              placeholder={availability.available ? 'Ask where a passage is…' : 'Ollama not running'}
              disabled={!availability.available || loading}
              className="flex-1 min-w-0 text-xs bg-[rgb(var(--color-surface-2))] rounded-shell px-2.5 py-1.5 outline-none border border-transparent focus:border-[rgb(var(--color-accent))] disabled:opacity-50 text-[rgb(var(--color-text-primary))]"
            />
            <button
              onClick={send}
              disabled={!availability.available || loading || !input.trim()}
              className="p-1.5 rounded-shell bg-[rgb(var(--color-accent))] text-white disabled:opacity-40 cursor-pointer disabled:cursor-default"
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
