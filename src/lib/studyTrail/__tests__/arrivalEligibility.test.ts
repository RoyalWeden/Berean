import { describe, it, expect } from 'vitest'
import {
  arrivalPromptEligibility,
  computeArrivalPlacement,
  navOriginKindToArrivalKind,
  ARRIVAL_PROMPT_MAX_AGE_MS,
  type ArrivalEligibilityContext,
} from '../arrivalEligibility'

const NOW = 1_000_000

function baseCtx(overrides: Partial<ArrivalEligibilityContext> = {}): ArrivalEligibilityContext {
  return {
    navigationKind: 'cross-ref',
    userInitiated: true,
    surface: { space: 'scripture', tabType: 'bible' },
    fromRef: { bookId: 'MAT', chapter: 5 },
    toRef: { bookId: 'ISA', chapter: 52 },
    recordedAt: NOW - 1000,
    now: NOW,
    ...overrides,
  }
}

describe('arrivalPromptEligibility', () => {
  it('is eligible for a cross-reference jump landing on a Scripture reader tab', () => {
    expect(arrivalPromptEligibility(baseCtx()).eligible).toBe(true)
  })

  it('is eligible for a scripture search result', () => {
    expect(arrivalPromptEligibility(baseCtx({ navigationKind: 'search-result' })).eligible).toBe(true)
  })

  it('is eligible for a reference-link jump (note wikilink / verse popover)', () => {
    expect(arrivalPromptEligibility(baseCtx({ navigationKind: 'reference-link' })).eligible).toBe(true)
  })

  it('is eligible for other deliberate study navigation', () => {
    expect(arrivalPromptEligibility(baseCtx({ navigationKind: 'study-navigation' })).eligible).toBe(true)
  })

  it('rejects plain prev/next chapter reading', () => {
    const r = arrivalPromptEligibility(baseCtx({ navigationKind: 'sequential' }))
    expect(r.eligible).toBe(false)
    expect(r.reason).toMatch(/sequential/)
  })

  it('rejects a tab switch between already-open tabs', () => {
    expect(arrivalPromptEligibility(baseCtx({ navigationKind: 'tab-switch' })).eligible).toBe(false)
  })

  it('rejects History modal reopen / back-forward', () => {
    expect(arrivalPromptEligibility(baseCtx({ navigationKind: 'history' })).eligible).toBe(false)
  })

  it('rejects session/workspace restore', () => {
    expect(arrivalPromptEligibility(baseCtx({ navigationKind: 'restore', userInitiated: false })).eligible).toBe(false)
  })

  it('rejects any non-user-initiated (programmatic) navigation regardless of kind', () => {
    const r = arrivalPromptEligibility(baseCtx({ navigationKind: 'cross-ref', userInitiated: false }))
    expect(r.eligible).toBe(false)
    expect(r.reason).toMatch(/not user-initiated/)
  })

  it('rejects when a Notes tab is the active surface', () => {
    const r = arrivalPromptEligibility(baseCtx({ surface: { space: 'notes', tabType: 'note' } }))
    expect(r.eligible).toBe(false)
    expect(r.reason).toMatch(/Scripture reader/)
  })

  it('rejects when Settings is the active surface', () => {
    expect(arrivalPromptEligibility(baseCtx({ surface: { space: 'search', tabType: 'settings' } })).eligible).toBe(false)
  })

  it('rejects when a Search tab is the active surface', () => {
    expect(arrivalPromptEligibility(baseCtx({ surface: { space: 'search', tabType: 'search' } })).eligible).toBe(false)
  })

  it('rejects when a Lexicon tab is the active surface', () => {
    expect(arrivalPromptEligibility(baseCtx({ surface: { space: 'lexicon', tabType: 'lexicon' } })).eligible).toBe(false)
  })

  it('rejects when a non-bible tab is active within the Scripture space itself (e.g. a PDF tab)', () => {
    expect(arrivalPromptEligibility(baseCtx({ surface: { space: 'scripture', tabType: 'pdf' } })).eligible).toBe(false)
  })

  it('rejects a stale arrival past the max age window', () => {
    const r = arrivalPromptEligibility(baseCtx({ recordedAt: NOW - (ARRIVAL_PROMPT_MAX_AGE_MS + 1) }))
    expect(r.eligible).toBe(false)
    expect(r.reason).toMatch(/stale/)
  })

  it('is still eligible right at the edge of the max age window', () => {
    const r = arrivalPromptEligibility(baseCtx({ recordedAt: NOW - ARRIVAL_PROMPT_MAX_AGE_MS }))
    expect(r.eligible).toBe(true)
  })

  it('rejects a clock skew where recordedAt is in the future', () => {
    const r = arrivalPromptEligibility(baseCtx({ recordedAt: NOW + 1000 }))
    expect(r.eligible).toBe(false)
  })

  it('rejects when origin and destination are the same chapter', () => {
    const r = arrivalPromptEligibility(baseCtx({ toRef: { bookId: 'MAT', chapter: 5 } }))
    expect(r.eligible).toBe(false)
    expect(r.reason).toMatch(/same chapter/)
  })

  it('rejects when either ref failed to resolve (not a real Scripture reference)', () => {
    expect(arrivalPromptEligibility(baseCtx({ fromRef: null })).eligible).toBe(false)
    expect(arrivalPromptEligibility(baseCtx({ toRef: null })).eligible).toBe(false)
  })
})

describe('navOriginKindToArrivalKind', () => {
  it('maps cross-ref and search-result straight through', () => {
    expect(navOriginKindToArrivalKind('cross-ref')).toBe('cross-ref')
    expect(navOriginKindToArrivalKind('search-result')).toBe('search-result')
  })

  it('maps note-wikilink and verse-popover to reference-link', () => {
    expect(navOriginKindToArrivalKind('note-wikilink')).toBe('reference-link')
    expect(navOriginKindToArrivalKind('verse-popover')).toBe('reference-link')
  })

  it('maps book-chapter-picker, ai-lookup, lexicon-occurrence, compare-column to study-navigation', () => {
    expect(navOriginKindToArrivalKind('book-chapter-picker')).toBe('study-navigation')
    expect(navOriginKindToArrivalKind('ai-lookup')).toBe('study-navigation')
    expect(navOriginKindToArrivalKind('lexicon-occurrence')).toBe('study-navigation')
    expect(navOriginKindToArrivalKind('compare-column')).toBe('study-navigation')
  })

  it('maps sequential-nav, tab-switch, history-revisit to their ineligible kinds', () => {
    expect(navOriginKindToArrivalKind('sequential-nav')).toBe('sequential')
    expect(navOriginKindToArrivalKind('tab-switch')).toBe('tab-switch')
    expect(navOriginKindToArrivalKind('history-revisit')).toBe('history')
  })

  it('maps other to other', () => {
    expect(navOriginKindToArrivalKind('other')).toBe('other')
  })
})

describe('computeArrivalPlacement', () => {
  const basePlacement = {
    viewportWidth: 1400,
    viewportHeight: 900,
    pillWidth: 250,
    pillHeight: 160,
    rightPanelWidth: 0,
    bottomReservedHeight: 0,
    toolbarHeight: 44,
    minReadingColumnWidth: 320,
  }

  it('anchors bottom-trailing with margins when there is plenty of room', () => {
    const p = computeArrivalPlacement(basePlacement)
    expect(p).toEqual({ right: 16, bottom: 16 })
  })

  it('slides left to clear an open Scripture inspector panel', () => {
    const p = computeArrivalPlacement({ ...basePlacement, rightPanelWidth: 320 })
    expect(p).not.toBeNull()
    expect(p!.right).toBe(16 + 320 + 12)
  })

  it('stacks above other bottom-right floating UI via bottomReservedHeight', () => {
    const p = computeArrivalPlacement({ ...basePlacement, bottomReservedHeight: 80 })
    expect(p!.bottom).toBe(96)
  })

  it('suppresses the overlay when the viewport is too narrow to leave the reading column clear', () => {
    const p = computeArrivalPlacement({ ...basePlacement, viewportWidth: 500, rightPanelWidth: 320 })
    expect(p).toBeNull()
  })

  it('suppresses the overlay when there is no vertical room left above the toolbar/bottom UI', () => {
    const p = computeArrivalPlacement({ ...basePlacement, viewportHeight: 150, bottomReservedHeight: 100 })
    expect(p).toBeNull()
  })
})
