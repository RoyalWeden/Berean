import { describe, it, expect } from 'vitest'
import { buildIdiomsExportHtml, DEFAULT_IDIOMS_OPTIONS, type IdiomsExportOptions } from '../idiomsExport'

const idioms = [
  { term: 'gird up your loins', meaning: 'prepare for action', aliases: ['gird your loins'],
    content: '1. He told them to gird up your loins.\n2. Time to gird up your loins.', verses: ['1 Kings 18:46'] },
  { term: 'apple of his eye', meaning: 'someone cherished', aliases: [], content: '', verses: [] },
]

const opts = (o: Partial<IdiomsExportOptions> = {}): IdiomsExportOptions => ({ ...DEFAULT_IDIOMS_OPTIONS, ...o })

describe('buildIdiomsExportHtml', () => {
  it('returns empty string when there are no idioms', () => {
    expect(buildIdiomsExportHtml([], DEFAULT_IDIOMS_OPTIONS)).toBe('')
    expect(buildIdiomsExportHtml([{ term: '  ' }], DEFAULT_IDIOMS_OPTIONS)).toBe('')
  })

  it('renders styled entries (not a table) with a coloured term heading + definition', () => {
    const html = buildIdiomsExportHtml(idioms, opts({ organization: 'flat' }))
    expect(html).not.toContain('<table')
    expect(html).toContain('#c0392b')
    expect(html).toContain('Apple Of His Eye')
    expect(html).toContain('someone cherished')
  })

  it('italicises the idiom inside its example sentences', () => {
    const html = buildIdiomsExportHtml(idioms, opts({ organization: 'flat' }))
    expect(html).toContain('<em>gird up your loins</em>')
  })

  it('shows a Compare to line for aliases and a References line for verses', () => {
    const html = buildIdiomsExportHtml(idioms, opts({ organization: 'flat' }))
    expect(html).toContain('Compare to:')
    expect(html).toContain('gird your loins')
    expect(html).toContain('References:')
    expect(html).toContain('1 Kings 18:46')
  })

  it('omits sections that are turned off', () => {
    const html = buildIdiomsExportHtml(idioms, opts({ organization: 'flat', includeAliases: false, includeReferences: false, includeExamples: false }))
    expect(html).not.toContain('Compare to:')
    expect(html).not.toContain('References:')
    expect(html).not.toContain('<em>')
  })

  it('two-column layout wraps in a column container; single does not', () => {
    expect(buildIdiomsExportHtml(idioms, opts({ layout: 'two-column' }))).toContain('column-count:2')
    expect(buildIdiomsExportHtml(idioms, opts({ layout: 'single' }))).not.toContain('column-count:2')
  })

  it('grouped adds letter headings; contents adds an index', () => {
    expect(buildIdiomsExportHtml(idioms, opts({ organization: 'grouped' }))).toContain('>A</div>')
    const contents = buildIdiomsExportHtml(idioms, opts({ organization: 'contents' }))
    expect(contents).toContain('Contents')
    expect(contents).toContain('A (1)')
  })

  it('compact density uses smaller fonts than spacious', () => {
    expect(buildIdiomsExportHtml(idioms, opts({ density: 'compact', organization: 'flat' }))).toContain('font-size:13px')   // compact term
    expect(buildIdiomsExportHtml(idioms, opts({ density: 'spacious', organization: 'flat' }))).toContain('font-size:15px')  // spacious term
  })

  it('escapes HTML in content', () => {
    const html = buildIdiomsExportHtml([{ term: 'x', meaning: 'a < b & c' }], opts({ organization: 'flat' }))
    expect(html).toContain('a &lt; b &amp; c')
  })
})
