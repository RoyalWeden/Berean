/**
 * Shared `text_tagged` token parser — lifted out of VerseRow.tsx so both the Bible reader
 * rendering path and the Read Aloud (TTS) spoken-text builder (extractSpokenText.ts) parse
 * `text_tagged` identically instead of maintaining two copies of the same regex logic.
 */

export interface TaggedToken {
  word: string
  strongsNum: string | string[] | null  // string[] = multi-Strongs (e.g. divided{H914|H996})
  isItalic: boolean
  isRedLetter: boolean
  isParenthetical: boolean  // true for ~{H853} tokens — grammatical particle, no English word
  isStrongsBracket: boolean // true for sup>(  sup>) alignment brackets — never rendered as plain text
}

/**
 * Parse `text_tagged` column format into structured tokens.
 * Format per token (space-separated):
 *   word{H7225}     – word with Strong's number
 *   word{}          – word present in source but no Strong's (e.g. conjunctions, articles)
 *   *word{}         – KJV italic (translator-supplied) word, no Strong's
 *   !word{G1063}    – red-letter word (Yeshua's speech) with or without Strong's
 *   ~{H853}         – parenthetical Strongs: grammatical particle, no English equivalent
 *   word{H914|H996} – multi-Strongs: word bound to multiple Hebrew/Greek roots
 */
export function parseTaggedTokens(tagged: string): TaggedToken[] {
  const tokens: TaggedToken[] = []
  for (let part of tagged.split(' ')) {
    if (!part) continue

    // Strip malformed markup fragments where '<' was dropped during data import.
    // <sup>/<blu> wrappers appear in KJVA text_tagged: sup> wraps Strong's alignment
    // brackets; blu> wraps epistolary subscription notes (e.g. "To the Galatians written
    // from Rome."). Keep the text content; drop the tag fragments.
    // Track sup> specifically: if the remaining word is only a bracket char it's a
    // Strong's alignment marker that must NOT render as visible text.
    const wasSupWrapped = /^\/sup>|^sup>/i.test(part)
    part = part.replace(/^\/sup>/i, '').replace(/^sup>/i, '')
    part = part.replace(/^\/blu>/i, '').replace(/^blu>/i, '')
    // <b>/</b> bold wrappers (seen in some Psalms) also lost their '<' — strip the fragments.
    // '>' never occurs in real verse text, so removing these anywhere is safe.
    part = part.replace(/<?\/?b>/gi, '')
    if (!part) continue

    // Parenthetical token: ~{H853} — no associated English word
    if (part.startsWith('~{') && part.endsWith('}')) {
      const strongsRaw = part.slice(2, -1).trim()
      tokens.push({ word: '', strongsNum: strongsRaw || null, isItalic: false, isRedLetter: false, isParenthetical: true, isStrongsBracket: false })
      continue
    }

    const isRedLetter = part.startsWith('!')
    const afterRed = isRedLetter ? part.slice(1) : part
    const isItalic = afterRed.startsWith('*')
    const raw = isItalic ? afterRed.slice(1) : afterRed
    const braceIdx = raw.lastIndexOf('{')
    if (braceIdx !== -1 && raw.endsWith('}')) {
      const word = raw.slice(0, braceIdx)
      const strongsRaw = raw.slice(braceIdx + 1, -1).trim()
      // Multi-Strongs: split on '|' to get primary + secondary numbers
      const parts = strongsRaw ? strongsRaw.split('|') : []
      const strongsNum = parts.length > 1 ? parts : (parts[0] || null)
      // A sup>-wrapped bare bracket with no Strongs is a pure alignment marker, not text
      const isStrongsBracket = wasSupWrapped && !strongsNum && /^[()[\]]+$/.test(word)
      tokens.push({ word, strongsNum, isItalic, isRedLetter, isParenthetical: false, isStrongsBracket })
    } else {
      tokens.push({ word: raw, strongsNum: null, isItalic, isRedLetter, isParenthetical: false, isStrongsBracket: false })
    }
  }
  return tokens
}
