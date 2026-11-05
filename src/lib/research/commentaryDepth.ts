// Commentary ON is adaptive (spec §5.2, decision 3): it answers at the least interpretive depth
// the question asks for. A plain "explain Titus 2:11" gets what the passage says; interpretations
// appear only when asked for ("compare the main interpretations"), and are labelled as such.

export type CommentaryDepth = 'plain' | 'historical' | 'linguistic' | 'perspectives' | 'argument'

export function commentaryDepth(question: string): CommentaryDepth {
  const q = question.toLowerCase()
  if (/\b(argue|argument|make the case|defend|prove|refute|case for|case against)\b/.test(q)) return 'argument'
  if (/\b(interpretations?|views?|perspectives?|schools? of thought|how (?:do|have) (?:scholars|christians|jews|commentators)|different readings|main readings)\b/.test(q)) return 'perspectives'
  if (/\b(historical|history|setting|background|culture|cultural|context of the time|ancient)\b/.test(q)) return 'historical'
  if (/\b(hebrew|greek|aramaic|grammar|tense|word|words|lexical|strong'?s|root)\b/.test(q)) return 'linguistic'
  return 'plain'
}

const BASE_RULES = `- Keep what the verses literally say separate from any interpretation. If you interpret, start
  that sentence with "Interpretation:" so the reader can tell it apart.
- Never state a scholarly consensus, an author's intention, a date, a manuscript reading or an
  etymology unless it is in the material above; if something needed isn't there, say it isn't.`

const DEPTH_RULES: Record<CommentaryDepth, string> = {
  plain: `- The user asked for an explanation, not an interpretation: describe what these verses say and
  how they connect, in plain words. Do not add doctrine, application or interpretation.`,
  historical: `- The user asked about historical/cultural setting: give only setting that the verses themselves
  state or that you can attribute plainly; mark anything uncertain as uncertain. No interpretation
  beyond what is needed to describe the setting.`,
  linguistic: `- The user asked about wording: describe the wording of these verses. Do not invent word
  meanings, roots or grammar that aren't in the material above.`,
  perspectives: `- The user asked for interpretations: present the main readings as clearly labelled
  perspectives ("Interpretation (one view): …"), each tied to the verses that prompt it. Do not
  pick a winner and do not claim any view is the consensus.`,
  argument: `- The user asked for an argued position: give it as labelled interpretation, tie every step to
  a specific verse above, and note the strongest textual point against it.`,
}

export function commentaryDepthRules(depth: CommentaryDepth): string {
  return `${DEPTH_RULES[depth]}\n${BASE_RULES}`
}
