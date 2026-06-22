import { describe, it, expect } from 'vitest'
import { buildIdiomsExportHtml, DEFAULT_IDIOMS_OPTIONS, type IdiomsExportOptions } from '../idiomsExport'

const idioms = [
  { term: 'gird up your loins', meaning: 'prepare for action', aliases: ['gird your loins'], content: 'See **1 Kings 18:46**.' },
  { term: 'apple of his eye', meaning: 'cherished', aliases: [], content: '' },
]

const opts = (o: Partial<IdiomsExportOptions> = {}): IdiomsExportOptions => ({ ...DEFAULT_IDIOMS_OPTIONS, ...o })

describe('buildIdiomsExportHtml', () => {
  it('returns empty string when there are no idioms', () => {
    expect(buildIdiomsExportHtml([], DEFAULT_IDIOMS_OPTIONS)).toBe('')
    expect(buildIdiomsExportHtml([{ term: '  ' }], DEFAULT_IDIOMS_OPTIONS)).toBe('')
  })

  it('renders a table with the requested column headers', () => {
    const html = buildIdiomsExportHtml(idioms, opts({ organization: 'flat' }))
    expect(html).toContain('<table')
    expect(html).toContain('>Idiom<')
    expect(html).toContain('>Meaning<')
    expect(html).toContain('>Also known as<')
    expect(html).toContain('>Notes<')
  })

  it('omits columns that are turned off', () => {
    const html = buildIdiomsExportHtml(idioms, opts({ organization: 'flat', includeAliases: false, includeNotes: false }))
    expect(html).toContain('>Meaning<')
    expect(html).not.toContain('>Also known as<')
    expect(html).not.toContain('>Notes<')
  })

  it('sorts alphabetically and title-cases the term', () => {
    const html = buildIdiomsExportHtml(idioms, opts({ organization: 'flat' }))
    expect(html.indexOf('Apple Of His Eye')).toBeLessThan(html.indexOf('Gird Up Your Loins'))
  })

  it('strips markdown from the Notes cell', () => {
    const html = buildIdiomsExportHtml(idioms, opts({ organization: 'flat' }))
    expect(html).toContain('See 1 Kings 18:46.')
    expect(html).not.toContain('**1 Kings')
  })

  it('grouped organization adds first-letter headings', () => {
    const html = buildIdiomsExportHtml(idioms, opts({ organization: 'grouped' }))
    expect(html).toContain('>A</h2>')
    expect(html).toContain('>G</h2>')
  })

  it('contents organization adds a Contents index', () => {
    const html = buildIdiomsExportHtml(idioms, opts({ organization: 'contents' }))
    expect(html).toContain('Contents')
    expect(html).toContain('A (1)')
    expect(html).toContain('G (1)')
  })

  it('compact density uses smaller padding/font than spacious', () => {
    const compact = buildIdiomsExportHtml(idioms, opts({ density: 'compact' }))
    const spacious = buildIdiomsExportHtml(idioms, opts({ density: 'spacious' }))
    expect(compact).toContain('font-size:11px')
    expect(spacious).toContain('font-size:13px')
  })

  it('escapes HTML in cell content', () => {
    const html = buildIdiomsExportHtml([{ term: 'x', meaning: 'a < b & c' }], opts({ organization: 'flat' }))
    expect(html).toContain('a &lt; b &amp; c')
  })
})
