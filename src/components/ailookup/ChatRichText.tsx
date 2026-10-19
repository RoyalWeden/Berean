import { ChatMarkdown, type ChatTone } from './ChatMarkdown'

/**
 * Compatibility name for a chat message's formatted text — now full markdown via ChatMarkdown
 * (tables, code blocks, headings, task lists on top of the original inline formatting and
 * verse / Strong's linking).
 */
export function ChatRichText({ text, tone = 'plain', className }: { text: string; tone?: ChatTone; className?: string }) {
  return <ChatMarkdown text={text} tone={tone} className={className} />
}
