import { MessageSquareText, SearchCheck, BookOpen, type LucideIcon } from 'lucide-react'

/**
 * Ask Berean's two independent switches (spec decisions 2, 3, 4, 13): every combination is valid.
 *
 *   Commentary  off → research only: verses, lexicon facts, occurrences, comparisons — no
 *                     interpretation (the default for new chats).
 *               on  → explanations adapted to what was asked; interpretations only when asked.
 *   Deep Search off → direct lookups plus limited automatic refinement.
 *               on  → multi-step research with a wider search. Never adds interpretation by itself.
 *
 * Include This Tab is separate again: it is what the AI receives, not how it answers.
 */
export interface ChatModeFlags { commentary: boolean; deepSearch: boolean }

export const DEFAULT_CHAT_MODE: ChatModeFlags = { commentary: false, deepSearch: false }

export const CHAT_MODE_TOGGLES: ReadonlyArray<{ key: keyof ChatModeFlags; label: string; hint: string; icon: LucideIcon }> = [
  { key: 'commentary', label: 'Commentary', hint: 'Explanations · interpretations only when you ask', icon: MessageSquareText },
  { key: 'deepSearch', label: 'Deep Search', hint: 'Researches more thoroughly · slower', icon: SearchCheck },
]

/** The composer chip's label and icon for a combination. */
export function chatModeSummary(f: ChatModeFlags): { label: string; icon: LucideIcon } {
  if (f.commentary && f.deepSearch) return { label: 'Deep Search · Commentary', icon: SearchCheck }
  if (f.deepSearch) return { label: 'Deep Search', icon: SearchCheck }
  if (f.commentary) return { label: 'Commentary', icon: MessageSquareText }
  return { label: 'Research', icon: BookOpen }
}
