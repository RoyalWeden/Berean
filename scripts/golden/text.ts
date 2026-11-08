/**
 * Verse-text golden (M2-02): tagged tokens, KJV italic / red-letter ranges, annotation stripping and
 * display ⇄ original offset mapping (where stored highlights land), over EVERY verse of the bundled
 * texts that carry the markup. Per-book digests (count + FNV short hash of the JSON) keep it small.
 * Skipped (null) when data/*.db is absent.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { openNodeSqlite } from '../../electron/db/adapters/nodeSqliteAdapter'
import { parseTaggedTokens, tokenHasNoPlainText } from '../../src/lib/taggedTokens'
import { getAnnotationRanges, mapDisplayOffsetToOriginal, mapOriginalOffsetToDisplay } from '../../src/lib/verseUtils'
import { stripAnnotations } from '../../src/lib/annotationFilters'

const ROOT = resolve(__dirname, '../..')
function shortHash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(16).padStart(8, '0') + s.length.toString(36)
}
const digest = (rows: unknown[]) => ({ count: rows.length, hash: shortHash(JSON.stringify(rows)) })

type V = { book_id: string; chapter: number; verse_num: number; text: string; text_tagged?: string | null }
async function verses(textId: string): Promise<V[]> {
  const db = openNodeSqlite(resolve(ROOT, 'data', `${textId}.db`), `text:${textId}`, true)
  const tagged = (await db.all<{ name: string }>("SELECT name FROM pragma_table_info('verses')")).some((c) => c.name === 'text_tagged')
  const rows = await db.all<V>(`SELECT book_id, chapter, verse_num, text${tagged ? ', text_tagged' : ''} FROM verses ORDER BY id`)
  await db.close()
  return rows
}
function byBook<T>(vs: V[], f: (v: V) => T): Record<string, { count: number; hash: string }> {
  const groups = new Map<string, T[]>()
  for (const v of vs) { if (!groups.has(v.book_id)) groups.set(v.book_id, []); groups.get(v.book_id)!.push(f(v)) }
  return Object.fromEntries([...groups].map(([b, rows]) => [b, digest(rows)]))
}
/** Offsets probed for a verse pair: every boundary for short texts, a stride for long ones, plus out-of-range. */
function probes(len: number): number[] {
  const step = len > 120 ? 7 : 1
  const out = [-3]
  for (let i = 0; i <= len; i += step) out.push(i)
  out.push(len, len + 5)
  return out
}

export const STRIP_SETS: Record<string, string[][]> = {
  lxx: [['lxx_supply']],
  enoch: [['enoch_supply'], ['enoch_uncertain'], ['enoch_restored'], ['enoch_supply', 'enoch_uncertain', 'enoch_restored']],
  jubilees: [['jubilees_date'], ['jubilees_bracket'], ['jubilees_restored'], ['jubilees_stanza'], ['jubilees_supply'],
    ['jubilees_date', 'jubilees_bracket', 'jubilees_restored', 'jubilees_stanza', 'jubilees_supply']],
}

export async function buildTextGolden(): Promise<{ name: string; data: unknown } | null> {
  const texts = ['kjva', 'lxx', 'enoch', 'jubilees']
  if (!texts.every((t) => existsSync(resolve(ROOT, 'data', `${t}.db`)))) return null
  const out: Record<string, unknown> = {}
  for (const t of ['kjva', 'lxx']) {
    const vs = await verses(t)
    out[t] = {
      tokens: byBook(vs, (v) => parseTaggedTokens(v.text_tagged ?? '')),
      ranges: byBook(vs, (v) => getAnnotationRanges(v.text_tagged, t, v.text)),
      rangesPositional: byBook(vs, (v) => getAnnotationRanges(v.text_tagged, t)),
      // Display text rebuilt from tokens (what the reader renders) mapped against verse.text.
      offsets: byBook(vs, (v) => {
        const display = parseTaggedTokens(v.text_tagged ?? '').filter((k) => !tokenHasNoPlainText(k)).map((k) => k.word).join(' ')
        if (!display) return null
        return [probes(display.length).map((o) => mapDisplayOffsetToOriginal(display, v.text, o)),
          probes(v.text.length).map((o) => mapOriginalOffsetToDisplay(display, v.text, o))]
      }),
    }
  }
  for (const [t, sets] of Object.entries(STRIP_SETS)) {
    const vs = await verses(t)
    const entry: Record<string, unknown> = {}
    for (const set of sets) {
      entry[set.join('+')] = byBook(vs, (v) => {
        const display = stripAnnotations(v.text, t, set)
        return display === v.text ? 0 : [display, probes(display.length).map((o) => mapDisplayOffsetToOriginal(display, v.text, o)),
          probes(v.text.length).map((o) => mapOriginalOffsetToDisplay(display, v.text, o))]
      })
    }
    out[`strip:${t}`] = entry
  }
  // Hand-written edge cases (malformed markup, multi-Strong's, brackets, quotes and whitespace drift).
  const tokenCases = ['', ' ', 'In{} the{} beginning{H7225}', '~{H853} *the{} !word{G1063}', 'divided{H914|H996} x{|}', 'sup>({} /sup>{G1} sup>){} /sup>{}',
    'blu>To{} /blu>Rome.{}', '<b>Psalm{} b>1{}</b>', 'no-brace', 'brace{open', '{H1}', '!*both{G2}', '*!order{G3}', 'a{ H1 }', 'sup>[x]{}', 'SUP>({}', 'x{}  y{}']
    .map((s) => ({ tagged: s, tokens: parseTaggedTokens(s), ranges: getAnnotationRanges(s, 'kjva', s.replace(/\{[^}]*\}/g, '')) }))
  const offsetCases: Array<[string, string]> = [['In the beginning', 'In the beginning'], ['the void', 'the void,'], ['Lamb’s book', "Lamb's  book "],
    ['Yehovah said', 'the LORD said'], ['and God said', 'and [then] God said'], ['', 'abc'], ['abc', ''], ['a b c d', 'a x c d e'], ['“Hi” there', '"Hi" there']]
  const offsets = offsetCases.map(([d, o]) => ({ display: d, original: o,
    toOriginal: probes(d.length).map((x) => mapDisplayOffsetToOriginal(d, o, x)), toDisplay: probes(o.length).map((x) => mapOriginalOffsetToDisplay(d, o, x)) }))
  const stripCases = ['and [the] Lord (said) 〈it〉', 'In [1307 A.M.] the year [of] <restored> (b) (supplied) word', 'x , , y ;  z', '[1307-1320 Anno Mundi] text']
    .flatMap((s) => Object.entries(STRIP_SETS).flatMap(([t, sets]) => sets.map((set) => ({ text: s, textId: t, hidden: set, result: stripAnnotations(s, t, set) }))))
  return {
    name: 'text',
    data: {
      format: 1, generator: 'scripts/golden/text.ts',
      sources: Object.fromEntries(['src/lib/taggedTokens.ts', 'src/lib/verseUtils.ts', 'src/lib/annotationFilters.ts', 'scripts/golden/text.ts']
        .map((p) => [p, createHash('sha256').update(readFileSync(resolve(ROOT, p))).digest('hex')])),
      texts: out, tokenCases, offsets, stripCases,
    },
  }
}
