import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Copy, Hash, BookOpen, ExternalLink } from 'lucide-react'
import { copyVerse, copyVerseRef } from '@/lib/verseClipboard'
import { useAppStore } from '@/store'
import { getTranslationForBook } from '@/lib/parseRef'
import { CLOSE_CONTEXT_MENUS_EVENT, dispatchCloseContextMenus } from '@/lib/usePositionedMenu'

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
  useEffect(() => {
    if (!target) return
    const close = () => onClose()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    // Defer so the opening right-click doesn't immediately close it.
    // Close when any OTHER context menu opens (or a right-click hits empty space).
    window.addEventListener(CLOSE_CONTEXT_MENUS_EVENT, close)
    const t = setTimeout(() => {
      window.addEventListener('click', close)
      window.addEventListener('contextmenu', close)
      window.addEventListener('keydown', onKey)
    }, 0)
    return () => {
      clearTimeout(t)
      window.removeEventListener(CLOSE_CONTEXT_MENUS_EVENT, close)
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [target, onClose])

  // Clamp to viewport after first render so it never overflows in floating windows.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const pad = 8
    const vw = window.innerWidth
    const vh = window.innerHeight
    let x = parseFloat(el.style.left) || 0
    let y = parseFloat(el.style.top) || 0
    if (x + width + pad > vw) x = Math.max(pad, x - width)
    if (y + height + pad > vh) y = Math.max(pad, y - height)
    x = Math.max(pad, Math.min(x, vw - width - pad))
    y = Math.max(pad, Math.min(y, vh - height - pad))
    el.style.left = `${x}px`
    el.style.top = `${y}px`
  })

  if (!target) return null
  const ITEM = 'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left cursor-pointer text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-3))] transition-colors'
  const ICON = 'flex-shrink-0 text-[rgb(var(--color-text-muted))]'

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
  }

  function openInFloatingTab() {
    window.app.openFloatingTab('bible', {
      bookId: target!.bookId, chapter: String(target!.chapter), targetVerse: String(target!.verse),
      ...(target!.endVerse ? { endVerse: String(target!.endVerse) } : {}),
    })
    useAppStore.getState().bumpFloatingTabToken()
  }

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[10000] min-w-[150px] rounded-shell context-menu overflow-hidden py-1"
      style={{ left: target.x, top: target.y }}
      onClick={(e) => e.stopPropagation()}
    >
      <button className={ITEM} onClick={() => { openVerse(); onClose() }}>
        <BookOpen size={12} className={ICON} /> Open verse
      </button>
      <button className={ITEM} onClick={() => { copyVerse(target.bookId, target.chapter, target.verse, target.text, target.lxx, target.endVerse); onClose() }}>
        <Copy size={12} className={ICON} /> {target.endVerse && target.endVerse > target.verse ? 'Copy verses' : 'Copy verse'}
      </button>
      <button className={ITEM} onClick={() => { copyVerseRef(target.bookId, target.chapter, target.verse, target.lxx, target.endVerse); onClose() }}>
        <Hash size={12} className={ICON} /> Copy reference
      </button>
      <button className={ITEM} onClick={() => { openInNewTab(); onClose() }}>
        <ExternalLink size={12} className={ICON} /> Open in new tab
      </button>
      <button className={ITEM} onClick={() => { openInFloatingTab(); onClose() }}>
        <ExternalLink size={12} className={ICON} /> Open in floating tab
      </button>
    </div>,
    document.body,
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
