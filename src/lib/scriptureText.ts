// Single entry point for "show/copy verse text with the user's Word Replacer rules
// applied" — every surface that renders or copies scripture text (desktop panels, mobile
// study/search sheets, cross-reference lists, the floating search, copy-to-clipboard)
// should go through this instead of each inlining its own
// `enabled && rules.length ? applyWordReplacer(...) : text` check, which is how several
// surfaces (mobile cross refs, mobile search results, the Strong's occurrence sheet,
// tagged-verse lists) ended up simply never calling it at all.
//
// `buildVerseDisplayText` (verseUtils.ts) remains the actual algorithm — token-aware for
// KJVA tagged text (Strong's-number rules, "the" suppression), plain substitution for
// everything else. This module just gives it one name callers reach for and a store-bound
// convenience path so call sites don't have to thread `wordReplacerEnabled`/
// `wordReplacerRules` through props by hand.
import { useAppStore } from '@/store'
import type { WordReplacerRule } from '@/store'
import { buildVerseDisplayText } from './verseUtils'

export interface ScriptureTextOptions {
  /** Override the store's current Word Replacer settings (tests, or a caller that already
   *  has them in hand and wants to skip the store read). */
  enabled?: boolean
  rules?: WordReplacerRule[]
}

/**
 * Apply the user's Word Replacer rules to a verse's text for display or copy, exactly as
 * the Bible reader itself renders it. Reads current settings from the app store unless
 * `opts.enabled`/`opts.rules` are given explicitly.
 */
export function displayVerseText(
  text: string,
  textTagged: string | null | undefined,
  textId: string,
  opts: ScriptureTextOptions = {},
): string {
  const state = useAppStore.getState()
  const enabled = opts.enabled ?? state.wordReplacerEnabled
  const rules = opts.rules ?? state.wordReplacerRules
  return buildVerseDisplayText(text, textTagged, textId, enabled, rules)
}

/** React hook form of {@link displayVerseText} — subscribes to Word Replacer settings so
 *  components using it re-render when rules change, without each component destructuring
 *  `wordReplacerEnabled`/`wordReplacerRules` off the store itself. */
export function useScriptureText() {
  const wordReplacerEnabled = useAppStore((s) => s.wordReplacerEnabled)
  const wordReplacerRules = useAppStore((s) => s.wordReplacerRules)
  return {
    wordReplacerEnabled,
    wordReplacerRules,
    displayVerseText: (text: string, textTagged: string | null | undefined, textId: string) =>
      buildVerseDisplayText(text, textTagged, textId, wordReplacerEnabled, wordReplacerRules),
  }
}
