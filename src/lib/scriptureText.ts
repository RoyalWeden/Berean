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

/** Swap a word for the replacement, keeping a possessive and surrounding punctuation ("LORD's," →
 *  "Yehovah's,"). */
export function replaceWordKeepingAffixes(word: string, replacement: string): string {
  const m = word.match(/^(\W*)([A-Za-z]+)('[Ss])?(\W*)$/)
  if (!m) return replacement
  const [, lead, , poss, trail] = m
  return lead + replacement + (poss ? "'s" : '') + (trail ?? '')
}

/**
 * Display text for a SEARCH HIT. A Word Replacer bridge hit (typed "Yehovah" → verses carrying
 * H3068/H3069) comes from occurrence rows with no tagged text, so the Strong's-number rule cannot
 * run on it; the restored word is put back at the matched word positions instead, then the plain
 * rules run. Every other hit is shown exactly as the reader shows it ({@link displayVerseText}).
 */
export function displayHitText(
  hit: { text: string; text_tagged?: string | null; textId: string; strongsWords?: number[]; wrReplacement?: string },
  opts: ScriptureTextOptions = {},
): string {
  if (hit.text_tagged || !hit.wrReplacement || !hit.strongsWords?.length) return displayVerseText(hit.text, hit.text_tagged ?? null, hit.textId, opts)
  const idx = new Set(hit.strongsWords)
  const swapped = hit.text.split(' ').map((w, i) => (idx.has(i) ? replaceWordKeepingAffixes(w, hit.wrReplacement!) : w)).join(' ')
  return displayVerseText(swapped, null, hit.textId === 'kjva' ? 'plain' : hit.textId, opts)
}
