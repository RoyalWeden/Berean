/**
 * Word-replacer / verse-display golden (M2-02): applyWordReplacer, applyStrongsWordReplacer,
 * getWordReplacerSearchVariants, getWordReplacerStrongsSearch, buildVerseDisplayText/Tokens,
 * buildVerseStudyTokens, findMatchWordIndices, extractGlossWords, getWordWindow — over every KJVA
 * verse (default rules on and off) plus samples of the other texts. Also exports the default rules
 * (read from src/store/index.ts) so the native defaults are generated, never retyped.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { openNodeSqlite } from '../../electron/db/adapters/nodeSqliteAdapter'
import { applyStrongsWordReplacer, applyWordReplacer, getWordReplacerSearchVariants, getWordReplacerStrongsSearch } from '../../src/lib/wordReplacer'
import { buildVerseDisplayText, buildVerseDisplayTokens, buildVerseStudyTokens, extractGlossWords, findMatchWordIndices, getWordWindow } from '../../src/lib/verseUtils'
import type { WordReplacerRule } from '../../src/store'

const ROOT = resolve(__dirname, '../..')
function shortHash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(16).padStart(8, '0') + s.length.toString(36)
}
const digest = (rows: unknown[]) => ({ count: rows.length, hash: shortHash(JSON.stringify(rows)) })

/** DEFAULT_WORD_REPLACER_RULES, evaluated from its literal in the store source (it is not exported). */
export function defaultWordReplacerRules(): WordReplacerRule[] {
  const src = readFileSync(resolve(ROOT, 'src/store/index.ts'), 'utf8')
  const start = src.indexOf('const DEFAULT_WORD_REPLACER_RULES: WordReplacerRule[] = [')
  const end = src.indexOf('\n]\n', start)
  if (start < 0 || end < 0) throw new Error('DEFAULT_WORD_REPLACER_RULES literal not found')
  const body = src.slice(src.indexOf('[', start), end + 2)
  return new Function(`return ${body}`)() as WordReplacerRule[]
}

export async function buildDisplayGolden(): Promise<{ name: string; data: unknown } | null> {
  if (!['kjva', 'lxx', 'enoch', 'kjv'].every((t) => existsSync(resolve(ROOT, 'data', `${t}.db`)))) return null
  const rules = defaultWordReplacerRules()
  const custom: WordReplacerRule[] = [
    ...rules,
    { id: 'c1', queries: ['God'], replacement: 'Elohim', wholeWord: true, enabled: true },
    { id: 'c2', queries: ['heaven'], replacement: 'shamayim', wholeWord: false, enabled: true },
    { id: 'c3', queries: ['LORD'], replacement: 'Yehovah', wholeWord: true, enabled: false },
    { id: 'c4', queries: ['ÆGYPT', 'egypt'], replacement: 'Mitzrayim', wholeWord: true, enabled: true },
  ]
  const texts: Record<string, unknown> = {}
  for (const t of ['kjva', 'lxx', 'enoch', 'kjv']) {
    const db = openNodeSqlite(resolve(ROOT, 'data', `${t}.db`), t, true)
    const tagged = (await db.all<{ name: string }>("SELECT name FROM pragma_table_info('verses')")).some((c) => c.name === 'text_tagged')
    const where = t === 'kjva' ? '' : ' WHERE id % 7 = 0'
    const vs = await db.all<{ book_id: string; text: string; text_tagged?: string | null }>(`SELECT book_id, text${tagged ? ', text_tagged' : ''} FROM verses${where} ORDER BY id`)
    await db.close()
    const groups = new Map<string, unknown[][]>()
    for (const v of vs) {
      const row = [
        buildVerseDisplayText(v.text, v.text_tagged, t, true, rules),
        buildVerseDisplayText(v.text, v.text_tagged, t, false, rules),
        buildVerseDisplayText(v.text, v.text_tagged, t, true, custom),
        buildVerseDisplayTokens(v.text, v.text_tagged, t, true, rules),
        buildVerseDisplayTokens(v.text, v.text_tagged, t, false, rules),
        buildVerseStudyTokens(v.text, v.text_tagged, t, true, rules),
        findMatchWordIndices(v.text_tagged ?? null, v.text, 'H3068', ['lord', 'jehovah']),
        findMatchWordIndices(v.text_tagged ?? null, v.text, 'g5485', []),
      ]
      if (!groups.has(v.book_id)) groups.set(v.book_id, [])
      groups.get(v.book_id)!.push(row)
    }
    texts[t] = Object.fromEntries([...groups].map(([b, rows]) => [b, digest(rows)]))
  }
  const plain = ['Jesus Christ said', 'christ jesus', 'CHRIST', 'Christian', 'antichrist', 'the Jesuses', 'Elias and Esaias', 'Noe, Sem', 'noel', 'Naum.',
    'Pharao’s', 'Aggæus AGGÆUS', 'Michæas', 'jesus-christ', '', 'JeSuS', 'élias', 'Egypt egyptian ÆGYPT', 'God godly God-fearing', 'heavenly heaven']
  const replacer = plain.map((s) => ({ text: s, defaults: applyWordReplacer(s, rules), custom: applyWordReplacer(s, custom) }))
  const strongsWords = [['LORD', 'H3068'], ["LORD'S", 'H3068'], ["LORD'S.", 'H3068'], ['LORD,', ['H3068', 'H430']], ['GOD', 'H3069'], ['JAH', 'H3050'], ['Lord', 'H136'], ['LORD;”', 'H3068'], ['L0RD', 'H3068'], ['', 'H3068'], ['LORD', null]] as const
  const strongs = strongsWords.map(([w, n]) => ({ word: w, num: n, result: applyStrongsWordReplacer(w, n as string | string[] | null, rules) }))
  const queries = ['Yeshua', 'yeshua wept', 'Jesus wept', 'Yeshua Messiah', 'Messiah', 'christ', 'Elijah Isaiah', 'Yeshuah', 'shem', 'pharaoh', '', '  ', 'Jonah and Jonas', 'yehovah', 'Yah']
  const variants = queries.map((q) => ({ query: q, defaults: getWordReplacerSearchVariants(q, rules), custom: getWordReplacerSearchVariants(q, custom) }))
  const strongsSearch = ['yehovah', 'Yehovah said', 'the yah shall', "Yehovah's word", 'lord', '', 'yah yehovah', 'Yehovah!'].map((q) => ({ query: q, result: getWordReplacerStrongsSearch(q, rules) ?? null }))
  const glosses = ['beginning, chief (thing), first (-fruits, part, time), principal thing.', '× graciously, + favour', 'love; feast of charity', '', 'god(s)', 'Jehovah'].map((s) => ({ def: s, words: extractGlossWords(s) }))
  const long = 'And it came to pass in those days that there went out a decree from Caesar Augustus that all the world should be taxed and this taxing was first made when Cyrenius was governor of Syria'
  const windows = [[long, [12]], [long, [2]], [long, [30]], [long, [40]], [long, [15, 16, 25]], ['short text', [3]], [long, []]].map(([t, ix]) => ({ text: t, indices: ix, result: getWordWindow(t as string, ix as number[]) }))
  return {
    name: 'display',
    data: {
      format: 1, generator: 'scripts/golden/display.ts',
      sources: Object.fromEntries(['src/lib/wordReplacer.ts', 'src/lib/verseUtils.ts', 'src/lib/taggedTokens.ts', 'src/store/index.ts', 'scripts/golden/display.ts']
        .map((p) => [p, createHash('sha256').update(readFileSync(resolve(ROOT, p))).digest('hex')])),
      defaultRules: rules, customRules: custom, texts, replacer, strongs, variants, strongsSearch, glosses, windows,
    },
  }
}
