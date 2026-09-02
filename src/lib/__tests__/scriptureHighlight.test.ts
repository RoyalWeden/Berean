import { describe, it, expect } from 'vitest'
import { buildHighlightPattern } from '../scriptureHighlight'

describe('buildHighlightPattern', () => {
  it('highlights only the literal substring, not the whole matched word', () => {
    const pattern = buildHighlightPattern('fire', 'all')
    const re = new RegExp(pattern, 'gi')
    const match = re.exec('firebrands')
    expect(match).not.toBeNull()
    expect(match![0]).toBe('fire')
    expect(match![0].length).toBe(4)
  })

  it('phrase mode joins words with a comma/semicolon-tolerant separator', () => {
    const pattern = buildHighlightPattern('the lord', 'phrase')
    expect(pattern).toBe('the[\\s,;]+lord')
    const re = new RegExp(pattern, 'gi')
    expect(re.test('the lord is my shepherd')).toBe(true)
  })

  it('phrase mode ignores commas/semicolons on both sides', () => {
    const pattern = buildHighlightPattern('faith hope charity', 'phrase')
    const re = new RegExp(pattern, 'i')
    // verse punctuates between the words — still matches
    expect(re.test('now abideth faith, hope, charity')).toBe(true)
    // query typed WITH punctuation — same pattern, still matches an unpunctuated verse
    const re2 = new RegExp(buildHighlightPattern('faith, hope; charity', 'phrase'), 'i')
    expect(re2.test('faith hope charity')).toBe(true)
  })

  it('escapes regex-special characters in a phrase', () => {
    const pattern = buildHighlightPattern('a.b?', 'phrase')
    expect(pattern).toBe('a\\.b\\?')
  })

  it('produces a number-form alternate for number words', () => {
    const pattern = buildHighlightPattern('seven', 'all')
    expect(pattern).toContain('7')
    expect(new RegExp(`(${pattern})`, 'gi').test('after seven days')).toBe(true)
    expect(new RegExp(`(${pattern})`, 'gi').test('after 7 days')).toBe(true)
  })

  it('any-word mode builds the same literal (non-\\w*) pattern as all mode', () => {
    const pattern = buildHighlightPattern('begin', 'any')
    const re = new RegExp(pattern, 'gi')
    const match = re.exec('beginning')
    expect(match![0]).toBe('begin')
  })
})
