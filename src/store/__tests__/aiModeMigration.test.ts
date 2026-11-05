import { describe, it, expect } from 'vitest'
import { migrateAiModeState, AI_MODE_STORE_VERSION } from '../aiModeMigration'

describe('migrateAiModeState (store v8 → v9)', () => {
  it('moves the old default (Commentary on, Deep off) to the new default and flags the notice', () => {
    expect(migrateAiModeState({ aiLookupCommentaryOn: true, aiLookupAgenticOn: false }, 8))
      .toEqual({ aiLookupCommentaryOn: false, aiLookupAgenticOn: false, aiLookupModeNotice: true })
  })

  it('keeps every explicit choice, including legacy Commentary off + Deep on (spec §0.9)', () => {
    expect(migrateAiModeState({ aiLookupCommentaryOn: false, aiLookupAgenticOn: true }, 8)).toEqual({ aiLookupCommentaryOn: false, aiLookupAgenticOn: true })
    expect(migrateAiModeState({ aiLookupCommentaryOn: true, aiLookupAgenticOn: true }, 8)).toEqual({ aiLookupCommentaryOn: true, aiLookupAgenticOn: true })
    expect(migrateAiModeState({ aiLookupCommentaryOn: false, aiLookupAgenticOn: false }, 3)).toEqual({ aiLookupCommentaryOn: false, aiLookupAgenticOn: false })
  })

  it('leaves current-version state and unrelated fields alone', () => {
    const s = { aiLookupCommentaryOn: true, aiLookupAgenticOn: false, other: 1 }
    expect(migrateAiModeState(s, AI_MODE_STORE_VERSION)).toBe(s)
    expect(migrateAiModeState({ ...s }, 8)).toMatchObject({ other: 1 })
  })
})
