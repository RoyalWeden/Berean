import { MessageSquareText, SearchCheck, BookOpen, type LucideIcon } from 'lucide-react'

/**
 * Ask Berean's modes. The request has always carried two independent switches (electron/ipc/
 * aiLookup.ts): `commentary` (write brief notes on the found passages) and `agentic` (the Deep
 * Search verification loop — checks the passages answer the question and retries; slower). The
 * composer presents them as one choice of mode:
 *
 *   Commentary     commentary on,  agentic off   (the everyday answer)
 *   Deep Search    commentary on,  agentic on
 *   Passages Only  commentary off, agentic off   (the verses alone — what "Commentary" switched
 *                                                 off used to give; kept, not removed)
 *
 * The stored switches are sent exactly as they are; picking a mode sets both. A combination no
 * mode names (Deep Search with commentary off, possible with the old separate toggles) still
 * shows as Deep Search and is still sent as stored. Include This Tab is NOT a mode: it is what the
 * AI receives, not how it answers — a separate toggle.
 */
export type ChatAiMode = 'commentary' | 'deep' | 'passages'

export const CHAT_AI_MODES: ReadonlyArray<{ id: ChatAiMode; label: string; hint: string; icon: LucideIcon }> = [
  { id: 'commentary', label: 'Commentary', hint: 'Passages with brief notes', icon: MessageSquareText },
  { id: 'deep', label: 'Deep Search', hint: 'Verifies the results · slower', icon: SearchCheck },
  { id: 'passages', label: 'Passages Only', hint: 'The verses, without notes', icon: BookOpen },
]

export function chatModeOf(commentary: boolean, deepSearch: boolean): ChatAiMode {
  return deepSearch ? 'deep' : commentary ? 'commentary' : 'passages'
}

export function chatModeFlags(mode: ChatAiMode): { commentary: boolean; deepSearch: boolean } {
  return mode === 'deep' ? { commentary: true, deepSearch: true }
    : mode === 'commentary' ? { commentary: true, deepSearch: false }
      : { commentary: false, deepSearch: false }
}

export const chatModeInfo = (mode: ChatAiMode) => CHAT_AI_MODES.find((m) => m.id === mode)!
