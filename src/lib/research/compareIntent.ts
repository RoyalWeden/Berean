// Detects comparison requests deterministically (spec §6.1 #7 Translation parallel, #8 Passage
// comparison) so they are answered from the bundled texts before — and independently of — any
// model. Pure; shared by desktop and iPhone. Word and Strong's comparisons are NOT handled here
// (see lexicalIntent.ts), and a question without a Scripture reference is never a comparison.

import { findReferencesInText } from './references'
import { parseStrongsIds } from './strongsId'
import type { ParsedRef } from '../parseRef'

export type CompareIntentKind = 'translation-parallel' | 'passage-compare'

export interface CompareIntent {
  kind: CompareIntentKind
  refs: ParsedRef[]
  /** Texts shown, in pane order. A translation parallel is always KJV then Brenton's LXX. */
  textIds: string[]
}

/** Most passages one comparison shows side by side. */
export const MAX_COMPARE_REFS = 4

const COMPARE_RE = /\b(compare|comparison|compared|contrast|versus|vs\.?|against|side[\s-]+by[\s-]+side|alongside|parallel)\b/i
const LXX_RE = /\b(septuagint|lxx|brenton)\b/i
const KJV_RE = /\b(kjv|king\s+james)\b/i
const READ_RE = /\bhow\s+(?:does|do|did|is|was)\b[^?]*\b(?:read|say|render|translate|translated|rendered|worded)\b/i

export function detectCompareIntent(question: string): CompareIntent | null {
  const q = question.trim()
  if (!q) return null
  // "Compare H2617 and H7356" is a Strong's comparison, answered from the lexicon.
  if (parseStrongsIds(q).length > 0) return null
  const refs = findReferencesInText(q)
  if (refs.length === 0) return null
  const asksCompare = COMPARE_RE.test(q)

  // One reference read in the KJV and the Septuagint.
  if (refs.length === 1 && LXX_RE.test(q) && (asksCompare || KJV_RE.test(q) || READ_RE.test(q))) {
    return { kind: 'translation-parallel', refs, textIds: ['kjva', 'lxx'] }
  }
  // Two to four passages, each in its own text.
  if (refs.length >= 2 && asksCompare) {
    return { kind: 'passage-compare', refs: refs.slice(0, MAX_COMPARE_REFS), textIds: [] }
  }
  return null
}
