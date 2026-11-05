import { describe, it, expect } from 'vitest'
import { parseStrongsIds, normalizeStrongsId, parseBareStrongsNumbers } from '../strongsId'

const ids = (s: string) => parseStrongsIds(s).map((m) => m.id)

describe('parseStrongsIds', () => {
  it('accepts every common spelling (spec §12 scenario 2)', () => {
    expect(ids('G5485')).toEqual(['G5485'])
    expect(ids('g5485')).toEqual(['G5485'])
    expect(ids('G-5485')).toEqual(['G5485'])
    expect(ids('G 5485')).toEqual(['G5485'])
    expect(ids('G–5485')).toEqual(['G5485'])
    expect(ids('H02617')).toEqual(['H2617'])
  })

  it('finds ids mid-sentence (benchmark C07, C55)', () => {
    expect(ids("Strong's G-25")).toEqual(['G25'])
    expect(ids('what is g5485 used for in Titus')).toEqual(['G5485'])
    expect(ids('what does g5485 mean in Titus?')).toEqual(['G5485'])
    expect(ids('compare H2617 and H7356')).toEqual(['H2617', 'H7356'])
  })

  it('does not match inside other tokens', () => {
    expect(ids('5G network')).toEqual([])
    expect(ids('AG5485')).toEqual([])
    expect(ids('G548501')).toEqual([])
    expect(ids('Genesis 1:1')).toEqual([])
    expect(ids('H0')).toEqual([])
  })

  it('dedupes and keeps first-appearance order', () => {
    expect(ids('G26, then g26 and H157')).toEqual(['G26', 'H157'])
  })
})

describe('normalizeStrongsId', () => {
  it('normalizes a whole-string id and rejects anything else', () => {
    expect(normalizeStrongsId('g-05485')).toBe('G5485')
    expect(normalizeStrongsId('H853')).toBe('H853')
    expect(normalizeStrongsId('')).toBeNull()
    expect(normalizeStrongsId('grace G5485')).toBeNull()
  })
})

describe('parseBareStrongsNumbers', () => {
  it('uses the named language, else returns both readings', () => {
    expect(parseBareStrongsNumbers("Greek Strong's 5485").map((m) => m.id)).toEqual(['G5485'])
    expect(parseBareStrongsNumbers("strong's number 2617 in hebrew").map((m) => m.id)).toEqual(['H2617'])
    expect(parseBareStrongsNumbers("strongs 26").map((m) => m.id)).toEqual(['H26', 'G26'])
  })
})
