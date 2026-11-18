/** Speech-only pronunciation/number preparation and aligned verse tokens. */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { applyPronunciation, expandAbbreviation, expandNumbers, normalizePunctuation, numberToWords, prepareWordForSpeech } from '../../src/lib/tts/textPrep'
import { buildSpokenWords } from '../../src/lib/tts/extractSpokenText'
import type { Verse } from '../../src/types'
import type { WordReplacerRule } from '../../src/store'

export function buildSpeechPreparationGolden(): { name: string; data: unknown } {
  const numbers = [...Array.from({ length: 131 }, (_, i) => i - 5), 999, 1000, 1001, 1020, 2005, 70000, 1000000, 1000001, 1000000000, 999999999999]
  const tokens = [
    ...numbers.filter(n => n >= 0).flatMap(n => [String(n), `${n}th`, `(${n}),`]),
    '1st', '2nd', '3rd', '42ND', '1,000', '2,005', '1,00', '0.05', '3.14', '00000000000000000000001',
    '9999999999999', '9999999999999.1', 'H7225', '٤٠', '４０', '-40', '+40',
    ...['mr.', 'mrs.', 'ms.', 'dr.', 'st.', 'vs.', 'etc.', 'e.g.', 'i.e.', 'cf.', 'no.', 'ch.', 'chs.', 'v.', 'vv.', 'ff.', 'approx.']
      .flatMap(s => [s, s.toUpperCase(), `(${s}`, `${s},`]),
    'Yehovah', 'YEHOVAH', 'yehovah', 'Yehovahs', "Yehovah's", 'Yehovah’s', '(Yehovah),',
    'Yeshua', "Yeshua's", '(Yeshua!)', 'Yeshua’S', 'words—then', 'words–and', 'wait...', 'wait…',
    'what!!??', 'wait......', '‘hello’', '“hello”', '😀', 'é', '', '\n', 'Dr.\n', '40\n',
  ]
  const rules: WordReplacerRule[] = [
    { id: 'name', queries: ['Jesus'], replacement: 'Yeshua', wholeWord: true, enabled: true },
    { id: 'title', queries: ['Lord'], replacement: 'master', wholeWord: true, enabled: true },
    { id: 'divine', queries: [], replacement: 'Yehovah', strongsNum: 'H3068', wholeWord: false, enabled: true },
    { id: 'multi', queries: ['700'], replacement: 'seven hundred', wholeWord: true, enabled: true },
    { id: 'disabled', queries: ['earth'], replacement: 'ignored', wholeWord: true, enabled: false },
  ]
  const verses: Array<[string, string | null]> = [
    ['', null], ['  Jesus  said 40 words—then. ', null], ['(Dr. said) 700 é 😀.', null],
    ['The LORD said 40 words.', 'The{} LORD{H3068} said{} 40{} words.{}'],
    ["the LORD'S earth", "the{} ~{H853} LORD'S{H3068} earth{H776}"],
    ['the Lord said', 'the;{} Lord{H1|H3068} !*said{}'],
    ['the earth was void', 'the{} earth{H776} was{} void{}'],
    ['plain fallback', ''], ['no readable tokens', '~{H853} sup>({} /sup>){}'],
    ['Jesus (said) 700', 'Jesus{G2424} sup>({} (said){} /sup>){} 700{}'],
    ['α😀 é', 'α😀{} é{}'], ['one\ntwo  three', null],
  ]
  const sourcePaths = ['src/lib/tts/textPrep.ts', 'src/lib/tts/extractSpokenText.ts', 'src/lib/taggedTokens.ts', 'src/lib/wordReplacer.ts', 'scripts/golden/speechPreparation.ts']
  const root = resolve(__dirname, '../..')
  return { name: 'speech-preparation', data: { format: 1,
    sources: Object.fromEntries(sourcePaths.map(path => [path, createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex')])),
    numbers: numbers.flatMap(input => [false, true].map(ordinal => ({ input, ordinal, output: numberToWords(input, ordinal) }))),
    tokens: tokens.map(input => ({ input, pronunciation: applyPronunciation(input), abbreviation: expandAbbreviation(input),
      number: expandNumbers(input), punctuation: normalizePunctuation(input), prepared: prepareWordForSpeech(input) })),
    verses: verses.flatMap(([text, tagged]) => [[], rules, rules.map(rule => ({ ...rule, enabled: false }))].map(selected => ({
      text, tagged, rules: selected, output: buildSpokenWords({ text, text_tagged: tagged } as Verse, selected),
    }))),
  } }
}
