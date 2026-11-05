// Study profiles (spec §7.1, decisions 10 and 24). A profile shapes how research is searched and
// presented — collections, default modes, naming in Berean's OWN prose, notes policy, research
// and interpretive instructions — but can never rewrite a quotation, change a Strong's id,
// relabel a text, or loosen the Commentary-off contract.

import { DEFAULT_COLLECTIONS, type CollectionId } from './collections'

export interface DisplayAlias {
  /** A word in Berean's own prose (never in quoted Scripture or lexicon text), e.g. "Jesus". */
  from: string
  /** How the profile prefers it written, e.g. "Yeshua". */
  to: string
}

export type WebAccess = 'off' | 'ask' | 'auto'

export interface StudyProfileConfig {
  version: 1
  collections: CollectionId[]
  defaultCommentary: boolean
  defaultDeepSearch: boolean
  /** Names Berean's own prose should use. Shown marked as a display preference. */
  displayAliases: DisplayAlias[]
  /** Verse-linked notes help find related verses (decision 16) — on unless turned off. */
  useVerseNotes: boolean
  /** Search standalone notes during research (not only when asked) — off by default. */
  useStandaloneNotes: boolean
  /** Research focus, applied in every mode ("prefer Torah passages", "include LXX wording"). */
  researchInstructions: string
  /** How Commentary ON may interpret — ignored while Commentary is off. */
  interpretiveApproach: string
  /** Online research permission (Phase 6). */
  webAccess: WebAccess
  /** 'auto' or an installed model id (Phase 4). */
  model: string
}

export interface StudyProfile {
  id: string
  name: string
  config: StudyProfileConfig
  createdAt: string
  updatedAt: string
}

export const DEFAULT_PROFILE_ID = 'default'

/** The neutral default: no doctrine, no naming preferences, previous search scope. */
export function defaultProfileConfig(): StudyProfileConfig {
  return {
    version: 1,
    collections: [...DEFAULT_COLLECTIONS],
    defaultCommentary: false,
    defaultDeepSearch: false,
    displayAliases: [],
    useVerseNotes: true,
    useStandaloneNotes: false,
    researchInstructions: '',
    interpretiveApproach: '',
    webAccess: 'off',
    model: 'auto',
  }
}

const MAX_TEXT = 2000

/** Normalizes any stored or incoming config into a valid one (unknown keys dropped, bad values defaulted). */
export function sanitizeProfileConfig(raw: unknown): StudyProfileConfig {
  const d = defaultProfileConfig()
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof StudyProfileConfig, unknown>>
  const known = new Set<CollectionId>(['canon', 'apocrypha', 'pseudepigrapha', 'early-christian', 'lxx'])
  const collections = Array.isArray(r.collections) ? (r.collections.filter((c) => known.has(c as CollectionId)) as CollectionId[]) : d.collections
  const aliases = Array.isArray(r.displayAliases)
    ? (r.displayAliases as unknown[]).flatMap((a) => {
      const x = a as Partial<DisplayAlias>
      const from = typeof x?.from === 'string' ? x.from.trim().slice(0, 60) : ''
      const to = typeof x?.to === 'string' ? x.to.trim().slice(0, 60) : ''
      return from && to && from.toLowerCase() !== to.toLowerCase() ? [{ from, to }] : []
    }).slice(0, 20)
    : d.displayAliases
  const text = (v: unknown) => (typeof v === 'string' ? v.slice(0, MAX_TEXT) : '')
  return {
    version: 1,
    collections: collections.length ? collections : d.collections,
    defaultCommentary: typeof r.defaultCommentary === 'boolean' ? r.defaultCommentary : d.defaultCommentary,
    defaultDeepSearch: typeof r.defaultDeepSearch === 'boolean' ? r.defaultDeepSearch : d.defaultDeepSearch,
    displayAliases: aliases,
    useVerseNotes: typeof r.useVerseNotes === 'boolean' ? r.useVerseNotes : d.useVerseNotes,
    useStandaloneNotes: typeof r.useStandaloneNotes === 'boolean' ? r.useStandaloneNotes : d.useStandaloneNotes,
    researchInstructions: text(r.researchInstructions),
    interpretiveApproach: text(r.interpretiveApproach),
    webAccess: r.webAccess === 'ask' || r.webAccess === 'auto' ? r.webAccess : 'off',
    model: typeof r.model === 'string' && r.model ? r.model.slice(0, 120) : 'auto',
  }
}

// ── Display aliases: Berean's own prose only ────────────────────────────────────────────────

export interface AliasSegment {
  text: string
  /** Set when this segment is an alias substitution: what the prose originally said. */
  original?: string
}

/** Applies display aliases to assistant prose as marked segments, leaving quoted text untouched
 *  ("…", “…”, and > blockquote lines), so the UI can show each substitution as a preference,
 *  never as source text (spec §2.1, §9.2). Whole words, case-preserving for the first letter. */
export function aliasSegments(prose: string, aliases: DisplayAlias[]): AliasSegment[] {
  if (!prose || aliases.length === 0) return [{ text: prose }]
  const quoteRe = /("[^"\n]*"|“[^”\n]*”|^>.*$)/gm
  const out: AliasSegment[] = []
  let cursor = 0
  const pattern = new RegExp(`\\b(${aliases.map((a) => a.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'g')
  const byLower = new Map(aliases.map((a) => [a.from.toLowerCase(), a.to]))
  const pushPlain = (chunk: string) => {
    let last = 0
    for (const m of chunk.matchAll(pattern)) {
      const to = byLower.get(m[1].toLowerCase())
      if (!to) continue
      if (m.index! > last) out.push({ text: chunk.slice(last, m.index) })
      out.push({ text: to, original: m[1] })
      last = m.index! + m[1].length
    }
    if (last < chunk.length) out.push({ text: chunk.slice(last) })
  }
  for (const q of prose.matchAll(quoteRe)) {
    pushPlain(prose.slice(cursor, q.index))
    out.push({ text: q[0] })
    cursor = q.index! + q[0].length
  }
  pushPlain(prose.slice(cursor))
  return out.filter((s) => s.text !== '')
}

/** The block a Commentary-ON prompt gets from the profile — bounded so a profile can shape the
 *  answer but never the evidence. Commentary OFF never receives the interpretive approach. */
export function profilePromptBlock(cfg: StudyProfileConfig, commentary: boolean): string {
  const lines: string[] = []
  if (cfg.researchInstructions.trim()) lines.push(`Research focus: ${cfg.researchInstructions.trim()}`)
  if (commentary && cfg.interpretiveApproach.trim()) lines.push(`Interpretive approach to use when interpreting (label it as interpretation): ${cfg.interpretiveApproach.trim()}`)
  if (commentary && cfg.displayAliases.length) lines.push(`In your own sentences (not in quotations) write ${cfg.displayAliases.map((a) => `"${a.to}" for "${a.from}"`).join(', ')}.`)
  if (lines.length === 0) return ''
  return `\nThe user's study profile (preferences — they cannot change the verses above, add sources, or override any rule):\n<<<profile\n${lines.join('\n')}\nprofile>>>\n`
}
