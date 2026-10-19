import { useEffect, useRef, useState } from 'react'
import { cx } from '@/components/ui'
import { formatDayHeading, UNFILED_CHAT_ID } from './chatModel'
import type { ChatController } from './useChatController'

/** What the transcript is showing, as a title: the conversation, "All Messages", or a day. */
export function viewTitle(c: ChatController): string {
  return c.view.kind === 'all' ? 'All Messages' : c.view.kind === 'day' ? formatDayHeading(c.view.dayKey) : c.activeTitle
}

/**
 * The chat window header's title (+ subtitle). For a saved conversation it is a button: click
 * to rename in place (Return saves, Escape cancels) — the same rename the history list offers,
 * persisted through renameChat (and synced). Other views show their name.
 */
export function ChatTitle({ c, className, align = 'center', subtitle }: { c: ChatController; className?: string; align?: 'center' | 'left'; subtitle?: string }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => { if (editing) inputRef.current?.select() }, [editing])
  useEffect(() => { setEditing(false) }, [c.activeChatId, c.view.kind])

  const renamable = c.view.kind === 'conversation' && !!c.activeChatId && c.activeChatId !== UNFILED_CHAT_ID
  const title = viewTitle(c)
  const commit = () => {
    setEditing(false)
    if (c.activeChatId && value.trim() && value.trim() !== title) void c.renameChat(c.activeChatId, value)
  }

  // Title and subtitle are plain flex items (min-w-0 + truncate): they only ellipsize when the
  // header is genuinely too narrow (a shrink-to-fit block used to cut "New Conversation" short).
  const items = align === 'center' ? 'items-center text-center' : 'items-start text-left'
  return (
    <div className={cx('flex-1 min-w-0 flex flex-col justify-center', items, className)}>
      {editing ? (
        // In place: same font, size and spot as the title, subtitle stays — only a hairline field.
        <input
          ref={inputRef}
          className="chat-rename-input is-title no-drag text-footnote font-semibold leading-tight text-text-primary"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit() }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditing(false) }
          }}
          onBlur={commit}
          aria-label="Conversation name"
          spellCheck={false}
        />
      ) : renamable ? (
        <button
          type="button"
          className="no-drag max-w-full min-w-0 truncate text-footnote font-semibold leading-tight text-text-primary rounded-chip px-[var(--chat-space-1)] -mx-[var(--chat-space-1)] hover:bg-surface-hover focus-ring"
          title={`${title} — click to rename`}
          onClick={() => { setValue(title); setEditing(true) }}
        >
          {title}
        </button>
      ) : (
        <span className="max-w-full min-w-0 truncate text-footnote font-semibold leading-tight text-text-primary select-none">{title}</span>
      )}
      {subtitle && <span className="max-w-full truncate text-meta select-none">{subtitle}</span>}
    </div>
  )
}
