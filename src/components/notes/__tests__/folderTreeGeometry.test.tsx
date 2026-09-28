/** SEP26-NOTES-MAC-001…003 — folder-tree hierarchy geometry and hover actions that never cover the count. */
import { describe, it, expect, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { TREE_STEP, treeIconX, userFolderIndent, virtualFolderIndent, noteIndent } from '../folderTreeGeometry'
import { ListRow } from '@/components/ui/ListRow'

// Where each row type actually draws its icon (see folderTreeGeometry.ts).
const userFolderIcon = (d: number) => 32 + userFolderIndent(d)
const virtualFolderIcon = (d: number) => virtualFolderIndent(d) + 18
const noteIcon = (d: number) => noteIndent(d)

describe('folder tree geometry', () => {
  it('a note inside a folder sits one clear step to the right of the folder icon', () => {
    for (let d = 0; d < 4; d++) {
      expect(noteIcon(d + 1) - userFolderIcon(d)).toBe(TREE_STEP)
      expect(noteIcon(d + 1) - virtualFolderIcon(d)).toBe(TREE_STEP)
      expect(TREE_STEP).toBeGreaterThanOrEqual(16)
    }
  })
  it('every row type puts its icon on the same column for the same depth (subfolder ↔ sibling note align)', () => {
    for (let d = 0; d < 4; d++) {
      expect(userFolderIcon(d)).toBe(treeIconX(d))
      expect(virtualFolderIcon(d)).toBe(treeIconX(d))
      expect(noteIcon(d)).toBe(treeIconX(d))
    }
  })
  it('each nesting level adds the same increment', () => {
    expect(treeIconX(2) - treeIconX(1)).toBe(treeIconX(1) - treeIconX(0))
  })
})

describe('ListRow hover actions', () => {
  let root: Root | null = null
  let el: HTMLDivElement | null = null
  afterEach(() => { if (root) act(() => root!.unmount()); el?.remove() })
  it('are laid out in the row (not overlaid), after the meta, and the title truncates', () => {
    el = document.createElement('div'); document.body.appendChild(el)
    root = createRoot(el)
    act(() => root!.render(<ListRow title="A very long folder name that must truncate before the count" meta={12} trailing={<><button>a</button><button>b</button><button>c</button></>} />))
    const row = el.firstElementChild as HTMLElement
    const actions = row.lastElementChild as HTMLElement
    expect(actions.className).not.toMatch(/\babsolute\b/)
    expect(actions.className).toMatch(/max-w-0/)
    expect(actions.className).toMatch(/group-hover\/row:max-w-\[60%\]/)
    const button = row.querySelector('button')!
    expect(button.textContent).toContain('12')
    expect(button.querySelector('.truncate')?.textContent).toContain('A very long folder name')
  })
})
