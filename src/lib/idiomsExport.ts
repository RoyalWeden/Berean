/**
 * Build a clean, structured HTML document from all idiom notes, for printing / PDF export.
 * Renders a table (Idiom / Meaning / Also known as / Notes) with user-chosen columns,
 * organization (flat, grouped by first letter, or grouped with a contents index), and
 * density (spacious or compact). Raw HTML passes through the note print pipeline unchanged.
 */

export interface IdiomExportEntry {
  term: string
  meaning?: string
  aliases?: string[]
  content?: string
}

export type IdiomsOrganization = 'flat' | 'grouped' | 'contents'
export type IdiomsDensity = 'spacious' | 'compact'

export interface IdiomsExportOptions {
  includeMeaning: boolean
  includeAliases: boolean
  includeNotes: boolean
  organization: IdiomsOrganization
  density: IdiomsDensity
}

export const DEFAULT_IDIOMS_OPTIONS: IdiomsExportOptions = {
  includeMeaning: true, includeAliases: true, includeNotes: true,
  organization: 'grouped', density: 'spacious',
}

function titleCase(term: string): string {
  return term.replace(/\b\w/g, (c) => c.toUpperCase())
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Strip light markdown + collapse whitespace so note bodies sit cleanly in a table cell. */
function plainify(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')        // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')      // links → text
    .replace(/[*_`#>~]/g, '')                     // md markers
    .replace(/\s+/g, ' ')
    .trim()
}

function firstLetter(term: string): string {
  const m = term.trim().match(/[A-Za-z]/)
  return m ? m[0].toUpperCase() : '#'
}

/** Returns the combined HTML, or '' when there are no idioms. */
export function buildIdiomsExportHtml(idioms: IdiomExportEntry[], opts: IdiomsExportOptions): string {
  const entries = idioms.filter((i) => i.term && i.term.trim())
    .sort((a, b) => a.term.localeCompare(b.term))
  if (entries.length === 0) return ''

  const compact = opts.density === 'compact'
  const cell = compact
    ? 'padding:3px 8px;font-size:11px;line-height:1.35;vertical-align:top;border-bottom:1px solid #ddd'
    : 'padding:8px 12px;font-size:13px;line-height:1.55;vertical-align:top;border-bottom:1px solid #ddd'
  const headCell = `${cell.replace('border-bottom:1px solid #ddd', 'border-bottom:2px solid #999')};font-weight:600;text-align:left;white-space:nowrap`

  const cols: { key: 'term' | 'meaning' | 'aliases' | 'notes'; label: string }[] = [{ key: 'term', label: 'Idiom' }]
  if (opts.includeMeaning) cols.push({ key: 'meaning', label: 'Meaning' })
  if (opts.includeAliases) cols.push({ key: 'aliases', label: 'Also known as' })
  if (opts.includeNotes) cols.push({ key: 'notes', label: 'Notes' })

  const cellFor = (e: IdiomExportEntry, key: string): string => {
    if (key === 'term') return `<strong>${esc(titleCase(e.term.trim()))}</strong>`
    if (key === 'meaning') return esc((e.meaning ?? '').trim())
    if (key === 'aliases') return esc((e.aliases ?? []).join(', '))
    if (key === 'notes') return esc(plainify(e.content ?? ''))
    return ''
  }

  const tableFor = (rows: IdiomExportEntry[]): string => {
    const head = `<tr>${cols.map((c) => `<th style="${headCell}">${c.label}</th>`).join('')}</tr>`
    const body = rows.map((e) =>
      `<tr>${cols.map((c) => `<td style="${cell}">${cellFor(e, c.key)}</td>`).join('')}</tr>`,
    ).join('')
    return `<table style="border-collapse:collapse;width:100%;margin:0 0 ${compact ? 12 : 20}px">`
      + `<thead>${head}</thead><tbody>${body}</tbody></table>`
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
    `<h2 style="font-size:${compact ? 14 : 17}px;font-weight:700;margin:${compact ? '14px' : '22px'} 0 6px;border-bottom:1px solid #ccc;padding-bottom:2px">${L}</h2>`

  if (opts.organization === 'flat') {
    return tableFor(entries)
  }

  let html = ''
  if (opts.organization === 'contents') {
    const links = groups.map((g) => `${g.letter} (${g.rows.length})`).join(' &nbsp;·&nbsp; ')
    html += `<div style="margin:0 0 ${compact ? 12 : 20}px"><div style="font-weight:700;font-size:${compact ? 12 : 13}px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Contents</div>`
      + `<div style="font-size:${compact ? 11 : 12}px;color:#555">${links}</div></div>`
  }
  for (const g of groups) {
    html += letterHeading(g.letter) + tableFor(g.rows)
  }
  return html
}
