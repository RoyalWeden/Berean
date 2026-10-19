import { useRef, useState, useCallback } from 'react'
import { Copy, Hash, BookOpen, ExternalLink, PictureInPicture2 } from 'lucide-react'
import { copyVerse, copyVerseRef } from '@/lib/verseClipboard'
import { useAppStore } from '@/store'
import { recordNavigation } from '@/lib/verseNavigation'
import { getTranslationForBook } from '@/lib/parseRef'
import { MenuPositioner, dispatchCloseContextMenus, useMenuDismiss } from '@/lib/usePositionedMenu'
import { MenuSurface, MenuItem, MenuSeparator } from '@/components/ui'

export interface VerseCopyTarget {
  bookId: string
  chapter: number
  verse: number
  /** End of a verse range, when greater than `verse` — e.g. from AI Lookup's multi-verse
   *  results. Copy actions render "verse-endVerse"; open actions still just jump to `verse`. */
  endVerse?: number
  text: string
  lxx?: boolean
  x: number
  y: number
}

/**
 * Lightweight right-click "Copy verse / Copy reference" menu for any scripture list
 * (search results, cross-refs, lexicon occurrences). Pair with `useVerseCopyMenu`.
 */
export function VerseCopyMenu({ target, onClose }: { target: VerseCopyTarget | null; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  // Shared dismissal (outside mousedown / Escape / wheel / resize / blur / another menu opening)
  // and MenuPositioner placement (portal to <body>, measure, flip, clamp) — TEST 2026-10-17.
  useMenuDismiss(!!target, [ref], () => onClose(), { closeOnScroll: false })

  if (!target) return null

  function openVerse() {
    const store = useAppStore.getState()
    const tabId = store.activeTabId['scripture']
    const dedicatedTarget = getTranslationForBook(target!.bookId)
    if (tabId) {
      store.updateTabState('scripture', tabId, {
        bookId: target!.bookId, chapter: target!.chapter, targetVerse: target!.verse, endVerse: target!.endVerse, scrollPosition: 0,
        ...(dedicatedTarget ? { translation: dedicatedTarget } : {}),
      })
    } else {
      store.createTab('bible')
      const newTabId = useAppStore.getState().activeTabId['scripture']!
      store.updateTabState('scripture', newTabId, {
        bookId: target!.bookId, chapter: target!.chapter, targetVerse: target!.verse, endVerse: target!.endVerse, scrollPosition: 0,
        ...(dedicatedTarget ? { translation: dedicatedTarget } : {}),
      })
    }
    store.setActiveSpace('scripture')
  }

  function openInNewTab() {
    const store = useAppStore.getState()
    store.createTab('bible')
    const newTabId = useAppStore.getState().activeTabId['scripture']!
    const dedicatedTarget = getTranslationForBook(target!.bookId)
    store.updateTabState('scripture', newTabId, {
      bookId: target!.bookId, chapter: target!.chapter, targetVerse: target!.verse, endVerse: target!.endVerse, scrollPosition: 0,
      ...(dedicatedTarget ? { translation: dedicatedTarget } : {}),
    })
    store.setActiveSpace('scripture')
    // This context menu doesn't carry "where the user right-clicked FROM" (it's shared across
    // several hosts — search results, chapter view, etc.) — an empty `from` is the honest
    // signal (recordNavigation/tierForOrigin handle it fine), still worth recording the
    // destination and origin kind rather than silently bypassing entirely.
    recordNavigation({}, { bookId: target!.bookId, chapter: target!.chapter, verse: target!.verse }, { kind: 'other', label: 'verse-copy-menu' })
  }

  function openInFloatingTab() {
    recordNavigation({}, { bookId: target!.bookId, chapter: target!.chapter, verse: target!.verse }, { kind: 'other', label: 'verse-copy-menu' })
    window.app.openFloatingTab('bible', {
      bookId: target!.bookId, chapter: String(target!.chapter), targetVerse: String(target!.verse),
      ...(target!.endVerse ? { endVerse: String(target!.endVerse) } : {}),
    })
    useAppStore.getState().bumpFloatingTabToken()
  }

  return (
    <MenuPositioner ref={ref} x={target.x} y={target.y} onClick={(e) => e.stopPropagation()}>
      <MenuSurface className="min-w-[184px] max-w-[260px]">
        <MenuItem icon={BookOpen} label="Open verse" onClick={() => { openVerse(); onClose() }} />
        <MenuItem icon={ExternalLink} label="Open in new tab" onClick={() => { openInNewTab(); onClose() }} />
        <MenuItem icon={PictureInPicture2} label="Open in floating tab" onClick={() => { openInFloatingTab(); onClose() }} />
        <MenuSeparator />
        <MenuItem
          icon={Copy}
          label={target.endVerse && target.endVerse > target.verse ? 'Copy verses' : 'Copy verse'}
          onClick={() => { copyVerse(target.bookId, target.chapter, target.verse, target.text, target.lxx, target.endVerse); onClose() }}
        />
        <MenuItem icon={Hash} label="Copy reference" onClick={() => { copyVerseRef(target.bookId, target.chapter, target.verse, target.lxx, target.endVerse); onClose() }} />
      </MenuSurface>
    </MenuPositioner>
  )
}

/** Hook that manages the menu target + an onContextMenu handler factory. */
export function useVerseCopyMenu() {
  const [target, setTarget] = useState<VerseCopyTarget | null>(null)
  const open = useCallback((e: React.MouseEvent, v: { bookId: string; chapter: number; verse: number; endVerse?: number; text: string; lxx?: boolean }) => {
    e.preventDefault()
    e.stopPropagation()
    dispatchCloseContextMenus()
    setTarget({ ...v, x: e.clientX, y: e.clientY })
  }, [])
  const close = useCallback(() => setTarget(null), [])
  return { target, open, close }
}
