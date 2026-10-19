import { CornerUpLeft, X } from 'lucide-react'
import { IconButton, cx } from '@/components/ui'
import { quoteAuthor, quoteSnippet, type ChatMsg } from './chatModel'

/**
 * The quote a reply carries (Messages / Slack): who it answers and one line of what they said.
 * In a bubble it is a button that scrolls to the original; a deleted original reads
 * "Original message deleted" and does nothing.
 */
export function ChatReplyQuote({ quoted, tone, onJump, className }: {
  /** The message replied to; null when it no longer exists. */
  quoted: ChatMsg | null
  /** On the accent bubble (white text) or a plain surface. */
  tone: 'accent' | 'plain'
  onJump?: (id: string) => void
  className?: string
}) {
  const body = quoted
    ? <><span className="chat-reply-quote-author">{quoteAuthor(quoted)}</span><span className="chat-reply-quote-text">{quoteSnippet(quoted)}</span></>
    : <span className="chat-reply-quote-text italic">Original message deleted</span>
  const cls = cx('chat-reply-quote', tone === 'accent' ? 'is-accent' : 'is-plain', className)
  if (!quoted || !onJump) return <div className={cls}>{body}</div>
  return (
    <button
      type="button"
      className={cx(cls, 'focus-ring')}
      title="Show the original message"
      aria-label={`Replying to ${quoteAuthor(quoted)}: ${quoteSnippet(quoted)}. Show the original message`}
      onClick={(e) => { e.stopPropagation(); onJump(quoted.id) }}
    >
      {body}
    </button>
  )
}

/** "Replying to …" above the composer, with a cancel button (Esc). */
export function ChatReplyBar({ quoted, onCancel, compact }: { quoted: ChatMsg; onCancel: () => void; compact?: boolean }) {
  return (
    <div className={cx('chat-reply-bar', compact && 'is-compact')} role="status" aria-label={`Replying to ${quoteAuthor(quoted)}`}>
      <CornerUpLeft size={compact ? 13 : 11} className="flex-shrink-0 text-accent" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="chat-reply-bar-label">Replying to {quoteAuthor(quoted)}</div>
        <div className="chat-reply-bar-text">{quoteSnippet(quoted)}</div>
      </div>
      <IconButton
        icon={X}
        label="Cancel Reply"
        size={compact ? 28 : 20}
        tooltip={compact ? false : { shortcut: 'esc' }}
        onMouseDown={(e) => e.preventDefault()}
        onPointerDown={(e) => e.preventDefault()}
        onClick={onCancel}
        className="flex-shrink-0 text-text-muted"
      />
    </div>
  )
}
