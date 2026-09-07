/**
 * Greedy longest-known-tag matcher for "#tag" references in note text.
 *
 * The old single-token regex (`#[\p{L}\p{N}][\p{L}\p{N}_-]*`) stopped at the first space, so a
 * multi-word tag like "Second Temple" only ever matched "#Second". This scanner, given the set
 * of known verse-tag names, resolves each "#" to the LONGEST known tag name that matches
 * (case-insensitively, spaces allowed) starting right after it, and falls back to the legacy
 * single-token rule for unknown / freshly-typed tags.
 */

// Legacy fallback: a run of letters/digits/underscore/hyphen after "#".
const FALLBACK_TOKEN_RE = /^[\p{L}\p{N}][\p{L}\p{N}_-]*/u
// A "#" only starts a tag at start-of-string or after whitespace / "(" (mirrors the old
// TAG_REF_RE lead-in), so `a#b` never matches.
const LEAD_OK = (ch: string | undefined) => ch === undefined || /\s/.test(ch) || ch === '('
// The char immediately after a matched name must be a real boundary, so "#Church" doesn't
// swallow the "History" in "#Church History" when only "Church" is a tag.
const isWordChar = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}_-]/u.test(ch)

export interface TagRefHit {
  index: number   // offset of the "#"
  length: number  // includes the "#"
  name: string    // canonical stored name (known) or the raw token (unknown)
  known: boolean
}

export interface KnownTagIndex {
  /** Canonical names bucketed by lowercased first whitespace-delimited token. */
  byFirstToken: Map<string, string[]>
}

export function buildKnownTagIndex(names: string[]): KnownTagIndex {
  const byFirstToken = new Map<string, string[]>()
  for (const name of names) {
    const trimmed = name.trim()
    if (!trimmed) continue
    const first = trimmed.split(/\s+/)[0].toLowerCase()
    const arr = byFirstToken.get(first)
    if (arr) arr.push(trimmed)
    else byFirstToken.set(first, [trimmed])
  }
  // Longest first, so the greedy match picks the most specific name.
  for (const arr of byFirstToken.values()) arr.sort((a, b) => b.length - a.length)
  return { byFirstToken }
}

/** Try to match a known tag name in `text` starting at `pos` (the char after "#"). */
function matchKnownTagAt(text: string, pos: number, index: KnownTagIndex): string | null {
  const firstTokenMatch = FALLBACK_TOKEN_RE.exec(text.slice(pos))
  if (!firstTokenMatch) return null
  const candidates = index.byFirstToken.get(firstTokenMatch[0].toLowerCase())
  if (!candidates) return null
  for (const name of candidates) {
    if (text.slice(pos, pos + name.length).toLowerCase() === name.toLowerCase()
      && !isWordChar(text[pos + name.length])) {
      return name
    }
  }
  return null
}

export function scanTagRefs(text: string, knownTagNames: string[] | KnownTagIndex): TagRefHit[] {
  const index = Array.isArray(knownTagNames) ? buildKnownTagIndex(knownTagNames) : knownTagNames
  const hits: TagRefHit[] = []
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '#') continue
    if (!LEAD_OK(text[i - 1])) continue
    const after = i + 1
    const known = matchKnownTagAt(text, after, index)
    if (known) {
      hits.push({ index: i, length: 1 + known.length, name: known, known: true })
      i += known.length
      continue
    }
    const tok = FALLBACK_TOKEN_RE.exec(text.slice(after))
    if (tok) {
      hits.push({ index: i, length: 1 + tok[0].length, name: tok[0], known: false })
      i += tok[0].length
    }
  }
  return hits
}
