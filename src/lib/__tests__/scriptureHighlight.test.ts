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

  it('phrase mode returns the literal escaped phrase, unaffected by the word-mode fix', () => {
    const pattern = buildHighlightPattern('the lord', 'phrase')
    expect(pattern).toBe('the lord')
    const re = new RegExp(pattern, 'gi')
    expect(re.test('the lord is my shepherd')).toBe(true)
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
