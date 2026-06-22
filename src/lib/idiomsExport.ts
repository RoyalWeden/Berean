/**
 * Build a clean, reference-book-style HTML document from all idiom notes, for printing /
 * PDF export. Each idiom is a styled entry — coloured term heading, definition, the note
 * body as numbered examples (with the idiom italicised in context), a "Compare to" line of
 * aliases, and a "References" line of the scripture verses the note cites. Flows in one or
 * two columns. Raw HTML passes through the note print pipeline unchanged.
 */

export interface IdiomExportEntry {
  term: string
  meaning?: string
  content?: string
  aliases?: string[]
  /** Scripture references cited by the note, pre-formatted (e.g. "Genesis 1:1"). */
  verses?: string[]
}

export type IdiomsOrganization = 'flat' | 'grouped' | 'contents'
export type IdiomsDensity = 'spacious' | 'compact'
export type IdiomsLayout = 'two-column' | 'single'

export interface IdiomsExportOptions {
  includeMeaning: boolean
  includeExamples: boolean
  includeAliases: boolean
  includeReferences: boolean
  organization: IdiomsOrganization
  density: IdiomsDensity
  layout: IdiomsLayout
}

export const DEFAULT_IDIOMS_OPTIONS: IdiomsExportOptions = {
  includeMeaning: true, includeExamples: true, includeAliases: true, includeReferences: true,
  organization: 'grouped', density: 'spacious', layout: 'two-column',
}

const TERM_COLOR = '#c0392b'

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

/** Escape `text`, then italicise any occurrence of the idiom term or its aliases (in context). */
function italiciseIdiom(text: string, term: string, aliases: string[]): string {
  let out = esc(text)
  const forms = [term, ...aliases].map((s) => s.trim()).filter((s) => s.length >= 2)
    .sort((a, b) => b.length - a.length)  // longest first so aliases win over substrings
  for (const form of forms) {
    const re = new RegExp(`\\b(${esc(form).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\b`, 'gi')
    out = out.replace(re, '<em>$1</em>')
  }
  return out
}

/** Render the note body into numbered example rows (hanging indent) / paragraphs. */
function renderBody(content: string, term: string, aliases: string[], compact: boolean): string {
  const lines = content.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length === 0) return ''
  const gap = compact ? 2 : 3
  return lines.map((line) => {
    const m = line.match(/^(\d{1,3})[.)]\s+(.*)$/)
    const inner = italiciseIdiom(m ? m[2] : line, term, aliases)
    if (m) {
      return `<div style="padding-left:1.5em;text-indent:-1.5em;margin:${gap}px 0"><span style="color:#888">${m[1]}.</span> ${inner}</div>`
    }
    return `<div style="margin:${gap}px 0">${inner}</div>`
  }).join('')
}

/** Returns the combined HTML, or '' when there are no idioms. */
export function buildIdiomsExportHtml(idioms: IdiomExportEntry[], opts: IdiomsExportOptions): string {
  const entries = idioms.filter((i) => i.term && i.term.trim())
    .sort((a, b) => a.term.localeCompare(b.term))
  if (entries.length === 0) return ''

  const compact = opts.density === 'compact'
  const termSize = compact ? 13 : 15
  const bodySize = compact ? 11.5 : 13
  const defSize = compact ? 12 : 14
  const entryGap = compact ? 10 : 16

  const entryHtml = (e: IdiomExportEntry): string => {
    const aliases = e.aliases ?? []
    const parts: string[] = []
    parts.push(`<div style="color:${TERM_COLOR};font-weight:700;font-size:${termSize}px;text-transform:uppercase;letter-spacing:.02em;line-height:1.2">${esc(titleCase(e.term.trim()))}</div>`)
    if (opts.includeMeaning && e.meaning && e.meaning.trim()) {
      parts.push(`<div style="font-size:${defSize}px;line-height:1.35;margin:1px 0 ${compact ? 4 : 6}px">${esc(e.meaning.trim())}</div>`)
    }
    if (opts.includeExamples && e.content && e.content.trim()) {
      parts.push(`<div style="font-size:${bodySize}px;line-height:1.45">${renderBody(e.content, e.term, aliases, compact)}</div>`)
    }
    if (opts.includeAliases && aliases.length > 0) {
      parts.push(`<div style="font-size:${bodySize}px;font-style:italic;color:#555;margin-top:${compact ? 3 : 5}px"><span style="font-style:normal;color:#888">Compare to:</span> ${esc(aliases.join('; '))}</div>`)
    }
    if (opts.includeReferences && e.verses && e.verses.length > 0) {
      parts.push(`<div style="font-size:${bodySize}px;color:#555;margin-top:${compact ? 2 : 4}px"><span style="color:#888">References:</span> ${esc(e.verses.join(', '))}</div>`)
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
    inner += `<div style="break-inside:avoid;margin:0 0 ${compact ? 12 : 18}px"><div style="font-weight:700;font-size:${compact ? 12 : 13}px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;color:#888">Contents</div>`
      + `<div style="font-size:${compact ? 11 : 12}px;color:#555">${links}</div></div>`
  }
  if (opts.organization === 'flat') {
    inner += entries.map(entryHtml).join('')
  } else {
    for (const g of groups) inner += letterHeading(g.letter) + g.rows.map(entryHtml).join('')
  }

  if (opts.layout === 'two-column') {
    const colGap = compact ? 24 : 32
    return `<div style="column-count:2;column-gap:${colGap}px;column-rule:1px solid #e3e3e3">${inner}</div>`
  }
  return inner
}
