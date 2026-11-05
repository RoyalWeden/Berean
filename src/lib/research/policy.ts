// Privacy and permission policy (spec §7.3, decisions 19, 23, 25). Every research step that touches
// notes, the network or a cloud model asks `decide()` first; nothing leaves the device unless this
// says so. Pure and shared — the same answer on Mac and iPhone.

export type PolicyAction =
  | 'local-scripture'        // bundled texts, lexicon, cross-references
  | 'verse-note-metadata'    // verse-linked notes as a ranking/discovery signal, locally
  | 'note-content-local'     // a note's text sent to the LOCAL model (tab context, note asks)
  | 'standalone-notes'       // searching standalone (non-verse) notes during general research
  | 'web-search'             // a public web search / page fetch
  | 'cloud-question'         // sending the question to a BYO-key cloud model
  | 'cloud-private-context'  // sending notes / conversation / profile instructions to a cloud model
  | 'log-content'            // persisting prompts, notes or keys in logs

export interface PermissionSettings {
  /** Online research: off (never), ask (each time), auto (allowed for public queries). */
  web: 'off' | 'ask' | 'auto'
  /** A BYO-key cloud model is configured and enabled. */
  cloudEnabled: boolean
  /** Separate, explicit consent to send private context to the cloud. */
  cloudPrivateContext: boolean
  /** Profile: search standalone notes during research. */
  useStandaloneNotes: boolean
  /** Profile: verse-linked notes as a discovery signal. */
  useVerseNotes: boolean
}

export const DEFAULT_PERMISSIONS: PermissionSettings = {
  web: 'off', cloudEnabled: false, cloudPrivateContext: false, useStandaloneNotes: false, useVerseNotes: true,
}

export interface PolicyContext {
  /** The content is from a note (or folder) marked "Exclude from AI". */
  excluded?: boolean
  /** The user explicitly asked for this (e.g. "what notes have I written about…"). */
  explicitRequest?: boolean
  /** The device is offline. */
  offline?: boolean
}

export type PolicyDecision =
  | { allowed: true; disclose?: string }
  | { allowed: false; needsConsent: boolean; reason: string }

const deny = (reason: string, needsConsent = false): PolicyDecision => ({ allowed: false, needsConsent, reason })

export function decide(action: PolicyAction, s: PermissionSettings, ctx: PolicyContext = {}): PolicyDecision {
  if (ctx.excluded && action !== 'local-scripture') return deny('This note is excluded from AI.')
  switch (action) {
    case 'local-scripture':
      return { allowed: true }
    case 'verse-note-metadata':
      return s.useVerseNotes ? { allowed: true } : deny('Verse notes are turned off for this profile.')
    case 'note-content-local':
      return { allowed: true, disclose: 'Uses your note on this device only.' }
    case 'standalone-notes':
      return s.useStandaloneNotes || ctx.explicitRequest ? { allowed: true } : deny('Standalone notes are not searched during research for this profile.')
    case 'web-search':
      if (s.web === 'off') return deny('Online research is off.')
      if (ctx.offline) return deny('You are offline.')
      if (s.web === 'ask' && !ctx.explicitRequest) return deny('Online research needs your OK for this question.', true)
      return { allowed: true, disclose: 'Sends only the search words to the web search provider — never your notes or conversation.' }
    case 'cloud-question':
      if (!s.cloudEnabled) return deny('No cloud model is enabled.')
      if (ctx.offline) return deny('You are offline.')
      return { allowed: true, disclose: 'Sends your question and the verses found to your cloud provider, billed to your key.' }
    case 'cloud-private-context':
      if (!s.cloudEnabled) return deny('No cloud model is enabled.')
      return s.cloudPrivateContext ? { allowed: true, disclose: 'Also sends the notes and conversation used for this answer.' } : deny('Private context is never sent to a cloud model without your separate consent.', true)
    case 'log-content':
      return deny('Prompts, notes and keys are never written to logs.')
  }
}
