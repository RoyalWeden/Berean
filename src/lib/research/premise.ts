// Premise check (spec §6.1 #11, decision 18, scenario 9). A question can carry an assumption the
// text doesn't support ("Why did Moses enter Canaan?"). The model only reports a status and which
// of the ALREADY-RETRIEVED verses bear on it. Nothing it writes is shown: the notice is fixed
// wording, because on real models the restated premise came back inverted or with invented
// reasons, which would put model prose in front of a Commentary OFF reader. Pure; shared by desktop
// and iPhone.

export type PremiseStatus = 'supported' | 'not-verified' | 'contradicted'

export interface PremiseCheck {
  status: PremiseStatus
  /** Retrieved verses ("DEU 34:4") that bear on it. Empty for not-verified. */
  evidence: string[]
}

/** Questions that presuppose an event or a statement: "why did…", "when was…", "where did…",
 *  "where does Paul say…", "which verses prove…". Present-tense and locating questions ("why do
 *  people…", "where is Bethel named") assume nothing the text could fail to confirm. */
const PREMISE_SHAPED_RE = /^\s*(?:why|when|where|how)\s+(?:did|was|were|had)\s+\S+|^\s*where\s+(?:does|do)\s+.+?\s+(?:say|teach|command|state|mention|write)\b|\b(?:which|what)\s+(?:verses?|passages?|scriptures?)\s+(?:prove|show|teach|confirm)\s+(?:that\s+)?\S+|\bprove\s+that\b/i

export function isPremiseShaped(question: string): boolean {
  return PREMISE_SHAPED_RE.test(question)
}

const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'on', 'and', 'or', 'that', 'this', 'is', 'was', 'were', 'did', 'does', 'do', 'why', 'when', 'where', 'how', 'which', 'what', 'verses', 'verse', 'prove', 'show', 'he', 'she', 'it', 'they', 'his', 'her', 'their'])
const contentWords = (s: string) => s.toLowerCase().match(/[\p{L}']+/gu)?.filter((w) => w.length > 2 && !STOP.has(w)) ?? []

const NEGATION_RE = /\b(?:not|no|never|neither|nor|none|cannot|without)\b/i

const stem = (w: string) => w.replace(/(?:ing|eth|ed|es|s)$/, '')

/** The text plainly says it: one retrieved verse holds at least three quarters of the question's
 *  content words. "Where does it say do not add to the word" needs no notice beside Deuteronomy
 *  4:2, and asking a model would only risk a false alarm. */
export function premiseFoundInText(question: string, verses: ReadonlyArray<{ text: string }>): boolean {
  const wanted = [...new Set(contentWords(question).map(stem))]
  if (wanted.length === 0) return false
  return verses.some((v) => {
    const words = new Set(v.text.toLowerCase().match(/[\p{L}']+/gu)?.map(stem) ?? [])
    return wanted.filter((w) => words.has(w)).length / wanted.length >= 0.75
  })
}

export function premisePrompt(question: string, verses: Array<{ key: string; text: string }>): string {
  const list = verses.slice(0, 12).map((v) => `${v.key}: ${v.text.slice(0, 300)}`).join('\n')
  return `A Bible study question may assume something the text does not say. Identify the factual
assumption in the question and check it ONLY against the verses listed. Do not use outside
knowledge, do not interpret, do not explain.

Question: ${question}

Verses:
${list}

Return JSON only:
{"premise": "<the assumption, in the question's own words, under 15 words>",
 "status": "<supported | not-verified | contradicted>",
 "evidence": ["<keys from the list above that state or contradict it>"]}
Use "supported" or "contradicted" only when a listed verse says so explicitly; otherwise "not-verified".`
}

/** Validates the model's proposal. Returns null when it can't be shown safely. */
export function checkedPremise(raw: unknown, question: string, retrievedKeys: ReadonlyArray<string>, verseText: Readonly<Record<string, string>> = {}): PremiseCheck | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const status = r.status
  if (status !== 'supported' && status !== 'not-verified' && status !== 'contradicted') return null
  const premise = typeof r.premise === 'string' ? r.premise.trim().replace(/^["“]|["”]$/g, '').replace(/[.?!]+$/, '') : ''
  if (!premise || premise.startsWith('<') || premise.split(/\s+/).length > 15) return null
  // A premise unrelated to the question means the model didn't follow it: no notice. At least two of its content words, or all of a short one.
  const q = new Set(contentWords(question))
  const shared = contentWords(premise).filter((w) => q.has(w))
  if (shared.length < Math.min(2, q.size)) return null
  const allowed = new Set(retrievedKeys)
  const evidence = Array.isArray(r.evidence) ? [...new Set(r.evidence.filter((k): k is string => typeof k === 'string' && allowed.has(k.trim())).map((k) => k.trim()))] : []
  // "Supported"/"contradicted" are claims about the text — without a cited verse they are not shown.
  let finalStatus: PremiseStatus = status !== 'not-verified' && evidence.length === 0 ? 'not-verified' : status
  // "Contradicted" is reserved for direct text: a cited verse must itself deny something. A model
  // saying a passage disagrees, when no cited verse does, is an inconclusive search.
  if (finalStatus === 'contradicted' && !evidence.some((k) => NEGATION_RE.test(verseText[k] ?? ''))) finalStatus = 'not-verified'
  // A supported premise needs no notice.
  if (finalStatus === 'supported') return null
  return { status: finalStatus, evidence: finalStatus === 'not-verified' ? [] : evidence }
}

/** Fixed factual wording (spec §5). */
export function premiseNoticeText(p: PremiseCheck): string {
  return p.status === 'contradicted'
    ? 'What this question assumes is contradicted by the passages cited below.'
    : 'Berean could not confirm what this question assumes from the passages found. Other sources may exist.'
}
