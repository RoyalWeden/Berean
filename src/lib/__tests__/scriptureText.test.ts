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

import { displayHitText } from '../scriptureText'

describe('displayHitText (search hits)', () => {
  const rules = [{ id: 'y', find: '', replacement: 'Yehovah', enabled: true, strongsNum: 'H3068', queries: [] }] as never
  it('a bridge hit without tagged text gets the restored word at its matched positions', () => {
    const hit = { text: 'when the Lord carried away Judah', textId: 'kjva', strongsWords: [2], wrReplacement: 'Yehovah' }
    expect(displayHitText(hit, { enabled: true, rules })).toBe('when the Yehovah carried away Judah')
  })
  it("keeps punctuation and possessives", () => {
    const hit = { text: "the Lord's house,", textId: 'kjva', strongsWords: [1], wrReplacement: 'Yehovah' }
    expect(displayHitText(hit, { enabled: true, rules })).toBe("the Yehovah's house,")
  })
  it('an ordinary hit is shown exactly as the reader shows it', () => {
    const hit = { text: 'In the beginning', textId: 'kjva' }
    expect(displayHitText(hit, { enabled: true, rules })).toBe('In the beginning')
  })
})
