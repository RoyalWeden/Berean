import { createContext, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { ChevronDown, Eye, EyeOff, MessageCircle, Pin, SquarePen, Inbox } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverSurface, MenuItem, MenuSeparator, SearchField, cx } from '@/components/ui'
import type { AiLookupChatSummary } from '@/types/electron'
import { CHAT_AI_MODES, chatModeInfo, type ChatAiMode } from './chatModes'
import { formatHistoryTime } from './ChatHistoryList'
import { UNFILED_CHAT_TITLE } from './chatModel'

/** The composer keeps its accessory row on screen while one of these popovers is open (focus
 *  moves into the popover, which would otherwise read as "the composer went idle"). */
export const ComposerPopoverContext = createContext<{ report: (open: boolean) => void; anchor: RefObject<HTMLElement | null> } | null>(null)
/** Accessory popovers open above the whole composer, never over the text being typed: the
 *  chip stays the anchor, and the offset clears the capsule above it (measured when opening). */
function useReportedOpen(trigger: RefObject<HTMLElement | null>) {
  const ctx = useContext(ComposerPopoverContext)
  const [open, setOpenState] = useState(false)
  const [offset, setOffset] = useState(6)
  const setOpen = (o: boolean) => {
    if (o) {
      const cap = ctx?.anchor.current?.getBoundingClientRect()
      const chip = trigger.current?.getBoundingClientRect()
      setOffset(cap && chip ? Math.max(6, Math.round(chip.top - cap.top) + 6) : 6)
    }
    setOpenState(o)
    ctx?.report(o)
  }
  useEffect(() => () => ctx?.report(false), []) // eslint-disable-line react-hooks/exhaustive-deps
  return [open, setOpen, offset] as const
}

// ─── Mode ─────────────────────────────────────────────────────────────────────

/** "Commentary ▾" in the composer's accessory row (Ask Berean armed): the mode for this send. */
export function ChatModeMenu({ mode, onChange, disabled }: { mode: ChatAiMode; onChange: (m: ChatAiMode) => void; disabled?: boolean }) {
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen, offset] = useReportedOpen(triggerRef)
  const info = chatModeInfo(mode)
  const Icon = info.icon
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          aria-label={`Ask Berean mode: ${info.label}`}
          aria-haspopup="menu"
          onMouseDown={(e) => e.preventDefault()}
          className="chat-acc-chip is-accent no-drag focus-ring"
        >
          <Icon size={12} strokeWidth={2} aria-hidden />
          <span>{info.label}</span>
          <ChevronDown size={10} strokeWidth={2.25} aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverSurface side="top" sideOffset={offset} align="end" role="menu" aria-label="Ask Berean mode" innerClassName="p-1 w-[248px]" onEscapeKeyDown={(e) => e.stopPropagation()}>
        {CHAT_AI_MODES.map((m, i) => (
          <div key={m.id}>
            {i === 2 && <MenuSeparator />}
            <MenuItem icon={m.icon} label={m.label} description={m.hint} active={mode === m.id} onClick={() => { onChange(m.id); setOpen(false) }} />
          </div>
        ))}
      </PopoverSurface>
    </Popover>
  )
}

// ─── This Tab ─────────────────────────────────────────────────────────────────

export interface TabContextState {
  /** What the active tab is ("John 3", a note's title…), null when it has nothing to include. */
  label: string | null
  /** The toggle is on. */
  on: boolean
  /** The message itself mentions the tab ("this chapter") — it is included regardless. */
  mentioned: boolean
}

/** Include This Tab: a separate toggle (context, not a mode). Shows what it will send. */
export function ChatContextToggle({ state, onToggle }: { state: TabContextState; onToggle: () => void }) {
  const usable = !!state.label
  const included = usable && (state.on || state.mentioned)
  const title = !usable
    ? 'This tab has nothing Ask Berean can read'
    : state.mentioned && !state.on
      ? `Included because your message mentions it: ${state.label}`
      : included ? `Ask Berean will read ${state.label}` : `Include ${state.label} as context`
  return (
    <button
      type="button"
      aria-pressed={included}
      aria-disabled={!usable || (state.mentioned && !state.on) || undefined}
      title={title}
      aria-label={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => { if (usable && !(state.mentioned && !state.on)) onToggle() }}
      className={cx('chat-acc-chip no-drag focus-ring', included ? 'is-on' : 'is-off', !usable && 'is-unavailable')}
    >
      {included ? <Eye size={12} strokeWidth={2} aria-hidden /> : <EyeOff size={12} strokeWidth={2} aria-hidden />}
      <span className="truncate max-w-[140px]">{included ? state.label : 'This Tab'}</span>
    </button>
  )
}

// ─── Conversation ─────────────────────────────────────────────────────────────

const PAGE = 40

/** Conversations matching every word of `query` in the title or preview — title hits first.
 *  Summaries only (no message bodies are loaded), so it stays instant with thousands. */
export function filterConversations(summaries: readonly AiLookupChatSummary[], query: string): AiLookupChatSummary[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const last = (s: AiLookupChatSummary) => s.lastMessageAt ?? s.updated_at
  if (!words.length) {
    const pinned = summaries.filter((s) => s.pinnedAt).sort((a, b) => (b.pinnedAt! > a.pinnedAt! ? 1 : -1))
    return [...pinned, ...summaries.filter((s) => !s.pinnedAt).sort((a, b) => last(b).localeCompare(last(a)))]
  }
  const scored: Array<{ s: AiLookupChatSummary; score: number }> = []
  for (const s of summaries) {
    const title = s.title.toLowerCase()
    const hay = `${title}\n${(s.preview ?? '').toLowerCase()}`
    if (!words.every((w) => hay.includes(w))) continue
    const score = title.startsWith(words[0]) ? 3 : words.every((w) => title.includes(w)) ? 2 : 1
    scored.push({ s, score })
  }
  return scored.sort((a, b) => b.score - a.score || last(b.s).localeCompare(last(a.s))).map((x) => x.s)
}

export interface ChatDestination {
  /** 'conversation' → the open conversation (null id = a new, unsaved one); 'unfiled' → saved
   *  only to All Messages (no conversation). */
  kind: 'conversation' | 'unfiled'
  chatId: string | null
  title: string
}

/**
 * The composer's conversation selector: which conversation the next message goes to. Opens a
 * searchable picker — distinct from global Chat search (which finds messages) and from ⌘F (which
 * finds within this conversation).
 */
export function ChatConversationPicker({ destination, summaries, allowUnfiled, onPick, onPickUnfiled, onNew }: {
  destination: ChatDestination
  summaries: readonly AiLookupChatSummary[]
  /** All Messages / a day: "Unfiled" (no conversation) is a choice. */
  allowUnfiled: boolean
  onPick: (chatId: string) => void
  onPickUnfiled?: () => void
  onNew: () => void
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen, offset] = useReportedOpen(triggerRef)
  const label = destination.kind === 'unfiled' ? UNFILED_CHAT_TITLE : destination.chatId ? destination.title : 'New Conversation'
  const Icon = destination.kind === 'unfiled' ? Inbox : destination.chatId ? MessageCircle : SquarePen
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          aria-label={`Conversation: ${label}`}
          aria-haspopup="dialog"
          onMouseDown={(e) => e.preventDefault()}
          className="chat-acc-chip is-quiet no-drag focus-ring min-w-0"
        >
          <Icon size={12} strokeWidth={1.9} aria-hidden className="flex-shrink-0" />
          <span className="truncate">{label}</span>
          <ChevronDown size={10} strokeWidth={2.25} aria-hidden className="flex-shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverSurface side="top" sideOffset={offset} align="end" aria-label="Choose a conversation" innerClassName="w-[320px] max-w-[calc(100vw-24px)] p-0 overflow-hidden" onEscapeKeyDown={(e) => e.stopPropagation()}>
        {open && (
          <ConversationPickerBody
            destination={destination}
            summaries={summaries}
            allowUnfiled={allowUnfiled}
            onDone={() => setOpen(false)}
            onPick={onPick}
            onPickUnfiled={onPickUnfiled}
            onNew={onNew}
          />
        )}
      </PopoverSurface>
    </Popover>
  )
}

function ConversationPickerBody({ destination, summaries, allowUnfiled, onDone, onPick, onPickUnfiled, onNew }: {
  destination: ChatDestination; summaries: readonly AiLookupChatSummary[]; allowUnfiled: boolean
  onDone: () => void; onPick: (id: string) => void; onPickUnfiled?: () => void; onNew: () => void
}) {
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(PAGE)
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement | null>(null)
  const results = useMemo(() => filterConversations(summaries, query), [summaries, query])
  const visible = results.slice(0, shown)
  useEffect(() => { listRef.current?.querySelector<HTMLElement>(`[data-pick-index="${active}"]`)?.scrollIntoView({ block: 'nearest' }) }, [active])

  // Fixed rows first (New Conversation, Unfiled), then the conversations — one keyboard order.
  const fixed: Array<{ key: string; run: () => void }> = [
    { key: 'new', run: () => { onNew(); onDone() } },
    ...(allowUnfiled && onPickUnfiled ? [{ key: 'unfiled', run: () => { onPickUnfiled(); onDone() } }] : []),
  ]
  const total = fixed.length + visible.length
  // Typing a query puts the first matching conversation under Return; an empty query, New Conversation.
  useEffect(() => { setActive(query.trim() ? fixed.length : 0); setShown(PAGE) }, [query]) // eslint-disable-line react-hooks/exhaustive-deps
  const runAt = (i: number) => { if (i < fixed.length) fixed[i].run(); else { const s = visible[i - fixed.length]; if (s) { onPick(s.id); onDone() } } }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(total - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); runAt(active) }
  }
  const selectedId = destination.kind === 'conversation' ? destination.chatId : null
  // The current destination reads as selected by its highlight (sidebar selection), not a check.
  const rowClass = (i: number, selected = false) => cx('chat-pick-row focus-ring', active === i && 'is-active', selected && 'is-selected')

  return (
    <div onKeyDown={onKeyDown} className="flex flex-col max-h-[min(440px,70vh)]">
      <div className="p-2 pb-1.5 flex-shrink-0">
        <SearchField autoFocus value={query} onValueChange={setQuery} placeholder="Search Conversations" aria-label="Search conversations" />
      </div>
      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-1 pb-1" role="listbox" aria-label="Conversations">
        <button type="button" role="option" aria-selected={false} data-pick-index={0} className={cx(rowClass(0), 'text-accent')} onMouseEnter={() => setActive(0)} onClick={() => runAt(0)}>
          <SquarePen size={14} strokeWidth={1.9} className="flex-shrink-0" aria-hidden />
          <span className="chat-pick-title">New Conversation</span>
        </button>
        {allowUnfiled && onPickUnfiled && (
          <button type="button" role="option" aria-selected={destination.kind === 'unfiled'} data-pick-index={1} className={rowClass(1, destination.kind === 'unfiled')} onMouseEnter={() => setActive(1)} onClick={() => runAt(1)}>
            <Inbox size={14} strokeWidth={1.9} className="flex-shrink-0 text-text-muted" aria-hidden />
            <span className="flex-1 min-w-0">
              <span className="chat-pick-title block">{UNFILED_CHAT_TITLE}</span>
              <span className="chat-pick-preview block">Messages that aren’t in a conversation</span>
            </span>
          </button>
        )}
        <div className="chat-pick-heading">{query.trim() ? `${results.length} Conversation${results.length === 1 ? '' : 's'}` : 'Recent Conversations'}</div>
        {visible.length === 0 && (
          <div className="px-3 py-4 text-center text-caption text-text-muted">
            {summaries.length === 0 ? 'No conversations yet.' : `No conversations match “${query.trim()}”.`}
          </div>
        )}
        {visible.map((s, j) => {
          const i = fixed.length + j
          const selected = s.id === selectedId
          return (
            <button key={s.id} type="button" role="option" aria-selected={selected} data-pick-index={i} className={rowClass(i, selected)} onMouseEnter={() => setActive(i)} onClick={() => runAt(i)}>
              {s.pinnedAt
                ? <Pin size={13} strokeWidth={1.9} className="flex-shrink-0 text-text-muted self-start mt-[3px]" aria-label="Pinned" />
                : <MessageCircle size={13} strokeWidth={1.9} className="flex-shrink-0 text-text-muted self-start mt-[3px]" aria-hidden />}
              <span className="flex-1 min-w-0">
                <span className="flex items-baseline gap-2">
                  <span className="chat-pick-title flex-1">{s.title}</span>
                  <span className="chat-pick-time">{formatHistoryTime(s.lastMessageAt ?? s.updated_at)}</span>
                </span>
                {s.preview && <span className="chat-pick-preview block">{s.preview}</span>}
              </span>
            </button>
          )
        })}
        {results.length > visible.length && (
          <button type="button" className="w-full py-1.5 text-caption text-accent hover:underline focus-ring rounded-chip" onClick={() => setShown((n) => n + PAGE)}>
            Show {Math.min(PAGE, results.length - visible.length)} More
          </button>
        )}
      </div>
    </div>
  )
}
