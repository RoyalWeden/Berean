import { describe, it, expect } from 'vitest'
import {
  buildIdiomsExportMarkdown, COMPACT_IDIOMS_OPTIONS, DETAILED_IDIOMS_OPTIONS,
} from '../idiomsExport'

const idioms = [
  { term: 'gird up your loins', meaning: 'prepare for action', aliases: ['gird your loins'], content: 'See 1 Kings 18:46.' },
  { term: 'apple of his eye', meaning: 'cherished', aliases: [], content: '' },
]

describe('buildIdiomsExportMarkdown', () => {
  it('returns empty string when there are no idioms', () => {
    expect(buildIdiomsExportMarkdown([], DETAILED_IDIOMS_OPTIONS)).toBe('')
    expect(buildIdiomsExportMarkdown([{ term: '  ' }], DETAILED_IDIOMS_OPTIONS)).toBe('')
  })

  it('compact mode includes term + meaning only', () => {
    const md = buildIdiomsExportMarkdown(idioms, COMPACT_IDIOMS_OPTIONS)
    expect(md).toContain('# Idioms')
    expect(md).toContain('## Apple Of His Eye')   // title-cased, sorted first
    expect(md).toContain('cherished')
    expect(md).not.toContain('Also:')             // aliases excluded
    expect(md).not.toContain('1 Kings 18:46')     // content excluded
  })

  it('detailed mode includes aliases and full content', () => {
    const md = buildIdiomsExportMarkdown(idioms, DETAILED_IDIOMS_OPTIONS)
    expect(md).toContain('*Also:* gird your loins')
    expect(md).toContain('See 1 Kings 18:46.')
  })

  it('sorts alphabetically by term', () => {
    const md = buildIdiomsExportMarkdown(idioms, DETAILED_IDIOMS_OPTIONS)
    expect(md.indexOf('Apple Of His Eye')).toBeLessThan(md.indexOf('Gird Up Your Loins'))
  })

  it('keeps order when sortAlphabetical is false', () => {
    const md = buildIdiomsExportMarkdown(idioms, { ...DETAILED_IDIOMS_OPTIONS, sortAlphabetical: false })
    expect(md.indexOf('Gird Up Your Loins')).toBeLessThan(md.indexOf('Apple Of His Eye'))
  })

  it('honors a custom heading', () => {
    const md = buildIdiomsExportMarkdown(idioms, { ...COMPACT_IDIOMS_OPTIONS, heading: 'Hebrew Idioms' })
    expect(md).toContain('# Hebrew Idioms')
  })
})
