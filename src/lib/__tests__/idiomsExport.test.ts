import { describe, it, expect } from 'vitest'
import { buildIdiomsExportHtml, DEFAULT_IDIOMS_OPTIONS, type IdiomsExportOptions } from '../idiomsExport'

const idioms = [
  { term: 'gird up your loins', meaning: 'prepare for action',
    examples: ['He told them to gird up your loins.', 'Time to gird up your loins.'],
    explanation: 'A figure for readiness — gird up your loins, like a runner.',
    compare: ['roll up your sleeves'], verses: ['1 Kings 18:46'] },
  { term: 'apple of his eye', meaning: 'someone cherished', examples: [], compare: [], verses: [] },
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

  it('numbers example sentences and italicises the idiom in them', () => {
    const html = buildIdiomsExportHtml(idioms, opts({ organization: 'flat' }))
    expect(html).toContain('<em>gird up your loins</em>')
    expect(html).toContain('>1.</span>')
    expect(html).toContain('>2.</span>')
  })

  it('renders explanation, Compare to, and References', () => {
    const html = buildIdiomsExportHtml(idioms, opts({ organization: 'flat' }))
    expect(html).toContain('figure for readiness')
    expect(html).toContain('Compare to:')
    expect(html).toContain('roll up your sleeves')
    expect(html).toContain('References:')
    expect(html).toContain('1 Kings 18:46')
  })

  it('omits sections that are turned off', () => {
    const html = buildIdiomsExportHtml(idioms, opts({ organization: 'flat', includeExamples: false, includeExplanation: false, includeCompare: false, includeReferences: false }))
    expect(html).not.toContain('<em>')
    expect(html).not.toContain('Compare to:')
    expect(html).not.toContain('References:')
    expect(html).not.toContain('figure for readiness')
  })

  it('two-column only when there is enough content; few idioms stay single column', () => {
    expect(buildIdiomsExportHtml(idioms, opts({ layout: 'two-column' }))).not.toContain('column-count:2')
    const many = Array.from({ length: 30 }, (_, i) => ({ term: `idiom ${String.fromCharCode(97 + (i % 26))}${i}`, meaning: 'm', examples: ['ex'] }))
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
