import { describe, it, expect } from 'vitest'
import { checkedPremise, isPremiseShaped, premiseNoticeText } from '../premise'

const q = 'why did Moses enter Canaan'
const keys = ['DEU 34:4', 'NUM 20:12', 'DEU 34:1']
const texts = { 'DEU 34:4': 'I have caused thee to see it with thine eyes, but thou shalt not go over thither.', 'NUM 20:12': 'ye shall not bring this congregation into the land', 'DEU 34:1': 'And Moses went up from the plains of Moab unto the mountain of Nebo' }

describe('premise check (spec §6.1 #11, scenario 9)', () => {
  it('recognises questions that presuppose a claim', () => {
    expect(isPremiseShaped(q)).toBe(true)
    expect(isPremiseShaped('which verses prove the apostles abolished the feasts')).toBe(true)
    expect(isPremiseShaped('verses about the jubilee')).toBe(false)
    expect(isPremiseShaped('the Hebrew word for mercy')).toBe(false)
  })

  it('keeps a contradicted premise with only retrieved evidence, in fixed wording', () => {
    const p = checkedPremise({ premise: 'Moses entered Canaan', status: 'contradicted', evidence: ['DEU 34:4', 'JOS 1:2', 'NUM 20:12'] }, q, keys, texts)!
    expect(p).toMatchObject({ status: 'contradicted', evidence: ['DEU 34:4', 'NUM 20:12'] })
    expect(premiseNoticeText(p)).toBe('The premise “Moses entered Canaan” is contradicted by the passages cited below.')
  })

  it('downgrades an uncited claim to not verified, and hides a supported premise', () => {
    expect(checkedPremise({ premise: 'Moses entered Canaan', status: 'contradicted', evidence: ['JOS 1:2'] }, q, keys)).toMatchObject({ status: 'not-verified', evidence: [] })
    expect(checkedPremise({ premise: 'Moses entered Canaan', status: 'supported', evidence: ['DEU 34:1'] }, q, keys)).toBeNull()
  })

  it('reserves "contradicted" for a cited verse that actually denies something', () => {
    expect(checkedPremise({ premise: 'Moses entered Canaan', status: 'contradicted', evidence: ['DEU 34:1'] }, q, keys, texts)).toMatchObject({ status: 'not-verified', evidence: [] })
    expect(checkedPremise({ premise: 'Moses entered Canaan', status: 'contradicted', evidence: ['DEU 34:4'] }, q, keys)).toMatchObject({ status: 'not-verified' })
  })

  it('rejects a premise that does not restate the question, placeholders, and bad shapes', () => {
    expect(checkedPremise({ premise: 'grace is unmerited favour', status: 'not-verified', evidence: [] }, q, keys)).toBeNull()
    expect(checkedPremise({ premise: '<the assumption>', status: 'not-verified' }, q, keys)).toBeNull()
    expect(checkedPremise({ premise: 'Moses entered Canaan', status: 'maybe' }, q, keys)).toBeNull()
    expect(checkedPremise('Moses entered Canaan', q, keys)).toBeNull()
  })
})
