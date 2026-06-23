/**
 * Build a clean, reference-book-style HTML document from all idiom notes, for printing /
 * PDF export. Each idiom is a styled entry — coloured term heading, definition, numbered
 * example sentences (with the idiom italicised in context), an explanation paragraph, a
 * "Compare to" line of related idioms, and a "References" line of scripture verses. Flows in
 * one or two columns. Raw HTML passes through the note print pipeline unchanged.
 */

export interface IdiomExportEntry {
  term: string
  meaning?: string
  examples?: string[]
  explanation?: string
  compare?: string[]
  verses?: string[]
}

export type IdiomsOrganization = 'flat' | 'grouped' | 'contents'
export type IdiomsDensity = 'spacious' | 'compact'
export type IdiomsLayout = 'two-column' | 'single'

export interface IdiomsExportOptions {
  includeMeaning: boolean
  includeExamples: boolean
  includeExplanation: boolean
  includeCompare: boolean
  includeReferences: boolean
  organization: IdiomsOrganization
  density: IdiomsDensity
  layout: IdiomsLayout
}

export const DEFAULT_IDIOMS_OPTIONS: IdiomsExportOptions = {
  includeMeaning: true, includeExamples: true, includeExplanation: true, includeCompare: true, includeReferences: true,
  organization: 'grouped', density: 'spacious', layout: 'two-column',
}

/** Colours so the page matches the chosen print theme. Defaults to a warm reference-book red. */
export interface IdiomsColors { term: string; rule: string; muted: string }
const DEFAULT_COLORS: IdiomsColors = { term: '#c0392b', rule: '#e3e3e3', muted: '#888888' }

function titleCase(term: string): string {
  return term.replace(/\b\w/g, (c) => c.toUpperCase())
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function firstLetter(term: string): string {
  const m = term.trim().match(/[A-Za-z]/)
  return m ? m[0].toUpperCase() : '#'
}

/** Escape `text`, then italicise any occurrence of the idiom term (in context). */
function italiciseTerm(text: string, term: string): string {
  const out = esc(text)
  const t = term.trim()
  if (t.length < 2) return out
  const re = new RegExp(`\\b(${esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\b`, 'gi')
  return out.replace(re, '<em>$1</em>')
}

function estimateRows(e: IdiomExportEntry, opts: IdiomsExportOptions): number {
  let n = 1
  if (opts.includeMeaning && e.meaning?.trim()) n += 1
  if (opts.includeExamples && e.examples?.length) n += e.examples.length
  if (opts.includeExplanation && e.explanation?.trim()) n += 2
  if (opts.includeCompare && e.compare?.length) n += 1
  if (opts.includeReferences && e.verses?.length) n += 1
  return n + 1
}

/** Returns the combined HTML, or '' when there are no idioms. */
export function buildIdiomsExportHtml(idioms: IdiomExportEntry[], opts: IdiomsExportOptions, colors: IdiomsColors = DEFAULT_COLORS): string {
  const entries = idioms.filter((i) => i.term && i.term.trim())
    .sort((a, b) => a.term.localeCompare(b.term))
  if (entries.length === 0) return ''

  const TERM_COLOR = colors.term
  const compact = opts.density === 'compact'
  const ROWS_PER_COLUMN = compact ? 60 : 44
  const totalRows = entries.reduce((s, e) => s + estimateRows(e, opts), 0)
  const useTwoColumns = opts.layout === 'two-column' && totalRows > ROWS_PER_COLUMN

  const termSize = compact ? 13 : 15
  const bodySize = compact ? 11.5 : 13
  const defSize = compact ? 12 : 14
  const entryGap = compact ? 10 : 16
  const exGap = compact ? 2 : 3

  const entryHtml = (e: IdiomExportEntry): string => {
    const parts: string[] = []
    parts.push(`<div style="color:${TERM_COLOR};font-weight:700;font-size:${termSize}px;text-transform:uppercase;letter-spacing:.02em;line-height:1.2">${esc(titleCase(e.term.trim()))}</div>`)
    if (opts.includeMeaning && e.meaning && e.meaning.trim()) {
      parts.push(`<div style="font-size:${defSize}px;line-height:1.35;margin:1px 0 ${compact ? 4 : 6}px">${esc(e.meaning.trim())}</div>`)
    }
    if (opts.includeExamples && e.examples && e.examples.length > 0) {
      const rows = e.examples.filter((x) => x.trim()).map((ex, i) =>
        `<div style="padding-left:1.5em;text-indent:-1.5em;margin:${exGap}px 0;font-size:${bodySize}px;line-height:1.45"><span style="color:${colors.muted}">${i + 1}.</span> ${italiciseTerm(ex, e.term)}</div>`,
      ).join('')
      parts.push(`<div>${rows}</div>`)
    }
    if (opts.includeExplanation && e.explanation && e.explanation.trim()) {
      parts.push(`<div style="font-size:${bodySize}px;line-height:1.45;margin-top:${compact ? 3 : 5}px">${italiciseTerm(e.explanation.trim(), e.term)}</div>`)
    }
    if (opts.includeCompare && e.compare && e.compare.length > 0) {
      parts.push(`<div style="font-size:${bodySize}px;font-style:italic;margin-top:${compact ? 3 : 5}px"><span style="font-style:normal;color:${colors.muted}">Compare to:</span> ${esc(e.compare.join('; '))}</div>`)
    }
    if (opts.includeReferences && e.verses && e.verses.length > 0) {
      parts.push(`<div style="font-size:${bodySize}px;margin-top:${compact ? 2 : 4}px"><span style="color:${colors.muted}">References:</span> ${esc(e.verses.join(', '))}</div>`)
    }
    return `<div style="break-inside:avoid;-webkit-column-break-inside:avoid;page-break-inside:avoid;margin:0 0 ${entryGap}px">${parts.join('')}</div>`
  }

  // Group entries by first letter (preserving alphabetical order).
  const groups: { letter: string; rows: IdiomExportEntry[] }[] = []
  for (const e of entries) {
    const L = firstLetter(e.term)
    const g = groups[groups.length - 1]
    if (g && g.letter === L) g.rows.push(e)
    else groups.push({ letter: L, rows: [e] })
  }
  const letterHeading = (L: string): string =>
    `<div style="break-inside:avoid;color:${TERM_COLOR};font-size:${compact ? 16 : 20}px;font-weight:800;margin:${compact ? '10px' : '16px'} 0 6px;border-bottom:2px solid ${TERM_COLOR};padding-bottom:2px">${L}</div>`

  let inner = ''
  if (opts.organization === 'contents') {
    const links = groups.map((g) => `${g.letter} (${g.rows.length})`).join(' &nbsp;·&nbsp; ')
    inner += `<div style="break-inside:avoid;margin:0 0 ${compact ? 12 : 18}px"><div style="font-weight:700;font-size:${compact ? 12 : 13}px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;color:${colors.muted}">Contents</div>`
      + `<div style="font-size:${compact ? 11 : 12}px;color:${colors.muted}">${links}</div></div>`
  }
  if (opts.organization === 'flat') {
    inner += entries.map(entryHtml).join('')
  } else {
    for (const g of groups) inner += letterHeading(g.letter) + g.rows.map(entryHtml).join('')
  }

  if (useTwoColumns) {
    const colGap = compact ? 24 : 32
    return `<div style="column-count:2;column-gap:${colGap}px;column-rule:1px solid ${colors.rule}">${inner}</div>`
  }
  return inner
}
