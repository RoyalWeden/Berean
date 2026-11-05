// Premise check (spec §6.1 #11, decision 18, scenario 9). A question can carry an assumption the
// text doesn't support ("Why did Moses enter Canaan?"). The model only proposes which assumption
// to test and which of the ALREADY-RETRIEVED verses bear on it; everything shown is then checked
// here: the premise must restate the question's own words, cited verses must be ones Berean
// retrieved, and the wording is a fixed factual template — never the model's prose — so it is
// safe with Commentary OFF. Pure; shared by desktop and iPhone.

export type PremiseStatus = 'supported' | 'not-verified' | 'contradicted'

export interface PremiseCheck {
  /** The assumption, restated in the question's own words. */
  premise: string
  status: PremiseStatus
  /** Retrieved verses ("DEU 34:4") that bear on it. Empty for not-verified. */
  evidence: string[]
  /** A neutral search that tests the premise, offered as a follow-up. */
  reformulated?: string
}

/** Questions that presuppose an event or claim: "why did…", "when did…", "where did…",
 *  "which verses prove…", "how did… after…". Ordinary topical or lexical questions are not. */
const PREMISE_SHAPED_RE = /^\s*(?:why|when|where|how)\s+(?:did|does|do|was|were|is|are|had|has)\s+\S+|\b(?:which|what)\s+(?:verses?|passages?|scriptures?)\s+(?:prove|show|teach|confirm)\s+(?:that\s+)?\S+|\bprove\s+that\b/i

export function isPremiseShaped(question: string): boolean {
  return PREMISE_SHAPED_RE.test(question)
}

const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'on', 'and', 'or', 'that', 'this', 'is', 'was', 'were', 'did', 'does', 'do', 'why', 'when', 'where', 'how', 'which', 'what', 'verses', 'verse', 'prove', 'show', 'he', 'she', 'it', 'they', 'his', 'her', 'their'])
const contentWords = (s: string) => s.toLowerCase().match(/[\p{L}']+/gu)?.filter((w) => w.length > 2 && !STOP.has(w)) ?? []

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
 "evidence": ["<keys from the list above that state or contradict it>"],
 "reformulated": "<a neutral search that would test it, under 10 words>"}
Use "supported" or "contradicted" only when a listed verse says so explicitly; otherwise "not-verified".`
}

/** Validates the model's proposal. Returns null when it can't be shown safely. */
export function checkedPremise(raw: unknown, question: string, retrievedKeys: ReadonlyArray<string>): PremiseCheck | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const status = r.status
  if (status !== 'supported' && status !== 'not-verified' && status !== 'contradicted') return null
  const premise = typeof r.premise === 'string' ? r.premise.trim().replace(/^["“]|["”]$/g, '').replace(/[.?!]+$/, '') : ''
  if (!premise || premise.startsWith('<') || premise.split(/\s+/).length > 15) return null
  // The premise must restate the question — at least two of its content words, or all of a short one.
  const q = new Set(contentWords(question))
  const shared = contentWords(premise).filter((w) => q.has(w))
  if (shared.length < Math.min(2, q.size)) return null
  const allowed = new Set(retrievedKeys)
  const evidence = Array.isArray(r.evidence) ? [...new Set(r.evidence.filter((k): k is string => typeof k === 'string' && allowed.has(k.trim())).map((k) => k.trim()))] : []
  // "Supported"/"contradicted" are claims about the text — without a cited verse they are not shown.
  const finalStatus: PremiseStatus = status !== 'not-verified' && evidence.length === 0 ? 'not-verified' : status
  const reformulated = typeof r.reformulated === 'string' && !r.reformulated.trim().startsWith('<') ? r.reformulated.trim().slice(0, 80) : undefined
  // A supported premise needs no notice.
  if (finalStatus === 'supported') return null
  return { premise, status: finalStatus, evidence: finalStatus === 'not-verified' ? [] : evidence, ...(reformulated ? { reformulated } : {}) }
}

/** Fixed factual wording (spec §5: "The premise that … is not supported by the cited passage"). */
export function premiseNoticeText(p: PremiseCheck): string {
  return p.status === 'contradicted'
    ? `The premise “${p.premise}” is contradicted by the passages cited below.`
    : `The premise “${p.premise}” is not verified by the passages found. Berean could not confirm it from these sources; other sources may exist.`
}
