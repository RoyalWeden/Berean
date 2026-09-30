/** TEST 2026-09-29 — iPhone edge swipe: back through the tab's own history, else close the tab
 *  (the store then activates the most recently used tab), never close the only tab. */
import { describe, it, expect } from 'vitest'
import { edgeBackAction } from '../navigation/edgeBack'
import type { SpaceId, Tab } from '@/types'

const tab = (id: string, type: string): Tab => ({ id, spaceId: 'scripture', type, title: id, state: {} } as unknown as Tab)
const empty = { scripture: [], notes: [], lexicon: [], youtube: [], search: [] } as unknown as Record<SpaceId, Tab[]>
function state(over: { tabs?: Partial<Record<SpaceId, Tab[]>>; stacks?: Record<string, { stack: Array<{ type: string; home?: boolean }>; idx: number }>; space?: SpaceId; active?: string }) {
  return {
    activeSpace: over.space ?? ('scripture' as SpaceId),
    activeTabId: { scripture: null, notes: null, lexicon: null, youtube: null, search: null, [over.space ?? 'scripture']: over.active ?? 'a' } as unknown as Record<SpaceId, string | null>,
    tabs: { ...empty, ...over.tabs } as Record<SpaceId, Tab[]>,
    tabNavStacks: (over.stacks ?? {}) as never,
  }
}

describe('edgeBackAction', () => {
  it('goes back while the tab has earlier history', () => {
    expect(edgeBackAction(state({ tabs: { scripture: [tab('a', 'bible'), tab('b', 'bible')] }, stacks: { a: { stack: [{ type: 'bible' }, { type: 'bible' }], idx: 1 } } }))).toBe('history')
  })
  it('closes the tab at its first history step when other tabs exist', () => {
    expect(edgeBackAction(state({ tabs: { scripture: [tab('a', 'bible')], notes: [tab('n', 'note')] }, stacks: { a: { stack: [{ type: 'bible' }], idx: 0 } } }))).toBe('close')
  })
  it('a note tab can step back to its list (idx -1) before closing', () => {
    expect(edgeBackAction(state({ space: 'notes' as SpaceId, active: 'n', tabs: { notes: [tab('n', 'note')], scripture: [tab('a', 'bible')] }, stacks: { n: { stack: [{ type: 'note' }], idx: 0 } } }))).toBe('history')
  })
  it('never closes the only open tab', () => {
    expect(edgeBackAction(state({ tabs: { scripture: [tab('a', 'bible')] }, stacks: { a: { stack: [{ type: 'bible' }], idx: 0 } } }))).toBe('none')
  })
})
