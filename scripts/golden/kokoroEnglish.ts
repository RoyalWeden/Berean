import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

type Part = { match: boolean; text: string }
type Preparation = { normalized: string; parts: Part[] }

/** Test oracle from the exact installed Kokoro implementation, without a model download.
 * Its phonemizer is injected, letting us observe preprocessing and IPA postprocessing
 * independently. Fail explicitly if an upstream update changes these extraction boundaries.
 */
export function kokoroEnglishOracle() {
  const root = resolve(__dirname, '../..')
  const path = 'node_modules/kokoro-js/dist/kokoro.js'
  const source = readFileSync(resolve(root, path), 'utf8')
  const start = source.indexOf('function o(')
  const end = source.indexOf('function p(', start)
  if (start < 0 || end < 0) throw new Error('Kokoro English oracle boundaries changed')
  const prefix = source.slice(start, end)
  const intercept = 'let i=s.replace'
  if (!prefix.includes('async function m(') || !prefix.includes(intercept)) {
    throw new Error('Kokoro English oracle entry point changed')
  }
  const prepare = new Function('l', prefix.replace(intercept,
    'return {normalized:e,parts:r};let i=s.replace') + ';return m;')(
    async (text: string) => [text],
  ) as (text: string, language?: string, normalize?: boolean) => Promise<Preparation>
  const postprocess = (ipa: string, american: boolean) => {
    const convert = new Function('l', prefix + ';return m;')(async () => [ipa]) as
      (text: string, language: string, normalize: boolean) => Promise<string>
    return convert('word', american ? 'a' : 'b', false)
  }
  return { prepare, postprocess, sha256: createHash('sha256').update(source).digest('hex') }
}

export async function buildKokoroEnglishGolden(): Promise<{ name: string; data: unknown }> {
  const oracle = kokoroEnglishOracle()
  const samples = [
    '', 'word', ' In the beginning. ', 'first, second; third: fourth! why? yes.',
    '(one) [two] {three} «four» “five” ‘six’', 'before—after… again',
    '日本、文字。全角！句読，記号：まだ；どう？',
    'a\tb\rc\nd\v e\f f\u00a0g\u2028h\ufeffi',
    'one   two   three', 'one\n   \ntwo',
    'Dr. Smith DR. Smith Dr. smith DR. smith',
    'Mr. Jones MR. Jones Mr. jones MR. jones',
    'Ms. Smith MS. Smith Mrs. Jones MRS. Jones',
    'etc. then etc. Then ETC. next', 'yeah Yeah yea YEAH',
    ...['1000', '1099', '1100', '1900', '1905', '1999', '2001', '2010', '2026', '1900s', '1990s'].map(x => `in ${x}.`),
    ...['1:00', '12:00', '1:05', '12:59', '0:30', '13:05', '1:23:45', '12:34:56'].map(x => `at ${x}`),
    '$1 $2 $01 £1 £2', '$1.01 $1.10 $2.5 $2.345 £1.01 £2.02',
    '$3 million £4 hundred $5.50 thousand', '$3 MILLION £4 HUNDRED $5.50 THOUSAND', '1,234,567 and 3.14 and .75',
    '10-20 3S ABCs BCS X\'S XS', 'U.S.A. is U.S. Army a.b.c. next',
    'αDr. Smith éMr. Jones ١٢:٣٤ ４２',
    '!!! [ ] ( ) ???', ' \n\ufeff ', 'é and 😀; another sentence.',
  ]
  const ipa = ['kəkˈoːɹoʊ kəkˈɔːɹəʊ', 'r x ɬ ʲ', 'ahˈʌndɹɪd ɹhˈʌndɹɪd ːhˈʌndɹɪd',
    'word z, word z. word z!', 'z word z', 'word z\n', 'word z\u2028', 'nˈaɪnti nˈaɪntiː', '  r\n', 'ɪnðə bɪɡˈɪnɪŋ', '😀 é']
  return { name: 'kokoro-english', data: { format: 1, vendorSHA256: oracle.sha256,
    cases: await Promise.all(samples.flatMap(input => [true, false].map(async normalize => ({
      input, normalize, ...await oracle.prepare(input, 'a', normalize),
    })))),
    ipa: await Promise.all(ipa.flatMap(input => [true, false].map(async american => ({
      input, american, output: await oracle.postprocess(input, american),
    })))),
  } }
}
