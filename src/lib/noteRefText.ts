// contenteditable / ProseMirror silently substitutes a typed ASCII space with U+00A0
// (no-break space) in various positions, and rich-text pastes can carry U+2007/U+202F/
// U+2009 too. Every reference regex in this file (and its notePreviewRender.ts twin) only
// treats `[ \t]` as a word gap, so a ref like "Isaiah 61:3<U+00A0>LXX" or a paste with an
// nbsp before the verse number silently fails to detect. Normalising to a plain space is
// length-preserving (1 char → 1 char), so every match `index`/`length` computed downstream
// stays in 1:1 correspondence with real document positions.
export function normalizeRefWhitespace(s: string): string {
  return s.replace(/[    ]/g, ' ')
}

/**
 * Strip an LXX marker (trailing " LXX" suffix or leading "lxx:"/"LXX:" prefix) from a
 * reference string. Returns the bare reference for parseRef plus whether LXX was present.
 */
export function stripLxxMarker(refText: string): { ref: string; lxx: boolean } {
  // Tolerate an accidentally-doubled marker ("Gen 1:1 LXX LXX") — strip every trailing run.
  const suffix = refText.match(/^(.*?)(?:[ \t]+LXX)+\s*$/i)
  if (suffix) return { ref: suffix[1].trim(), lxx: true }
  const prefix = refText.match(/^(?:lxx|LXX):\s*(.*)$/)
  if (prefix) return { ref: prefix[1].trim(), lxx: true }
  return { ref: refText, lxx: false }
}
