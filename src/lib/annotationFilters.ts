/**
 * Regex-based annotation stripping for texts whose "hide this annotation" toggles
 * (Settings → Display, per-tab via `hiddenAnnotations`) mark up bracket/parenthetical
 * conventions directly in the plain verse text — LXX supplied words, Enoch's supply/
 * uncertain/restored brackets, Jubilees' date/bracket/restored/stanza/supply markers.
 *
 * Shared between VerseRow.tsx (main reader) and ViewerBiblePage.tsx (presenter window) so
 * toggling an annotation off in the main window hides it in the presenter too, instead of
 * the presenter carrying its own (previously nonexistent) copy of this logic.
 *
 * KJV italics and Strong's-tagged annotations are NOT handled here — those live in
 * `text_tagged` token flags (isItalic) and are filtered at the token level by callers.
 */
function cleanPunctuation(s: string): string {
  return s
    .replace(/,\s*,/g, ',')
    .replace(/\s+([,;:.!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

// A.M. date pattern: [1307 A.M.] or [1307-1320 A.M.] or [1307 Anno Mundi]
const JUB_DATE_RE = /\s*\[[\d][\d\s\-,]*\s*(?:A\.M\.|Anno\s+Mundi)\s*\]/gi
// Non-date square brackets: [text] — excludes the A.M. date form
const JUB_BRACKET_RE = /\s*\[(?![\d][\d\s\-,]*\s*(?:A\.M\.|Anno\s+Mundi))[^\]]*\]/g
// Angle brackets: <text>
const JUB_RESTORED_RE = /\s*<([^>]*)>/g
// Single-letter stanza markers: (b) (c) (d)
const JUB_STANZA_RE = /\s*\([a-z]\)\s*/g
// Parenthetical supply: (word) — but NOT single letters (those are stanza markers)
const JUB_SUPPLY_RE = /\s*\((?![a-z]\))([^)]*)\)/g

export function stripAnnotations(text: string, textId: string, hiddenAnnotations: string[]): string {
  if (hiddenAnnotations.length === 0) return text
  let result = text
  switch (textId) {
    case 'lxx':
      if (hiddenAnnotations.includes('lxx_supply')) result = result.replace(/\s*\[([^\]]*)\]/g, '')
      return cleanPunctuation(result)
    case 'enoch':
      if (hiddenAnnotations.includes('enoch_supply'))    result = result.replace(/\s*\(([^)]*)\)/g, '')
      if (hiddenAnnotations.includes('enoch_uncertain')) result = result.replace(/\s*\[([^\]]*)\]/g, '')
      if (hiddenAnnotations.includes('enoch_restored'))  result = result.replace(/\s*〈([^〉]*)〉/g, '')
      return cleanPunctuation(result)
    case 'jubilees':
      // Strip in a specific order so regexes don't interfere with each other
      if (hiddenAnnotations.includes('jubilees_date'))     result = result.replace(JUB_DATE_RE, '')
      if (hiddenAnnotations.includes('jubilees_bracket'))  result = result.replace(JUB_BRACKET_RE, '')
      if (hiddenAnnotations.includes('jubilees_restored')) result = result.replace(JUB_RESTORED_RE, '')
      if (hiddenAnnotations.includes('jubilees_stanza'))   result = result.replace(JUB_STANZA_RE, ' ')
      if (hiddenAnnotations.includes('jubilees_supply'))   result = result.replace(JUB_SUPPLY_RE, '')
      return cleanPunctuation(result)
    default:
      return text
  }
}
