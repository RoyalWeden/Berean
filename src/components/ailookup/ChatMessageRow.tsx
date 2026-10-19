import { createContext, memo, useContext, useEffect, useRef, useState } from 'react'
import { Copy, Check, Pencil, Sparkles, AlertCircle, CornerUpLeft, MoreHorizontal } from 'lucide-react'
import { IconButton, cx } from '@/components/ui'
import { aiModeCaption, formatTime, messageTime, UNFILED_CHAT_ID, UNFILED_CHAT_TITLE, type ChatMsg } from './chatModel'
import { AiReplyBody } from './AiReplyBody'
import { ChatMarkdown } from './ChatMarkdown'
import { ChatReplyQuote } from './ChatReplyQuote'

/** Row actions, provided once per transcript so memoized rows never re-render for them. */
export interface ChatRowActions {
  editNote: (id: string, text: string, chatId?: string | null) => void
  editAndReask: (id: string, text: string) => void
  deleteMessage: (id: string, chatId: string | null) => void
  openConversation: (chatId: string, focusId?: string) => void
  /** False when Ask Berean can't run here (no Ollama / iPhone) — AI requests can't be re-asked. */
  canAsk: boolean
  /** Edit in the MAIN composer (TEST 2026-10-18 "editing a message shouldnt create a new textbox,
   *  but instead just open it in the main text box"). */
  startEdit?: (message: ChatMsg, chatId: string | null) => void
  /** Ask Berean about a plain message (puts it in the composer with Ask Berean armed). */
  askAbout?: (message: ChatMsg) => void
  /** Reply to a message (the composer shows "Replying to …"; the sent message quotes it). */
  startReply?: (message: ChatMsg, chatId: string | null) => void
  /** Scroll to and flash a message (a reply's quote was clicked). */
  jumpTo?: (id: string) => void
  /** Right-click on a message: the full action menu (Mac). `more`: the hover "…" — only the
   *  actions that are not already buttons beside the message. */
  openMenu?: (message: ChatMsg, chatId: string | null, at: { x: number; y: number }, opts?: { more?: boolean }) => void
}
export const ChatRowActionsContext = createContext<ChatRowActions | null>(null)
/** The message the composer is currently editing (its bubble is marked). */
/** A message whose markdown has document structure (heading, table, code fence). */
const DOC_LIKE_RE = /^[ \t]*(?:#{1,6}[ \t]+\S|```|~~~|\|.*\|[ \t]*$)/m

export const ChatEditingIdContext = createContext<string | null>(null)
/** The message whose action menu is open (its hover buttons stay visible meanwhile). */
export const ChatMenuOpenIdContext = createContext<string | null>(null)

/** An AI reply with nothing in it yet (or an error line only) is not worth quoting. */
function isEmptyReply(m: ChatMsg): boolean {
  return m.kind === 'ai-reply' && !m.content && !m.summary && !m.results?.length && !m.strongsCard && !m.notes?.length && !m.videos?.length
}

export interface ChatMessageRowProps {
  message: ChatMsg
  chatId: string | null
  chatTitle: string
  side: 'me' | 'berean'
  groupStart: boolean
  groupEnd: boolean
  timeLabel?: string
  showConversation: boolean
  /** The question an AI reply answers (Study Trail reason text). */
  question?: string
  failed: boolean
  focused: boolean
  /** On a reply: the message it answers (null = deleted since); undefined = not a reply. */
  quoted?: ChatMsg | null
  /** All Messages / a day: the swipe-in gutter names (and opens) the message's conversation. */
  crossView?: boolean
}

/**
 * One message bubble, Messages-style: the user's own notes and Ask Berean requests sit right in
 * accent bubbles (requests carry a sparkle + the options they were sent with), Berean's replies
 * are a full-width content column (no bubble) under a quiet "Berean" label. Memoized on its
 * props — the transcript passes the same message object for an unchanged message, so appending
 * one message renders one row.
 */
export const ChatMessageRow = memo(function ChatMessageRow(p: ChatMessageRowProps) {
  const actions = useContext(ChatRowActionsContext)
  const editing = useContext(ChatEditingIdContext) === p.message.id
  const m = p.message
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (copiedTimer.current) clearTimeout(copiedTimer.current) }, [])

  const isMe = p.side === 'me'
  const isRequest = m.kind === 'ai-request'
  const canEdit = !!actions?.startEdit && !m.pending && !!p.chatId && (m.kind === 'note' || (isRequest && actions.canAsk))
  const canReply = !!actions?.startReply && !m.pending && !!p.chatId && !isEmptyReply(m)
  const fullTime = new Date(messageTime(m)).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
  const time = m.pending ? '' : formatTime(messageTime(m))
  const docLike = isMe && DOC_LIKE_RE.test(m.content)

  const copy = () => {
    navigator.clipboard.writeText(m.content || m.summary || '').then(() => {
      setCopied(true)
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => setCopied(false), 1500)
    }).catch(() => {})
  }

  // Hover: the two everyday actions as buttons (Reply, Copy), everything else — Ask Berean about
  // it, Edit, Delete — in "…" (TEST 2026-10-18: five icons in a row read as clutter, and Delete
  // sat one slip away from Edit). The same full set is on right-click.
  const moreOpen = useContext(ChatMenuOpenIdContext) === m.id
  const moreWasOpen = useRef(false)
  const hasMore = !!actions?.openMenu
  const hoverActions = !m.pending && !editing && (
    <div
      className={cx('flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-fast', moreOpen && 'opacity-100', isMe ? 'order-first self-center' : 'order-last self-start mt-1')}
    >
      {canReply && <IconButton icon={CornerUpLeft} label="Reply" size={20} tooltip={false} onClick={() => actions!.startReply!(m, p.chatId)} />}
      <IconButton icon={copied ? Check : Copy} label="Copy" size={20} tooltip={false} iconClassName={copied ? 'text-accent' : undefined} onClick={copy} />
      {hasMore ? (
        <IconButton
          icon={MoreHorizontal}
          label="More Actions"
          size={20}
          tooltip={false}
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          // A toggle: pressing "…" while its menu is open closes it. The menu already closes on
          // the outside mousedown, so the click that follows must not open it again.
          onPointerDown={() => { moreWasOpen.current = moreOpen }}
          onClick={(e) => {
            if (moreWasOpen.current) { moreWasOpen.current = false; return }
            const r = e.currentTarget.getBoundingClientRect()
            actions!.openMenu!(m, p.chatId, { x: isMe ? r.right - 200 : r.left, y: r.bottom + 4 }, { more: true })
          }}
        />
      ) : canEdit && (
        <IconButton icon={Pencil} label={isRequest ? 'Edit and Ask Again' : 'Edit'} size={20} tooltip={false} onClick={() => actions!.startEdit!(m, p.chatId)} />
      )}
    </div>
  )

  // Corner rounding joins a run of bubbles (Messages): only the outer corners stay fully round.
  const radius = cx('rounded-[18px]', !p.groupStart && 'rounded-tr-[6px]', !p.groupEnd && 'rounded-br-[6px]')

  return (
    <div
      data-message-id={m.id}
      data-side={p.side}
      onContextMenu={actions?.openMenu && !m.pending ? (e) => {
        // A link / verse inside the message keeps its own menu.
        if (e.defaultPrevented || (e.target as HTMLElement).closest('a,button.chat-link')) return
        e.preventDefault()
        actions.openMenu!(m, p.chatId, { x: e.clientX, y: e.clientY })
      } : undefined}
      className={cx('chat-row px-3', p.groupStart ? 'pt-2' : 'pt-[3px]', p.focused && 'chat-row-focused')}
    >
      {p.timeLabel && <div className="chat-row-sep text-center text-caption2 text-text-muted pb-1.5 pt-1 select-none">{p.timeLabel}</div>}
      {p.showConversation && p.chatId && p.chatId !== UNFILED_CHAT_ID && actions && (
        <div className={cx('flex pb-1', isMe ? 'justify-end chat-slide' : 'justify-start')}>
          <button
            type="button"
            onClick={() => actions.openConversation(p.chatId!, m.id)}
            className="text-caption2 text-text-muted hover:text-accent truncate max-w-[70%] rounded-chip focus-ring"
            title="Open conversation"
          >
            {p.chatTitle}
          </button>
        </div>
      )}
      {isMe && isRequest && p.groupStart && (
        <div className="chat-slide flex justify-end items-center gap-1 pb-1 pr-1 text-caption2 text-accent select-none">
          <Sparkles size={10} /> {aiModeCaption(m.aiMode)}
        </div>
      )}
      {!isMe && p.groupStart && (
        <div className="flex items-center gap-1 pb-1 pl-1 text-caption2 font-medium text-text-muted select-none">
          <Sparkles size={10} className="text-accent" /> Berean
        </div>
      )}

      <div className={cx('group relative flex items-end gap-1', isMe ? 'justify-end chat-slide' : 'justify-start')}>
        {/* Swipe the transcript left to see this (useTimestampReveal): the time and which
            conversation the message is in, just past the right edge until then. */}
        {time && (
          <span className={cx('chat-reveal', !isMe && 'is-top')}>
            <span className="chat-reveal-time" aria-hidden>{time}</span>
            {p.crossView && p.chatId && actions && (
              // The same "open its conversation" as the label above a run of messages (which is
              // the accessible one) — so not a Tab stop here.
              <button type="button" tabIndex={-1} aria-hidden className="chat-reveal-conv" title="Open conversation"
                onClick={() => actions.openConversation(p.chatId!, m.id)}>
                {p.chatTitle || UNFILED_CHAT_TITLE}
              </button>
            )}
          </span>
        )}
        {isMe ? (
          <>
            {hoverActions}
            <div
              data-find-body
              title={fullTime}
              data-doc={docLike || undefined}
              className={cx(
                'min-w-0 px-3 py-[7px] text-footnote leading-snug break-words select-text',
                // A structured note (table / heading / code) reads as a page, not a text bubble:
                // a quiet neutral card (Notes) instead of a solid accent fill.
                docLike ? 'max-w-[88%] bg-surface-2 text-text-primary chat-bubble-doc' : 'max-w-[78%] bg-accent text-white',
                editing && 'chat-bubble-editing',
                radius,
              )}
            >
              {p.quoted !== undefined && <ChatReplyQuote quoted={p.quoted} tone={docLike ? 'plain' : 'accent'} onJump={actions?.jumpTo} />}
              {isRequest && <Sparkles size={11} className={cx('float-left mt-[3px] mr-1', docLike ? 'text-accent' : 'opacity-80')} aria-label="Ask Berean" />}
              <ChatMarkdown text={m.content} tone={docLike ? 'plain' : 'accent'} />
            </div>
          </>
        ) : (
          <>
            {/* Berean's answer is a content column, not a bubble (long answers, lists and tables
                need the room) — under the small "Berean" label, like a modern assistant reply. */}
            <div data-find-body title={fullTime} className="chat-ai-column flex-1 min-w-0 max-w-[680px] pl-1 pr-1 py-0.5 text-text-primary select-text">
              <AiReplyBody message={m} question={p.question} />
            </div>
            {hoverActions}
          </>
        )}
      </div>
      {/* The time is in the swipe-in gutter (Messages); under the bubble only what needs saying
          now: not saved, being edited, edited. Screen readers still get the time here. */}
      {time && !p.failed && !editing && !m.editedAt && <span className="sr-only">{fullTime}</span>}
      {(p.failed || editing || (time && m.editedAt)) && (
        <div className={cx('chat-row-meta flex pt-0.5 text-caption2 select-none', isMe ? 'justify-end pr-1 chat-slide' : 'justify-start pl-1')}>
          {p.failed
            ? <span className="inline-flex items-center gap-1 text-destructive"><AlertCircle size={10} /> Not saved</span>
            : editing
              ? <span className="inline-flex items-center gap-1 text-accent"><Pencil size={9} /> Editing</span>
              : <span className="text-text-muted" title={`Edited ${new Date(Date.parse(m.editedAt!)).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`}><span className="sr-only">{fullTime} · </span>Edited</span>}
        </div>
      )}
    </div>
  )
})
