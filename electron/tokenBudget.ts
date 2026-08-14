// Team 3b item #4 — rough token budgeting against Ollama's NUM_CTX, so a pinned chapter +
// candidate verses + chat history can't silently overflow the context window and get truncated
// by Ollama with no warning. Before this, every size limit in aiLookup.ts was a character/row
// cap chosen ad hoc (TAB_CONTEXT_MAX_CHARS = 4000 chars, 12 candidate verses, 60-verse chapter
// pins, 4 history turns) — none of them added up against the model's real budget, so a question
// that happened to combine several of them near their individual caps could still overflow
// NUM_CTX. A silent overflow LOOKS exactly like the model ignoring evidence it was actually
// given (the tail of a long prompt just never arrives), which is a uniquely hard failure mode to
// diagnose from the outside — this module exists so that failure mode can't happen invisibly.

// No real tokenizer is linked into this app (llama3.1 uses a BPE vocabulary Ollama itself owns;
// pulling in a matching tokenizer library just for a budgeting guard is more machinery than the
// problem warrants). A chars-per-token heuristic is standard practice for this kind of guard —
// OpenAI's own docs quote "~4 characters per token" for English text, and that ratio holds
// closely enough for Llama-family BPE vocabularies on ordinary English prose (KJV-style text
// included) for a CONSERVATIVE budgeting estimate to be useful. Deliberately not tuned tighter
// than that: this only needs to keep the estimate in the right ballpark so trimming kicks in
// before a real overflow, not to match the real tokenizer exactly — a false-positive trim (a
// prompt that would have JUST fit) costs nothing but showing slightly less context; a
// false-negative (thinking there's room when there isn't) is the actual failure this exists to
// prevent, so this ratio is not rounded up to be more "generous."
const CHARS_PER_TOKEN = 4

/** Rough token count for a piece of prompt text — see CHARS_PER_TOKEN above for the ratio and
 *  why it's good enough for a budgeting guard, not an exact accounting. Exported so prompt
 *  assembly and tests can both call it directly rather than duplicating the ratio. */
export function estimateTokens(text: string | undefined | null): number {
  if (!text) return 0
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/** Sum of estimateTokens over a whole list — used when budgeting a list of independent chunks
 *  (candidate verse lines, history turns) rather than one contiguous block of text. */
export function estimateTokensForAll(texts: Array<string | undefined | null>): number {
  return texts.reduce((sum: number, t) => sum + estimateTokens(t), 0)
}

export interface PromptBudgetInputs {
  /** Always kept in full — the question itself is never trimmed. */
  question: string
  /** Everything in the prompt template OTHER than history/tabContext/candidates — headers,
   *  rules, JSON-shape examples, etc. Always kept in full; it's what makes the prompt a
   *  well-formed instruction at all, and it's typically small and fixed-size regardless of the
   *  question, unlike the three trimmable pieces below. */
  staticOverhead: string
  /** Prior chat turns, OLDEST FIRST — trimmed first, oldest-first, since a follow-up question
   *  needs its most RECENT context far more than its oldest. */
  historyTurns: string[]
  /** The active-tab context block (buildTabContextBlock's output) — a whole Bible chapter, note,
   *  lexicon entry, or video description. Trimmed second, from the tail, so a truncated chapter
   *  keeps its opening verses (where a "why does X happen in chapter Y" question's answer usually
   *  starts) rather than losing them to make room for the end. */
  tabContextBlock: string
  /** Candidate verse lines, BEST-SCORING FIRST (already ranked by the caller — see
   *  scoreCandidates in aiLookup.ts). Trimmed last, from the tail, which is exactly "the
   *  lowest-scoring candidates" since the list only ever arrives already sorted best-first. At
   *  least one is always kept if the list is non-empty — an empty candidate list defeats the
   *  entire point of a lookup/commentary call. */
  candidateBlocks: string[]
}

export interface PromptBudgetResult {
  historyTurns: string[]
  tabContextBlock: string
  candidateBlocks: string[]
  /** What was actually cut, for logging/testing — never user-facing on its own. */
  trimmed: { historyTurnsDropped: number; tabContextTruncated: boolean; candidatesDropped: number }
}

// Marker appended to a tail-truncated tabContextBlock — same "visible marker, not a silent cut"
// convention truncateContext already uses in aiLookup.ts for its own, unrelated 4000-char cap.
const TRUNCATION_MARKER = ' […truncated for length]'

/** Trims prompt material to fit `maxTokens`, in the fixed priority order documented on
 *  PromptBudgetInputs above: history (oldest turns first), then tab context (from its tail),
 *  then candidates (from the tail — lowest-scoring, since the list arrives best-first). The
 *  question and staticOverhead are never trimmed; passing a maxTokens too small to fit even
 *  those plus one candidate just means the trimming reaches its floor and returns whatever it
 *  could keep — it never throws, matching every other best-effort/degrade convention in
 *  aiLookup.ts. */
export function budgetPromptMaterial(inputs: PromptBudgetInputs, maxTokens: number): PromptBudgetResult {
  const fixedTokens = estimateTokens(inputs.question) + estimateTokens(inputs.staticOverhead)
  let historyTurns = [...inputs.historyTurns]
  let tabContextBlock = inputs.tabContextBlock
  let candidateBlocks = [...inputs.candidateBlocks]
  let historyTurnsDropped = 0
  let tabContextTruncated = false
  let candidatesDropped = 0

  const currentTotal = () => fixedTokens
    + estimateTokensForAll(historyTurns) + estimateTokens(tabContextBlock) + estimateTokensForAll(candidateBlocks)

  // 1. Oldest history turns first.
  while (currentTotal() > maxTokens && historyTurns.length > 0) {
    historyTurns = historyTurns.slice(1)
    historyTurnsDropped++
  }

  // 2. Tab context, truncated from the tail (in token-sized chunks so this converges quickly
  // instead of shaving one character at a time) — covers both a short note/lexicon/video blob
  // and the much larger whole-chapter-pin case (buildTabContextBlock's 'bible' branch) the same
  // way, since both are just this one string.
  if (currentTotal() > maxTokens && tabContextBlock.length > 0) {
    const overBy = currentTotal() - maxTokens
    const charsToCut = Math.min(tabContextBlock.length, Math.max(0, overBy * CHARS_PER_TOKEN) + TRUNCATION_MARKER.length)
    if (charsToCut >= tabContextBlock.length) {
      tabContextBlock = ''
      tabContextTruncated = true
    } else if (charsToCut > 0) {
      tabContextBlock = tabContextBlock.slice(0, tabContextBlock.length - charsToCut) + TRUNCATION_MARKER
      tabContextTruncated = true
    }
  }

  // 3. Lowest-scoring candidates last — dropped from the tail one at a time (rather than a bulk
  // char-cut like step 2) since each candidate is a discrete, independently meaningful unit
  // (a whole verse) rather than one continuous blob where a mid-cut is fine. Always leaves at
  // least one candidate if there was ever at least one — see the docstring on
  // PromptBudgetInputs.candidateBlocks.
  while (currentTotal() > maxTokens && candidateBlocks.length > 1) {
    candidateBlocks = candidateBlocks.slice(0, -1)
    candidatesDropped++
  }

  return { historyTurns, tabContextBlock, candidateBlocks, trimmed: { historyTurnsDropped, tabContextTruncated, candidatesDropped } }
}
