import { describe, it, expect } from 'vitest'
import { makeContext, migratedUserDb, recordingEvents } from '../../db/__tests__/testDb'
import { createStudyProfilesService } from '../studyProfilesService'
import { aliasSegments, profilePromptBlock, sanitizeProfileConfig, DEFAULT_PROFILE_ID } from '../../../lib/research/studyProfile'

async function svc() {
  const origLog = console.log; console.log = () => {}
  const userDb = await migratedUserDb()
  console.log = origLog
  const events = recordingEvents()
  let n = 0
  return { s: createStudyProfilesService(makeContext({ userDb, events: events.events, uuid: () => `p${++n}` })), events }
}

describe('studyProfilesService (spec §7.1)', () => {
  it('always has a neutral, undeletable Default profile', async () => {
    const { s } = await svc()
    const list = await s.list()
    expect(list.map((p) => p.id)).toEqual([DEFAULT_PROFILE_ID])
    expect(list[0].config).toMatchObject({ defaultCommentary: false, displayAliases: [], interpretiveApproach: '', useStandaloneNotes: false, webAccess: 'off' })
    expect(await s.remove(DEFAULT_PROFILE_ID)).toEqual({ success: false })
  })

  it('creates, edits, duplicates and deletes profiles, emitting sync changes', async () => {
    const { s, events } = await svc()
    const p = await s.create('Torah study', { collections: ['canon', 'apocrypha'], displayAliases: [{ from: 'Jesus', to: 'Yeshua' }] })
    expect(p.config.collections).toEqual(['canon', 'apocrypha'])
    const u = await s.update(p.id, { name: 'Torah', config: { defaultCommentary: true } })
    expect(u).toMatchObject({ name: 'Torah', config: { defaultCommentary: true, displayAliases: [{ from: 'Jesus', to: 'Yeshua' }] } })
    const d = await s.duplicate(p.id)
    expect(d?.name).toBe('Torah copy')
    expect(await s.remove(p.id)).toEqual({ success: true })
    expect((await s.list()).map((x) => x.name)).toEqual(['Default', 'Torah copy'])
    expect((await s.resolve(p.id)).id).toBe(DEFAULT_PROFILE_ID) // a deleted profile falls back to Default
    expect(events.changes.some((c) => c.entity === 'study_profile' && c.op === 'delete')).toBe(true)
  })

  it('sanitizes configs (unknown collections, empty aliases, bad web values)', () => {
    const c = sanitizeProfileConfig({ collections: ['canon', 'bogus'], displayAliases: [{ from: '', to: 'x' }, { from: 'LORD', to: 'LORD' }, { from: 'Jesus', to: 'Yeshua' }], webAccess: 'always', extra: 1 })
    expect(c.collections).toEqual(['canon'])
    expect(c.displayAliases).toEqual([{ from: 'Jesus', to: 'Yeshua' }])
    expect(c.webAccess).toBe('off')
    expect('extra' in c).toBe(false)
  })
})

describe('display aliases touch Berean\'s prose only (spec §2.1, scenario 19)', () => {
  const aliases = [{ from: 'Jesus', to: 'Yeshua' }]
  it('marks substitutions and leaves quotations and blockquotes alone', () => {
    const segs = aliasSegments('Jesus said “Jesus wept” here.\n> And Jesus answered\nThen Jesus left.', aliases)
    expect(segs.filter((x) => x.original).map((x) => x.text)).toEqual(['Yeshua', 'Yeshua'])
    expect(segs.map((x) => x.text).join('')).toBe('Yeshua said “Jesus wept” here.\n> And Jesus answered\nThen Yeshua left.')
    expect(segs.find((x) => x.original)?.original).toBe('Jesus')
  })
  it('passes prose through unchanged with no aliases', () => {
    expect(aliasSegments('Jesus said', [])).toEqual([{ text: 'Jesus said' }])
  })
})

describe('profilePromptBlock', () => {
  it('never gives Commentary OFF the interpretive approach (spec §5.1)', () => {
    const cfg = sanitizeProfileConfig({ researchInstructions: 'prefer Torah passages', interpretiveApproach: 'Hebrew Roots', displayAliases: [{ from: 'Jesus', to: 'Yeshua' }] })
    const off = profilePromptBlock(cfg, false)
    expect(off).toContain('prefer Torah passages')
    expect(off).not.toContain('Hebrew Roots')
    expect(off).not.toContain('Yeshua')
    const on = profilePromptBlock(cfg, true)
    expect(on).toContain('Hebrew Roots')
    expect(on).toContain('"Yeshua" for "Jesus"')
    expect(on).toMatch(/cannot change the verses/)
  })
})
