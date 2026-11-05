/**
 * Persisted-state migration for Ask Berean's mode switches (spec §0.9, §2.1, decision 13).
 *
 * Before v9 the composer offered three modes and the default was Commentary (commentary on,
 * Deep Search off). New chats now default to Commentary off. A stored (on, off) cannot be told
 * apart from the old default, so it moves to the new default and `aiLookupModeNotice` is set so
 * the composer says so once, with a one-tap way back. Every other stored combination was an
 * explicit choice and is kept as-is — including the legacy Commentary off + Deep Search on,
 * which is now a supported mode (not folded into Passages Only).
 */
export interface AiModeFields {
  aiLookupCommentaryOn?: boolean
  aiLookupAgenticOn?: boolean
  aiLookupModeNotice?: boolean
}

export const AI_MODE_STORE_VERSION = 9

export function migrateAiModeState<T extends AiModeFields>(state: T, fromVersion: number): T {
  if (fromVersion >= AI_MODE_STORE_VERSION || !state || typeof state !== 'object') return state
  const commentary = state.aiLookupCommentaryOn
  const deep = state.aiLookupAgenticOn === true
  if (commentary === true && !deep) return { ...state, aiLookupCommentaryOn: false, aiLookupModeNotice: true }
  return state
}
