/**
 * TEST 2026-10-01 (desktop "menu buttons sometimes disappear"): ⌘⇧U / View → Focus Mode / the
 * palette toggled Focus mode for ANY active tab, which hides the whole top bar, sidebar and rail —
 * on a Scripture / Search / YouTube tab there was no visible way back. Focus mode is now a note
 * writing mode only, and the one predicate that hides chrome requires the active tab to be a note.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore, noteFocusModeActive } from '@/store'
import type { Tab } from '@/types'

const tab = (id: string, type: string, spaceId: string): Tab => ({ id, spaceId, type, title: id, state: {} } as unknown as Tab)

beforeEach(() => {
  const s = useAppStore.getState()
  useAppStore.setState({
    tabs: { ...s.tabs, scripture: [tab('bible-1', 'bible', 'scripture')], notes: [tab('note-1', 'note', 'notes')] },
    activeTabId: { ...s.activeTabId, scripture: 'bible-1', notes: 'note-1' },
    activeSpace: 'scripture',
    noteFocusModeTabId: null,
  })
})

describe('note Focus mode', () => {
  it('cannot be turned on for a Scripture tab (the toolbar never disappears there)', () => {
    useAppStore.getState().toggleNoteFocusMode('bible-1')
    expect(useAppStore.getState().noteFocusModeTabId).toBeNull()
    expect(noteFocusModeActive(useAppStore.getState())).toBe(false)
  })

  it('hides chrome only while the focused NOTE tab is the active tab', () => {
    useAppStore.setState({ activeSpace: 'notes' })
    useAppStore.getState().toggleNoteFocusMode('note-1')
    expect(noteFocusModeActive(useAppStore.getState())).toBe(true)
    useAppStore.setState({ activeSpace: 'scripture' }) // tab / space change
    expect(noteFocusModeActive(useAppStore.getState())).toBe(false)
    useAppStore.setState({ activeSpace: 'notes' }) // back to the note
    expect(noteFocusModeActive(useAppStore.getState())).toBe(true)
  })

  it('a stale id on a tab that is no longer a note never hides chrome', () => {
    useAppStore.setState({ noteFocusModeTabId: 'bible-1', activeSpace: 'scripture' })
    expect(noteFocusModeActive(useAppStore.getState())).toBe(false)
  })

  it('toggle off and exit always work', () => {
    useAppStore.setState({ activeSpace: 'notes' })
    useAppStore.getState().toggleNoteFocusMode('note-1')
    useAppStore.getState().toggleNoteFocusMode('note-1')
    expect(useAppStore.getState().noteFocusModeTabId).toBeNull()
    useAppStore.getState().toggleNoteFocusMode('note-1')
    useAppStore.getState().exitNoteFocusMode()
    expect(noteFocusModeActive(useAppStore.getState())).toBe(false)
  })
})
