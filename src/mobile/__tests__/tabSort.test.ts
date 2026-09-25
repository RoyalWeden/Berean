/** SEP25 TAB-SORT: the tab cards' "Recent | Custom" ordering. */
import { describe, it, expect } from 'vitest'
import { recentOrder, displayedOrder, applyManualReorder, type TabSortMode } from '../tabs/tabSort'
import { moveInOrder } from '../tabs/tabOrder'

const custom = ['a', 'b', 'c', 'd']
const mru = ['c', 'x', 'a'] // most recent first; 'x' is a tab of another session / closed

describe('tab cards sort', () => {
  it('Recent: most recently used first, unused tabs after in custom order, foreign ids ignored', () => {
    expect(recentOrder(custom, mru)).toEqual(['c', 'a', 'b', 'd'])
    expect(recentOrder(custom, [])).toEqual(custom)
    expect(displayedOrder('recent', custom, mru)).toEqual(['c', 'a', 'b', 'd'])
  })
  it('Custom: exactly the stored manual order', () => {
    expect(displayedOrder('custom', custom, mru)).toEqual(custom)
  })
  it('a drag while Recent is shown switches to Custom and saves the dragged order, overwriting the old custom order', () => {
    const shown = displayedOrder('recent', custom, mru) // c a b d
    const dragged = moveInOrder(shown, 'd', 1)          // c d a b
    const r = applyManualReorder(dragged)
    expect(r).toEqual({ mode: 'custom', customOrder: ['c', 'd', 'a', 'b'] })
    expect(displayedOrder(r.mode, r.customOrder, mru)).toEqual(['c', 'd', 'a', 'b'])
  })
  it('switching modes never changes the stored custom order (Custom → Recent → Custom restores it); deterministic', () => {
    let mode: TabSortMode = 'custom'
    const stored = ['d', 'b', 'a', 'c']
    mode = 'recent'
    expect(displayedOrder(mode, stored, mru)).toEqual(['c', 'a', 'd', 'b'])
    mode = 'custom'
    expect(displayedOrder(mode, stored, mru)).toEqual(stored)
    expect(displayedOrder('recent', stored, mru)).toEqual(displayedOrder('recent', stored, mru))
  })
  it('a reorder in Custom stays Custom', () => {
    expect(applyManualReorder(moveInOrder(custom, 'a', 3))).toEqual({ mode: 'custom', customOrder: ['b', 'c', 'd', 'a'] })
  })
})
