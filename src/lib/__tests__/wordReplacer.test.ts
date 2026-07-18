import { describe, it, expect } from 'vitest'
import { applyWordReplacer, expandQueryForWordReplacer, getWordReplacerSearchVariants } from '../wordReplacer'
import type { WordReplacerRule } from '@/store'

// Mirrors the real default rule set's relevant subset (see store/index.ts's
// DEFAULT_WORD_REPLACER_RULES) — the phrase rule for "Christ Jesus"/"Jesus
// Christ" must apply BEFORE the standalone "jesus"/"christ" rules, or KJV's
// "Christ Jesus"/"Jesus Christ" wording would come out as "Messiah Yeshua"
// (wrong order — each word replaced individually) instead of "Yeshua Messiah".
const rules: WordReplacerRule[] = [
  { id: 'phrase', queries: ['christ jesus', 'jesus christ'], replacement: 'Yeshua Messiah', wholeWord: false, enabled: true },
  { id: 'christ', queries: ['christ'], replacement: 'Messiah', wholeWord: true, enabled: true },
  { id: 'jesus', queries: ['jesus'], replacement: 'Yeshua', wholeWord: false, enabled: true },
]

describe('applyWordReplacer — phrase rules take priority over single-word rules', () => {
  it('"Christ Jesus" becomes "Yeshua Messiah", not "Messiah Yeshua"', () => {
    expect(applyWordReplacer('the grace of Christ Jesus our Lord', rules)).toBe('the grace of Yeshua Messiah our Lord')
  })

  it('"Jesus Christ" (reverse word order) also becomes "Yeshua Messiah"', () => {
    expect(applyWordReplacer('grace be unto you from Jesus Christ', rules)).toBe('grace be unto you from Yeshua Messiah')
  })

  it('standalone "Jesus" (not part of the phrase) still becomes "Yeshua" alone', () => {
    expect(applyWordReplacer('Jesus wept', rules)).toBe('Yeshua wept')
  })

  it('standalone "Christ" (not part of the phrase) still becomes "Messiah" alone', () => {
    expect(applyWordReplacer('in Christ shall all be made alive', rules)).toBe('in Messiah shall all be made alive')
  })

  it('multiple occurrences in one string are all handled correctly', () => {
    expect(applyWordReplacer('Christ Jesus, and Jesus Christ, and Jesus, and Christ', rules))
      .toBe('Yeshua Messiah, and Yeshua Messiah, and Yeshua, and Messiah')
  })
})

describe('expandQueryForWordReplacer — bidirectional search', () => {
  it('searching the replacement word expands to also search the original', () => {
    const q = expandQueryForWordReplacer('yeshua', rules)
    expect(q).toContain('yeshua')
    expect(q).toContain('jesus')
  })

  it('searching the phrase replacement expands to both original word orders', () => {
    const q = expandQueryForWordReplacer('yeshua messiah', rules)
    expect(q).toContain('christ jesus')
    expect(q).toContain('jesus christ')
  })

  it('searching the original word already present in the query needs no expansion of itself', () => {
    const q = expandQueryForWordReplacer('jesus', rules)
    // "jesus" is already in the query — should not be duplicated as an extra OR term
    const orTerms = q.split(' OR ').map((s) => s.trim())
    expect(orTerms.filter((t) => t === 'jesus').length).toBe(1)
  })
})

// getWordReplacerSearchVariants is the function real search call sites (Advanced
// Search, floating search) actually use — see wordReplacer.ts's comment on
// expandQueryForWordReplacer for why that older function's "term1 OR term2" string
// is NOT safe to pass to window.bible.searchText (electron/ipc/bible.ts's FTS query
// builder treats every word, including a literal "OR", as a required token, so it
// silently became an impossible query). Each variant here must be independently
// searchable and merged by the caller.
describe('getWordReplacerSearchVariants — real bidirectional search variants', () => {
  it('typing the replacement word alone also returns the original word as a variant', () => {
    const variants = getWordReplacerSearchVariants('yeshua', rules)
    expect(variants).toContain('yeshua')
    expect(variants).toContain('jesus')
  })

  it('typing the original word alone also returns the replacement word as a variant', () => {
    // The substitution takes the rule's `replacement` casing as-written ("Yeshua")
    // rather than lowercasing it — harmless for FTS matching (case-insensitive),
    // so this only needs a case-insensitive check.
    const variants = getWordReplacerSearchVariants('jesus', rules)
    expect(variants).toContain('jesus')
    expect(variants.some((v) => v.toLowerCase() === 'yeshua')).toBe(true)
  })

  it('none of the variants contain a literal "OR" token (the actual reported bug)', () => {
    const variants = getWordReplacerSearchVariants('yeshua', rules)
    for (const v of variants) {
      expect(v.split(/\s+/).map((w) => w.toUpperCase())).not.toContain('OR')
    }
  })

  it('substitutes the matched word IN PLACE within a multi-word query, preserving the rest', () => {
    const variants = getWordReplacerSearchVariants('yeshua wept', rules)
    expect(variants).toContain('yeshua wept')
    expect(variants).toContain('jesus wept')
    // Must NOT just be the bare replaced word alone, losing "wept"
    expect(variants).not.toContain('jesus')
  })

  it('the phrase rule substitutes both directions as whole-phrase variants', () => {
    const toOriginal = getWordReplacerSearchVariants('yeshua messiah', rules)
    expect(toOriginal).toContain('christ jesus')
    const toReplacement = getWordReplacerSearchVariants('jesus christ', rules)
    expect(toReplacement.some((v) => v.toLowerCase() === 'yeshua messiah')).toBe(true)
  })

  it('a query with no matching rule returns just itself', () => {
    expect(getWordReplacerSearchVariants('grace and truth', rules)).toEqual(['grace and truth'])
  })
})
