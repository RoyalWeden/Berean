import { forwardRef } from 'react'
import { ChatHistoryList } from './ChatHistoryList'
import type { ChatController } from './useChatController'

/**
 * Berean Chat sidebar (the standalone window's source list): the shared history list —
 * search, All Messages, Days, and conversations grouped by date. Selecting anything only
 * changes what the transcript shows; the composer draft lives elsewhere and is never lost.
 */
export const ChatSidebar = forwardRef<HTMLInputElement, { c: ChatController; onNavigate?: () => void; className?: string; inlineResults?: boolean }>(
  function ChatSidebar({ c, onNavigate, className, inlineResults }, searchRef) {
    return <ChatHistoryList ref={searchRef} c={c} onNavigate={onNavigate} inlineResults={inlineResults} className={className} />
  },
)
