import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from '@/store'
import type { ArchivedGroup } from '@/store'

function makeGroup(id: string): ArchivedGroup {
  return { id, label: `Group ${id}`, archivedAt: Date.now(), tabs: [] }
}

describe('clearAllArchivedGroups (SessionsSection / TopBar bulk cleanup)', () => {
  beforeEach(() => {
    useAppStore.setState({ archivedGroups: [makeGroup('a'), makeGroup('b'), makeGroup('c')] })
  })

  it('empties archivedGroups entirely', () => {
    expect(useAppStore.getState().archivedGroups).toHaveLength(3)
    useAppStore.getState().clearAllArchivedGroups()
    expect(useAppStore.getState().archivedGroups).toHaveLength(0)
  })

  it('is a no-op-safe call when already empty', () => {
    useAppStore.setState({ archivedGroups: [] })
    useAppStore.getState().clearAllArchivedGroups()
    expect(useAppStore.getState().archivedGroups).toEqual([])
  })
})
