// Deterministic Strong's-number parsing for research requests (spec §4.2). Shared by desktop and
// iPhone — no Node/Electron imports. A Strong's id is never inferred from a model guess here: this
// only reads ids the user actually typed.

export type StrongsLang = 'H' | 'G'

export interface StrongsIdMatch {
  /** Canonical form used by the lexicon DBs: `G5485`, `H2617` (no leading zeros). */
  id: string
  lang: StrongsLang
  number: number
  /** The exact text that matched, for highlighting/debugging. */
  raw: string
  index: number
}

// `G5485`, `g5485`, `G-5485`, `G 5485`, `H02617`, `G–25` (en dash). The lookbehind/lookahead keep
// it from matching inside other tokens ("5G", "H2O2", "AG5485", "G548501"); an optional trailing
// letter (Strong's "a/b" sub-entries some sources use) is tolerated and dropped.
const STRONGS_RE = /(?<![\p{L}\p{N}])([HhGg])[\s ]?[-‐-–]?[\s ]?0*(\d{1,5})(?:[a-z])?(?![\p{L}\p{N}])/gu

/** Every distinct Strong's id typed anywhere in `text`, in order of first appearance. */
export function parseStrongsIds(text: string): StrongsIdMatch[] {
  const out: StrongsIdMatch[] = []
  const seen = new Set<string>()
  for (const m of text.matchAll(STRONGS_RE)) {
    const lang = m[1].toUpperCase() as StrongsLang
    const number = Number(m[2])
    if (!Number.isFinite(number) || number <= 0) continue
    const id = `${lang}${number}`
    if (seen.has(id)) continue
    seen.add(id)
    out.push({ id, lang, number, raw: m[0], index: m.index ?? 0 })
  }
  return out
}

/** Normalizes a single id-like string (`g-05485` → `G5485`), or null when it isn't one. */
export function normalizeStrongsId(value: string): string | null {
  const hits = parseStrongsIds(value.trim())
  return hits.length === 1 && hits[0].raw.length === value.trim().length ? hits[0].id : null
}

// "Strong's 5485" / "strongs number 26" — a bare number with no H/G prefix. The language is only
// known when the question names it; otherwise both readings are returned so the caller can show
// both verified entries rather than guessing one.
const BARE_NUMBER_RE = /\bstrong'?s(?:'s)?\s+(?:number\s+|no\.?\s+|#\s*)?0*(\d{1,5})\b/giu

export function parseBareStrongsNumbers(text: string): StrongsIdMatch[] {
  const hebrew = /\bhebrew\b|\bold\s+testament\b/i.test(text)
  const greek = /\bgreek\b|\bnew\s+testament\b|\bseptuagint\b|\blxx\b/i.test(text)
  const langs: StrongsLang[] = hebrew && !greek ? ['H'] : greek && !hebrew ? ['G'] : ['H', 'G']
  const out: StrongsIdMatch[] = []
  for (const m of text.matchAll(BARE_NUMBER_RE)) {
    const number = Number(m[1])
    if (!number) continue
    for (const lang of langs) out.push({ id: `${lang}${number}`, lang, number, raw: m[0], index: m.index ?? 0 })
  }
  return out
}
