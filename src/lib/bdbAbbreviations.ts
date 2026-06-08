/**
 * Expansions for the grammatical / morphological abbreviations used throughout
 * the Brown-Driver-Briggs (BDB) Hebrew lexicon notes (e.g. "vb." → "verb").
 *
 * Only unambiguous grammatical markers are included — single-letter abbreviations
 * (m., f., c., v.) and bibliographic ones are left alone to avoid wrong expansions.
 */
export const BDB_ABBR: Record<string, string> = {
  // ── Parts of speech ──
  'vb.': 'verb',
  'n.': 'noun',
  'n.m.': 'noun, masculine',
  'n.f.': 'noun, feminine',
  'n.m.pl.': 'noun, masculine plural',
  'n.f.pl.': 'noun, feminine plural',
  'n.pr.': 'proper noun',
  'n.pr.m.': 'proper noun, masculine',
  'n.pr.f.': 'proper noun, feminine',
  'n.pr.loc.': 'place name',
  'n.pr.gent.': 'people-group name',
  'adj.': 'adjective',
  'adj.gent.': 'adjective, gentilic',
  'adv.': 'adverb',
  'subst.': 'substantive',
  'art.': 'article',
  'conj.': 'conjunction',
  'prep.': 'preposition',
  'interj.': 'interjection',
  'pron.': 'pronoun',
  'prt.': 'particle',
  'ptcp.': 'participle',
  'denom.': 'denominative',
  // ── Hebrew verb stems (binyanim) ──
  'Niph.': 'Niphal',
  'Pi.': 'Piel',
  'Pu.': 'Pual',
  'Hiph.': 'Hiphil',
  'Hoph.': 'Hophal',
  'Hithp.': 'Hithpael',
  'Hithpo.': 'Hithpolel',
  'Po.': 'Polel',
  'Pilp.': 'Pilpel',
  // ── Aramaic verb stems ──
  'Pe.': 'Peal',
  'Aph.': 'Aphel',
  'Haph.': 'Haphel',
  'Ithp.': 'Ithpeal',
  'Shaph.': 'Shaphel',
  // ── Number / state / gender ──
  'pl.': 'plural',
  'sg.': 'singular',
  'du.': 'dual',
  'cstr.': 'construct',
  'abs.': 'absolute',
  'coll.': 'collective',
  'sf.': 'with suffix',
  // ── Uncertain-gender variants (BDB square-bracket notation = "probably") ──
  '[m.]': 'probably masculine',
  'n.[m.]': 'noun, probably masculine',
  'n.[f.]': 'noun, probably feminine',
  'n.[m.]pl.': 'noun, probably masculine, plural',
  'n.[f.]pl.': 'noun, probably feminine, plural',
  'n.[m.]du.': 'noun, probably masculine, dual',
  'n.[m.]coll.': 'noun, probably masculine, collective',
  'n.[m.]pl.abstr.': 'noun, probably masculine, plural, abstract',
  'n.pr.[m.]': 'proper noun, probably masculine',
}

/**
 * Return the expansion for a BDB token if it is a known grammatical abbreviation,
 * else null. The token may carry trailing punctuation (e.g. a comma) which is
 * preserved by the caller — pass the bare token here.
 */
export function expandBdbAbbr(token: string): string | null {
  return BDB_ABBR[token] ?? null
}

export interface BdbToken {
  /** 'abbr' = grammatical marker (render distinctly), 'num' = bare reference/count
   *  (NOT a Strong's number — occurrence counts & citations), 'text' = ordinary prose. */
  kind: 'abbr' | 'num' | 'text'
  /** The text to display. For 'abbr' this is the expanded form. */
  text: string
  /** The original token (for tooltips). */
  raw: string
}

/**
 * Tokenize a BDB notes string for rich rendering: grammatical abbreviations are
 * expanded and tagged, bare numbers are tagged (so they read as references, not
 * part of the definition), everything else is plain prose. Whitespace is preserved
 * as 'text' tokens so the caller can join them back faithfully.
 */
export function tokenizeBdbNotes(text: string): BdbToken[] {
  const out: BdbToken[] = []
  // Split on whitespace, keeping the separators.
  for (const part of text.split(/(\s+)/)) {
    if (part === '') continue
    if (/^\s+$/.test(part)) { out.push({ kind: 'text', text: part, raw: part }); continue }

    // Strip a single trailing prose-punctuation char (comma/semicolon) so "n.f.," still matches.
    const trail = /[,;]$/.test(part) ? part.slice(-1) : ''
    const core = trail ? part.slice(0, -1) : part

    const exp = expandBdbAbbr(core)
    if (exp) {
      out.push({ kind: 'abbr', text: exp, raw: core })
      if (trail) out.push({ kind: 'text', text: trail, raw: trail })
      continue
    }
    // Bare number (occurrence count / scholarly citation — not a Strong's number)
    if (/^\d{1,5}$/.test(core)) {
      out.push({ kind: 'num', text: core, raw: core })
      if (trail) out.push({ kind: 'text', text: trail, raw: trail })
      continue
    }
    out.push({ kind: 'text', text: part, raw: part })
  }
  return out
}
