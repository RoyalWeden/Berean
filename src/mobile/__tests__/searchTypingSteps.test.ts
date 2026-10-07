/** Search tab back/forward steps: one step per search, not one per typing pause (TEST 2026-10-03). */
import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from '@/store'
import { commitSearchStep, searchSnapshot, _resetSearchCommitted } from '../search/searchHistory'

const tab = 'search-typing-1'
const snap = (query: string) => searchSnapshot({ query, scope: 'all' })
const steps = () => (useAppStore.getState().tabNavStacks[tab]?.stack ?? []).map((s) => (s.state as { query?: string } | undefined)?.query)

beforeEach(() => {
  _resetSearchCommitted()
  useAppStore.setState({ tabNavStacks: {}, isNavJumping: false })
})

describe('search tab typing steps', () => {
  it('slow typing → one step for the final query', () => {
    let t = 1_000_000
    let prev = snap('')
    for (const q of ['go', 'good', 'good tiding', 'good tidings']) { commitSearchStep(tab, prev, snap(q), { now: (t += 1600) }); prev = snap(q) }
    expect(steps()).toEqual(['', 'good tidings'])
  })
  it('submitted searches are separate steps, and repeating a search later is its own step', () => {
    let t = 1_000_000
    commitSearchStep(tab, snap(''), snap('faith'), { submitted: true, now: (t += 100) })
    commitSearchStep(tab, snap('faith'), snap('grace'), { submitted: true, now: (t += 30_000) })
    commitSearchStep(tab, snap('grace'), snap('faith'), { submitted: true, now: (t += 30_000) })
    expect(steps()).toEqual(['', 'faith', 'grace', 'faith'])
  })
})
