// The one-line text shown on an AI reply bubble, derived from the typed outcome. A model failure
// is always named as such; "no matches" is only said when nothing failed and nothing was found.

import { researchErrorCopy, legacyErrorToCode, type ResearchErrorCode } from './errors'

export interface ReplyOutcome {
  errorCode?: ResearchErrorCode
  partial?: boolean
  /** Legacy main-process error string (older hosts). */
  error?: string
  hasAnswer: boolean
}

export function replyTextFor(outcome: ReplyOutcome, opts: { runtimeName?: string } = {}): string {
  const code = outcome.errorCode ?? legacyErrorToCode(outcome.error)
  if (!code) return outcome.hasAnswer ? '' : researchErrorCopy('NO_MATCHES').title + '. ' + researchErrorCopy('NO_MATCHES').detail
  if (code === 'NO_MATCHES') return outcome.hasAnswer ? '' : `${researchErrorCopy(code).title}. ${researchErrorCopy(code).detail}`
  const partial = outcome.partial ?? outcome.hasAnswer
  const copy = researchErrorCopy(code, { partial })
  // Only the "isn't running" wording when the runtime didn't answer at all (legacy
  // 'ollama-unavailable'); a runtime that answered with a server error is running.
  if (code === 'RUNTIME_UNAVAILABLE' && opts.runtimeName && outcome.error === 'ollama-unavailable') {
    return `${opts.runtimeName} isn't running, so the AI model couldn't be used.${partial ? ' Results found without the AI model are shown below.' : ' Start it to use AI-assisted search.'}`
  }
  return `${copy.title}. ${copy.detail}`
}
