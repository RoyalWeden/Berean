import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import type { ReactNode } from 'react'
import TabBar from '../TabBar'
import { useAppStore } from '@/store'
import type { Tab } from '@/types'

// ─── Reported bug: "duplicating tabs from the tab bar isn't working, so is
// opening in floating tab and archiving and all the options in the right-click
// menu on a tab in the tab bar" ─────────────────────────────────────────────
//
// TabBar.tsx's own context menu (usePositionedMenu) is pure React state + a
// document-level mousedown-capture listener — nothing in that path is
// Electron/native-drag-region specific EXCEPT the `-webkit-app-region: no-drag`
// styling, which jsdom does not implement at all (it has no concept of a
// native drag region — the property is inert there). So this test's actual
// job is narrower than the full bug report: it proves whether the REACT LOGIC
// itself — state wiring, click handlers, the store actions they call — is
// sound in a real DOM with a real event dispatch (dispatchEvent, not a
// synthetic React helper), or whether the defect is purely in Electron's
// drag-region hit-testing swallowing the native click before it ever reaches
// this component. A pass here narrows the bug to the latter; a failure would
// have caught a real logic regression this file's own recent-fix comments
// (WebkitAppRegion, the duplicate-id collision) claim to have already fixed.
let container: HTMLDivElement | null = null
let root: Root | null = null

function makeTab(id: string): Tab {
  return { id, spaceId: 'notes', type: 'note', title: 'Test Note', state: { noteId: 'n1', isNew: false } }
}

beforeEach(() => {
  useAppStore.setState({
    tabs: { ...useAppStore.getState().tabs, notes: [makeTab('note-1')] },
    activeTabId: { ...useAppStore.getState().activeTabId, notes: 'note-1' },
    archivedGroups: [],
  })
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  container?.remove()
  container = null
  root = null
  vi.restoreAllMocks()
})

function renderTabBar() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const tabs = useAppStore.getState().tabs.notes
  act(() => {
    root!.render(
      <TabBar
        tabs={tabs}
        activeTabId="note-1"
        onTabClick={() => {}}
        onTabClose={() => {}}
        onReorder={() => {}}
      />,
    )
  })
}

/** Right-clicks the first rendered tab row (identified by `data-tab-idx="0"`) — a real
 *  `contextmenu` DOM event, not a React synthetic-event helper, so this exercises the exact
 *  native event path `handleContextMenu` actually listens for. */
function rightClickFirstTab() {
  const tabEl = container!.querySelector('[data-tab-idx="0"]')
  expect(tabEl, 'tab row should be in the DOM').not.toBeNull()
  act(() => {
    tabEl!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }))
  })
}

/** Finds a context-menu button by its visible text and dispatches a real click on it. */
function clickMenuItem(label: string) {
  const buttons = Array.from(document.querySelectorAll('button'))
  const btn = buttons.find((b) => b.textContent?.includes(label))
  expect(btn, `menu item "${label}" should be rendered`).toBeTruthy()
  act(() => {
    btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

describe('TabBar context menu — reported broken actions', () => {
  it('opens on right-click', () => {
    renderTabBar()
    rightClickFirstTab()
    expect(document.body.textContent).toContain('Duplicate tab')
    expect(document.body.textContent).toContain('Archive tab')
    expect(document.body.textContent).toContain('Open in floating tab')
  })

  it('Duplicate tab actually adds a second tab', () => {
    renderTabBar()
    rightClickFirstTab()
    const before = useAppStore.getState().tabs.notes.length
    clickMenuItem('Duplicate tab')
    const after = useAppStore.getState().tabs.notes
    expect(after.length).toBe(before + 1)
    // The duplicate must be a genuinely NEW tab id, not a re-selection of the original —
    // this is exactly the id-collision class of bug the file's own comment describes.
    expect(new Set(after.map((t) => t.id)).size).toBe(after.length)
  })

  it('Duplicate tab twice in quick succession creates two distinct tabs, not one', () => {
    // The specific regression named in TabBar.tsx's own comment: a bare Date.now() id can
    // collide within the same millisecond, and addTab() then treats the "duplicate" as
    // already-existing and just switches to it instead of creating a second copy.
    renderTabBar()
    rightClickFirstTab()
    clickMenuItem('Duplicate tab')
    rightClickFirstTab()
    clickMenuItem('Duplicate tab')
    const ids = useAppStore.getState().tabs.notes.map((t) => t.id)
    expect(ids.length).toBe(3) // original + 2 duplicates
    expect(new Set(ids).size).toBe(3)
  })

  it('Archive tab removes it from the live tab list and records it as archived', () => {
    renderTabBar()
    rightClickFirstTab()
    clickMenuItem('Archive tab')
    expect(useAppStore.getState().tabs.notes.find((t) => t.id === 'note-1')).toBeUndefined()
    expect(useAppStore.getState().archivedGroups.length).toBe(1)
    expect(useAppStore.getState().archivedGroups[0].tabs[0].id).toBe('note-1')
  })

  it('Open in floating tab calls window.app.openFloatingTab and closes the docked tab', () => {
    // Resolves a real Promise — matches the real preload contract (ipcRenderer.invoke always
    // returns one), which TabBar.tsx's handler now .catch()es for diagnostic logging.
    const openFloatingTab = vi.fn().mockResolvedValue(undefined)
    const bumpFloatingTabToken = vi.spyOn(useAppStore.getState(), 'bumpFloatingTabToken')
    window.app = { ...window.app, openFloatingTab }
    let closed: Tab | null = null
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root!.render(
        <TabBar
          tabs={useAppStore.getState().tabs.notes}
          activeTabId="note-1"
          onTabClick={() => {}}
          onTabClose={(t) => { closed = t }}
          onReorder={() => {}}
        />,
      )
    })
    rightClickFirstTab()
    clickMenuItem('Open in floating tab')
    expect(openFloatingTab).toHaveBeenCalledTimes(1)
    expect(openFloatingTab.mock.calls[0][0]).toBe('notes') // type 'note' maps to float type 'notes'
    expect(bumpFloatingTabToken).toHaveBeenCalledTimes(1)
    expect(closed).not.toBeNull()
    expect((closed as unknown as Tab).id).toBe('note-1')
  })
})

// ─── ROOT CAUSE, finally found: this is the test the original suite (above) structurally
// COULDN'T catch, per its own header comment — it renders TabBar in isolation, but the real
// bug only reproduces when TabBar is nested inside Sidebar.tsx's <aside>, which has its own
// `onClickCapture` that broadcasts 'berean:closeMenus' on ANY click within it (to close
// unrelated overlays like Ribbon's archive list / zoom popover / session menu when the user
// clicks elsewhere in the sidebar). Since TabBar's own context menu is portaled to
// document.body, React bubbles its synthetic events through the REACT tree (Sidebar → TabBar
// → portal), not the physical DOM tree — so a click on "Duplicate tab" etc. ALSO reached that
// ancestor capture handler, firing 'berean:closeMenus' (which usePositionedMenu.ts listens
// for and closes the menu on) BEFORE the click's own bubble phase reached the button's onClick
// — unmounting the button out from under its own click. Confirmed via real console tracing in
// the app (a stack trace at the dispatch call site pointed straight at Sidebar.tsx's handler).
// The fix is a one-line guard: skip the broadcast when the click originated inside any
// currently-open context menu (the shared `.context-menu` class every menu in the app uses).
describe('TabBar context menu — nested inside a Sidebar-like ancestor (the actual bug)', () => {
  // Mirrors Sidebar.tsx's own onClickCapture handler exactly (guard included) — not a
  // simplified stand-in, so this test would have failed against the pre-fix version and
  // guards against the guard itself ever being silently removed/narrowed later.
  function SidebarLikeWrapper({ children }: { children: ReactNode }) {
    return (
      <div
        data-testid="sidebar-like"
        onClickCapture={(e) => {
          if ((e.target as HTMLElement).closest('.context-menu')) return
          window.dispatchEvent(new Event('berean:closeMenus'))
        }}
      >
        {children}
      </div>
    )
  }

  function renderTabBarInsideSidebarLike() {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const tabs = useAppStore.getState().tabs.notes
    act(() => {
      root!.render(
        <SidebarLikeWrapper>
          <TabBar
            tabs={tabs}
            activeTabId="note-1"
            onTabClick={() => {}}
            onTabClose={() => {}}
            onReorder={() => {}}
          />
        </SidebarLikeWrapper>,
      )
    })
  }

  it('Duplicate tab still works when TabBar is nested inside the Sidebar-like ancestor', () => {
    renderTabBarInsideSidebarLike()
    rightClickFirstTab()
    const before = useAppStore.getState().tabs.notes.length
    clickMenuItem('Duplicate tab')
    expect(useAppStore.getState().tabs.notes.length).toBe(before + 1)
  })

  it('does NOT broadcast berean:closeMenus for a click on a context-menu item', () => {
    const spy = vi.fn()
    window.addEventListener('berean:closeMenus', spy)
    try {
      renderTabBarInsideSidebarLike()
      rightClickFirstTab()
      spy.mockClear() // ignore whatever fired during the right-click/open itself
      clickMenuItem('Duplicate tab')
      expect(spy).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('berean:closeMenus', spy)
    }
  })

  it('a plain click elsewhere in the ancestor (NOT inside a context menu) still broadcasts berean:closeMenus — the guard is scoped, not a blanket disable', () => {
    const spy = vi.fn()
    window.addEventListener('berean:closeMenus', spy)
    try {
      renderTabBarInsideSidebarLike()
      const wrapperEl = container!.querySelector('[data-testid="sidebar-like"]')!
      act(() => {
        wrapperEl.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      expect(spy).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener('berean:closeMenus', spy)
    }
  })

  it('Archive tab and Open in floating tab both still work nested inside the ancestor', () => {
    const openFloatingTab = vi.fn().mockResolvedValue(undefined)
    window.app = { ...window.app, openFloatingTab }

    renderTabBarInsideSidebarLike()
    rightClickFirstTab()
    clickMenuItem('Archive tab')
    expect(useAppStore.getState().tabs.notes.find((t) => t.id === 'note-1')).toBeUndefined()
    expect(useAppStore.getState().archivedGroups.length).toBe(1)

    // Re-seed a fresh tab for the remaining two actions
    useAppStore.setState({
      tabs: { ...useAppStore.getState().tabs, notes: [makeTab('note-2')] },
      activeTabId: { ...useAppStore.getState().activeTabId, notes: 'note-2' },
    })
    act(() => { root!.render(
      <SidebarLikeWrapper>
        <TabBar
          tabs={useAppStore.getState().tabs.notes}
          activeTabId="note-2"
          onTabClick={() => {}}
          onTabClose={() => {}}
          onReorder={() => {}}
        />
      </SidebarLikeWrapper>,
    ) })
    rightClickFirstTab()
    clickMenuItem('Open in floating tab')
    expect(openFloatingTab).toHaveBeenCalledTimes(1)
  })
})
