import { describe, it, expect } from 'vitest'
import { buildIdiomsExportHtml, DEFAULT_IDIOMS_OPTIONS, type IdiomsExportOptions } from '../idiomsExport'

const idioms = [
  { term: 'gird up your loins', meaning: 'prepare for action', aliases: ['gird your loins'],
    explanation: 'A figure for readiness — gird up your loins, like a runner.',
    compare: ['roll up your sleeves'], verses: ['1 Kings 18:46'] },
  { term: 'apple of his eye', meaning: 'someone cherished', aliases: [], compare: [], verses: [] },
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

  it('renders aliases', () => {
    const html = buildIdiomsExportHtml(idioms, opts({ organization: 'flat' }))
    expect(html).toContain('Also: gird your loins')
  })

  it('renders explanation, Compare to, and References', () => {
    const html = buildIdiomsExportHtml(idioms, opts({ organization: 'flat' }))
    expect(html).toContain('figure for readiness')
    expect(html).toContain('Compare to:')
    expect(html).toContain('roll up your sleeves')
    expect(html).toContain('References:')
    expect(html).toContain('1 Kings 18:46')
  })

  it('never renders numbered example sentences', () => {
    const html = buildIdiomsExportHtml(idioms, opts({ organization: 'flat' }))
    expect(html).not.toContain('>1.</span>')
    expect(html).not.toContain('>2.</span>')
  })

  it('links a "Compare to" entry to the matching idiom\'s anchor when it exists in the export', () => {
    const linked = [
      { term: 'gird up your loins', meaning: 'prepare for action', compare: ['roll up your sleeves'] },
      { term: 'roll up your sleeves', meaning: 'get to work' },
    ]
    const html = buildIdiomsExportHtml(linked, opts({ organization: 'flat' }))
    expect(html).toContain('id="idiom-roll-up-your-sleeves"')
    expect(html).toContain('<a href="#idiom-roll-up-your-sleeves"')
  })

  it('leaves a "Compare to" entry as plain text when no matching idiom is in the export', () => {
    const html = buildIdiomsExportHtml(idioms, opts({ organization: 'flat' }))
    expect(html).not.toContain('<a href')
    expect(html).toContain('roll up your sleeves')
  })

  it('matches a "Compare to" entry against another idiom\'s alias, not just its term', () => {
    const linked = [
      { term: 'gird up your loins', compare: ['gird your loins'] },
      { term: 'be ready', aliases: ['gird your loins'] },
    ]
    const html = buildIdiomsExportHtml(linked, opts({ organization: 'flat' }))
    expect(html).toContain('<a href="#idiom-be-ready"')
  })

  it('omits sections that are turned off', () => {
    const html = buildIdiomsExportHtml(idioms, opts({ organization: 'flat', includeAliases: false, includeExplanation: false, includeCompare: false, includeReferences: false }))
    expect(html).not.toContain('Also:')
    expect(html).not.toContain('Compare to:')
    expect(html).not.toContain('References:')
    expect(html).not.toContain('figure for readiness')
  })

  it('two-column only when there is enough content; few idioms stay single column', () => {
    expect(buildIdiomsExportHtml(idioms, opts({ layout: 'two-column' }))).not.toContain('column-count:2')
    const many = Array.from({ length: 30 }, (_, i) => ({ term: `idiom ${String.fromCharCode(97 + (i % 26))}${i}`, meaning: 'm', explanation: 'e'.repeat(80) }))
    expect(buildIdiomsExportHtml(many, opts({ layout: 'two-column' }))).toContain('column-count:2')
  })

  it('grouped adds letter headings; contents adds an index', () => {
    expect(buildIdiomsExportHtml(idioms, opts({ organization: 'grouped' }))).toContain('>A</div>')
    const contents = buildIdiomsExportHtml(idioms, opts({ organization: 'contents' }))
    expect(contents).toContain('Contents')
    expect(contents).toContain('A (1)')
  })

  it('honors theme colours when provided', () => {
    const html = buildIdiomsExportHtml(idioms, opts({ organization: 'flat' }), { term: '#0d9488', rule: '#ccfbf1', muted: '#64748b' })
    expect(html).toContain('#0d9488')
    expect(html).not.toContain('#c0392b')
  })

  it('escapes HTML in fields', () => {
    const html = buildIdiomsExportHtml([{ term: 'x', meaning: 'a < b & c' }], opts({ organization: 'flat' }))
    expect(html).toContain('a &lt; b &amp; c')
  })
})
