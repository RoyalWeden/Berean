/**
 * Build a single markdown document from all idiom notes, for printing / PDF export.
 * The caller chooses how much detail to include (compact = just term + meaning;
 * detailed = aliases and the full note body too).
 */

export interface IdiomExportEntry {
  term: string
  meaning?: string
  aliases?: string[]
  content?: string
}

export interface IdiomsExportOptions {
  includeMeaning: boolean
  includeAliases: boolean
  includeContent: boolean
  /** Sort entries alphabetically by term (otherwise keep the given order). */
  sortAlphabetical: boolean
  /** Document heading (default "Idioms"). */
  heading?: string
}

export const COMPACT_IDIOMS_OPTIONS: IdiomsExportOptions = {
  includeMeaning: true, includeAliases: false, includeContent: false, sortAlphabetical: true,
}
export const DETAILED_IDIOMS_OPTIONS: IdiomsExportOptions = {
  includeMeaning: true, includeAliases: true, includeContent: true, sortAlphabetical: true,
}

function titleCase(term: string): string {
  return term.replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Returns the combined markdown, or '' when there are no idioms. */
export function buildIdiomsExportMarkdown(idioms: IdiomExportEntry[], opts: IdiomsExportOptions): string {
  const entries = idioms.filter((i) => i.term && i.term.trim())
  if (entries.length === 0) return ''
  const ordered = opts.sortAlphabetical
    ? [...entries].sort((a, b) => a.term.localeCompare(b.term))
    : entries

  const blocks: string[] = [`# ${opts.heading ?? 'Idioms'}`]
  for (const it of ordered) {
    const lines: string[] = [`## ${titleCase(it.term.trim())}`]
    if (opts.includeAliases && it.aliases && it.aliases.length > 0) {
      lines.push(`*Also:* ${it.aliases.join(', ')}`)
    }
    if (opts.includeMeaning && it.meaning && it.meaning.trim()) {
      lines.push(it.meaning.trim())
    }
    if (opts.includeContent && it.content && it.content.trim()) {
      lines.push(it.content.trim())
    }
    blocks.push(lines.join('\n\n'))
  }
  return blocks.join('\n\n')
}
