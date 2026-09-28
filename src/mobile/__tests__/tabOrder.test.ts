import { describe, it, expect } from 'vitest'
import { moveInOrder, workspaceOrder } from '../tabs/tabOrder'

describe('tab card order (T23-008)', () => {
  it('follows the stored display order, drops closed tabs, appends new ones', () => {
    expect(workspaceOrder(['c', 'x', 'a'], ['a', 'b', 'c'])).toEqual(['c', 'a', 'b'])
    expect(workspaceOrder([], ['a', 'b'])).toEqual(['a', 'b'])
  })
  it('moves a dragged card to its new slot', () => {
    expect(moveInOrder(['a', 'b', 'c', 'd'], 'a', 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveInOrder(['a', 'b', 'c', 'd'], 'd', 0)).toEqual(['d', 'a', 'b', 'c'])
    expect(moveInOrder(['a', 'b'], 'z', 0)).toEqual(['a', 'b'])
  })
})
