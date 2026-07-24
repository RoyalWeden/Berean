// Renderer-side counterpart of electron/ipc/numberWords.ts — duplicated rather than
// shared, since electron/ (main process) and src/ (renderer) are built completely
// separately with no cross-imports anywhere else in the codebase. Used here to
// highlight the WORD-form match in a search result snippet when the user searched a
// digit (or vice versa) — the actual query expansion for finding those results lives
// in the main-process copy; this one only needs to know the same equivalences to
// build a highlight regex that also catches the alternate form.

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']
const TEENS = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

const NUMBER_TO_WORD = new Map<number, string>()
ONES.forEach((w, i) => NUMBER_TO_WORD.set(i, w))
TEENS.forEach((w, i) => NUMBER_TO_WORD.set(10 + i, w))
TENS.forEach((w, i) => NUMBER_TO_WORD.set(20 + i * 10, w))
NUMBER_TO_WORD.set(100, 'hundred')
NUMBER_TO_WORD.set(1000, 'thousand')
NUMBER_TO_WORD.set(20, 'score')
NUMBER_TO_WORD.set(60, 'threescore')
NUMBER_TO_WORD.set(80, 'fourscore')

const WORD_TO_NUMBER = new Map<string, number>()
for (const [n, w] of NUMBER_TO_WORD) if (!WORD_TO_NUMBER.has(w)) WORD_TO_NUMBER.set(w, n)

/** For a single query token, return every equivalent form worth highlighting
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
