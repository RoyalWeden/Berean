// Bidirectional digit <-> word-form mapping for single-token cardinal numbers
// (e.g. "7" <-> "seven"), used by bible.ts's verse-text search and notes.ts's
// note search so a query in either form finds text written in the other —
// the KJV (and most notes referencing it) spells numbers out as words far
// more often than it uses digits.
//
// Deliberately single-word tokens only (no "twenty one" -> 21 compound
// parsing) — that covers the actual query shape ("search for 7" / "search
// for seven"), and multi-word compounds are a different, much larger
// problem (KJV itself usually writes compounds as "twenty and one" anyway,
// which a naive "twenty one" -> 21 parse wouldn't even match).

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']
const TEENS = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

const NUMBER_TO_WORD = new Map<number, string>()
ONES.forEach((w, i) => NUMBER_TO_WORD.set(i, w))
TEENS.forEach((w, i) => NUMBER_TO_WORD.set(10 + i, w))
TENS.forEach((w, i) => NUMBER_TO_WORD.set(20 + i * 10, w))
NUMBER_TO_WORD.set(100, 'hundred')
NUMBER_TO_WORD.set(1000, 'thousand')
// KJV archaic terms — "threescore and ten" (70), "fourscore" (80) are common
// enough (Psalm 90:10, etc.) to be worth the query-side match even though
// they don't fit the round-number pattern above.
NUMBER_TO_WORD.set(20, 'score')
NUMBER_TO_WORD.set(60, 'threescore')
NUMBER_TO_WORD.set(80, 'fourscore')

const WORD_TO_NUMBER = new Map<string, number>()
for (const [n, w] of NUMBER_TO_WORD) if (!WORD_TO_NUMBER.has(w)) WORD_TO_NUMBER.set(w, n)

/** For a single query token, return every equivalent form worth searching
 *  (always includes the original token itself, unmodified, first). */
export function numberTokenAlternates(token: string): string[] {
  if (/^\d+$/.test(token)) {
    const word = NUMBER_TO_WORD.get(Number(token))
    return word ? [token, word] : [token]
  }
  const lower = token.toLowerCase()
  const num = WORD_TO_NUMBER.get(lower)
  return num != null ? [token, String(num)] : [token]
}
