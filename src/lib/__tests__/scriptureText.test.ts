import { describe, it, expect } from 'vitest'
import { displayVerseText } from '../scriptureText'
import type { WordReplacerRule } from '@/store'

const TEXT_RULE: WordReplacerRule = {
  id: 'jesus', enabled: true, queries: ['jesus'], replacement: 'Yeshua', wholeWord: true,
}
const STRONGS_RULE: WordReplacerRule = {
  id: 'yehovah', enabled: true, queries: [], replacement: 'Yehovah', wholeWord: true, strongsNum: 'H3068',
}

describe('displayVerseText', () => {
  it('applies a plain text-pattern rule when enabled (opts override, no store read)', () => {
    expect(displayVerseText('Jesus wept.', null, 'kjv', { enabled: true, rules: [TEXT_RULE] }))
      .toBe('Yeshua wept.')
  })

  it('leaves text unchanged when disabled', () => {
    expect(displayVerseText('Jesus wept.', null, 'kjv', { enabled: false, rules: [TEXT_RULE] }))
      .toBe('Jesus wept.')
  })

  it('applies a Strong\'s-number rule against KJVA tagged tokens', () => {
    const tagged = 'The{H853} LORD{H3068} is my shepherd{H7462}'
    expect(displayVerseText('The LORD is my shepherd', tagged, 'kjva', { enabled: true, rules: [STRONGS_RULE] }))
      .toBe('Yehovah is my shepherd')
  })

  it('falls back to plain-text rules for non-kjva texts even with tagged data present', () => {
    expect(displayVerseText('Jesus wept.', 'Jesus{G2424} wept', 'lxx', { enabled: true, rules: [TEXT_RULE] }))
      .toBe('Yeshua wept.')
  })
})
