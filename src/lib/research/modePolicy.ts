// Commentary OFF contract (spec §5.1, decision 2). Enforced structurally, not by a prompt: with
// Commentary off the pipeline never asks a model for prose, and the response wrapper strips any
// commentary that could arrive anyway. When the question itself asks for interpretation, the
// answer still shows only the evidence, plus a one-tap offer to explore interpretations — the
// mode is never switched automatically.

// Shapes that ask for meaning, application or an argument rather than for the text itself.
// Factual word questions ("what does G5485 mean", "the Hebrew word for mercy") are lexical
// lookups, answered from the lexicon, and are deliberately not matched here.
const INTERPRETIVE_RE = new RegExp([
  String.raw`\b(interpret|interpretation|interpretations|exegesis|theolog(?:y|ical|ically)|doctrin(?:e|al))\b`,
  String.raw`\bwhat\s+(?:is|was)\s+(?:the\s+)?(?:meaning|significance|point|lesson|message)\b`,
  String.raw`\bwhat\s+does\s+(?:this|that|it|the)(?:\s+(?:passage|verse|chapter|parable|story|text))?\s+(?:mean|teach|show|tell\s+us)\b`,
  String.raw`\bwhat\s+does\s+[1-3]?\s?[A-Z][a-z]+\.?\s+\d+(?::\d+)?\s+(?:mean|teach)\b`,
  String.raw`\b(?:explain|explaining)\s+(?:the\s+)?(?:meaning|significance)\b`,
  String.raw`\bhow\s+should\s+(?:we|i|christians|believers)\b`,
  String.raw`\b(?:apply|application)\b.*\b(?:today|life|us|me)\b`,
  String.raw`\bwhy\s+did\s+(?:god|yehovah|the\s+lord|yeshua|jesus|paul|moses|david)\b`,
  String.raw`\bdoes\s+(?:this|that|it|the\s+bible|scripture)\s+(?:prove|teach|mean|show)\b`,
  String.raw`\b(?:is|was)\s+(?:the\s+)?(?:law|sabbath|torah)\s+(?:abolished|done\s+away|still\s+binding)\b`,
].join('|'), 'i')

const LEXICAL_RE = /\b(hebrew|greek|aramaic|strong'?s|lexicon|transliterat|lemma|word\s+for|root)\b|\b[HG]-?\d{1,5}\b/i

/** True when the question asks for interpretation (meaning, significance, application, argument). */
export function asksForInterpretation(question: string): boolean {
  const q = question.trim()
  if (!q) return false
  if (LEXICAL_RE.test(q) && !/\b(interpret|theolog|doctrin|significance|apply|application)\b/i.test(q)) return false
  return INTERPRETIVE_RE.test(q)
}

/** Fields of a result that carry model-written prose. */
export interface ProseBearing {
  results: Array<{ commentary?: string }>
  summary?: string
}

/** Removes model-written per-verse commentary. The summary is kept only when it is a known
 *  deterministic label (the caller passes `summaryIsDeterministic`). */
export function stripModelProse<T extends ProseBearing>(response: T, summaryIsDeterministic: boolean): T {
  const results = response.results.map((r) => (r.commentary ? { ...r, commentary: undefined } : r))
  return { ...response, results, summary: summaryIsDeterministic ? response.summary : undefined }
}
