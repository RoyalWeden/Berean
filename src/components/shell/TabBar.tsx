import { useRef, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, BookOpen, FileText, BookMarked, Youtube, Search, Trash2, Layers, GitCompare, ExternalLink, Copy, FileType2, Archive, type LucideIcon } from 'lucide-react'
import type { Tab, TabType, BibleTabState } from '@/types'
import { useAppStore } from '@/store'
import { usePositionedMenu } from '@/lib/usePositionedMenu'

const TAB_ICONS: Record<TabType, LucideIcon> = {
  bible:   BookOpen,
  note:    FileText,
  lexicon: BookMarked,
  youtube: Youtube,
  search:  Search,
  pdf:     FileType2,
}

interface ContextMenuState {
  tab: Tab
  x: number
  y: number
}

interface TabBarProps {
  tabs: Tab[]
  activeTabId: string | null
  onTabClick: (tab: Tab) => void
  onTabClose: (tab: Tab) => void
  // fromTabId / toTabId / before — the store owns the index math
  onReorder: (fromTabId: string, toTabId: string, insertBefore: boolean) => void
}

export default function TabBar({ tabs, activeTabId, onTabClick, onTabClose, onReorder }: TabBarProps) {
  const youtubeIsPlaying   = useAppStore((s) => s.youtubeIsPlaying)
  const activeYouTubeTabId = useAppStore((s) => s.activeTabId['youtube'])
  const sessions           = useAppStore((s) => s.sessions)
  const currentSessionId   = useAppStore((s) => s.currentSessionId)
  const moveTabToSession       = useAppStore((s) => s.moveTabToSession)
  const archiveTab             = useAppStore((s) => s.archiveTab)
  const archiveAllTabs         = useAppStore((s) => s.archiveAllTabs)
  const archivedGroups         = useAppStore((s) => s.archivedGroups)

  // Visual-only drag state (drives the insert-line indicator)
  const [draggingIdx,       setDraggingIdx]       = useState<number | null>(null)
  const [dragOverIdx,       setDragOverIdx]        = useState<number | null>(null)
  const [dragInsertBefore,  setDragInsertBefore]  = useState(true)
  const [crossSpaceHoverIdx, setCrossSpaceHoverIdx] = useState<number | null>(null)
  const { menu: contextMenu, menuRef, openMenu: openContextMenu, closeMenu: closeContextMenu } =
    usePositionedMenu<{ tab: Tab }>()

  // Only ref needed: which tab is being dragged (used in handleTabDragOver
  // to skip cross-space visual indicator, and in handleContainerDrop)
  const draggingIdxRef = useRef<number | null>(null)
  const draggingTabRef = useRef<Tab | null>(null)
  // Track whether cursor left the window during drag — for "drag off app → float" feature
  const leftWindowRef  = useRef(false)


  // Detect when the drag cursor leaves the browser window (for "drag off → float" feature)
  useEffect(() => {
    function onDragLeave(e: DragEvent) {
      if (e.relatedTarget === null) leftWindowRef.current = true
    }
    function onDragEnter() { leftWindowRef.current = false }
    document.addEventListener('dragleave', onDragLeave, { capture: true })
    document.addEventListener('dragenter', onDragEnter, { capture: true })
    return () => {
      document.removeEventListener('dragleave', onDragLeave, { capture: true })
      document.removeEventListener('dragenter', onDragEnter, { capture: true })
    }
  }, [])

  if (tabs.length === 0) {
    return <div className="px-3 py-2 text-xs text-[rgb(var(--color-text-muted))]">No open tabs</div>
  }

  // ── Drag handlers ──────────────────────────────────────────────────────

  function handleDragStart(e: React.DragEvent, idx: number) {
    draggingIdxRef.current = idx
    draggingTabRef.current = tabs[idx] ?? null
    leftWindowRef.current  = false
    setDraggingIdx(idx)
    e.dataTransfer.effectAllowed = 'move'
    // Stamp type/space on dataTransfer so cross-space drop targets can read it
    e.dataTransfer.setData('berean-tab-id',    tabs[idx]?.id    ?? '')
    e.dataTransfer.setData('berean-tab-type',  tabs[idx]?.type  ?? '')
    e.dataTransfer.setData('berean-tab-space', tabs[idx]?.spaceId ?? '')

    // Clone the real tab element as drag image so it looks identical
    const el   = e.currentTarget as HTMLElement
    const rect = el.getBoundingClientRect()
    const clone = el.cloneNode(true) as HTMLElement
    Object.assign(clone.style, {
      position:      'fixed',
      top:           '-9999px',
      left:          '0px',
      width:         `${rect.width}px`,
      height:        `${rect.height}px`,
      margin:        '0',
      pointerEvents: 'none',
      opacity:       '1',
      background:    getComputedStyle(el).backgroundColor,
      borderRadius:  getComputedStyle(el).borderRadius,
    })
    document.body.appendChild(clone)
    e.dataTransfer.setDragImage(clone, e.clientX - rect.left, e.clientY - rect.top)
    setTimeout(() => document.body.removeChild(clone), 0)
  }

  function handleTabDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'

    const draggedTab  = draggingTabRef.current
    const targetTab   = tabs[idx]
    const rect        = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const relY        = (e.clientY - rect.top) / rect.height

    // ── Note-item drag (from notes list / folder view, not a tab drag) ────────
    // dataTransfer.types is readable during dragover; getData is not.
    const isNoteItemDrag = !draggedTab && e.dataTransfer.types.includes('berean-note-id')
    if (isNoteItemDrag) {
      // Centre zone over a scripture tab → show side-panel merge indicator
      if (targetTab?.spaceId === 'scripture' && relY > 0.3 && relY < 0.7) {
        setCrossSpaceHoverIdx(idx)
        setDragOverIdx(null)
      } else {
        // Any other tab → generic "drop to open" highlight (no insert line)
        setCrossSpaceHoverIdx(null)
        setDragOverIdx(idx)
        setDragInsertBefore(false)
      }
      return
    }

    // ── Cross-space tab merge: only activate in the centre 40% ────────────────
    // Also catches youtube ↔ everything and everything → youtube
    if (draggedTab && targetTab && draggedTab.spaceId !== targetTab.spaceId) {
      // Allowed combine pairs
      const srcSpace = draggedTab.spaceId as string
      const tgtSpace = targetTab.spaceId as string
      const canCombine =
        (tgtSpace === 'scripture' && (srcSpace === 'notes' || srcSpace === 'lexicon')) ||
        tgtSpace === 'youtube' ||   // anything → youtube
        srcSpace === 'youtube' ||   // youtube → anything
        (srcSpace === 'scripture' && (tgtSpace === 'notes' || tgtSpace === 'lexicon' || tgtSpace === 'youtube'))
      if (canCombine && relY > 0.3 && relY < 0.7) {
        setCrossSpaceHoverIdx(idx)
        setDragOverIdx(null)
        return
      }
    }

    setCrossSpaceHoverIdx(null)
    const before = relY < 0.5
    setDragOverIdx(idx)
    setDragInsertBefore(before)
  }

  // Drop is handled on the container so it catches drops landing on any child
  // element (icon, text, close button). We snapshot the visual indicator state
  // BEFORE clearing it — used as fallback when cursor lands in the 2px gap
  // between tabs where elementFromPoint returns the container, not a tab div.
  function handleContainerDrop(e: React.DragEvent) {
    e.preventDefault()

    const fromIdx = draggingIdxRef.current
    draggingIdxRef.current = null
    setDraggingIdx(null)

    // Snapshot indicator state before clearing — gap fallback uses these
    const fallbackToIdx        = dragOverIdx
    const fallbackBefore       = dragInsertBefore
    const wasCrossSpaceHover   = crossSpaceHoverIdx !== null
    const wasCrossSpaceHoverIdx = crossSpaceHoverIdx   // ← snapshot index too for note drops
    setDragOverIdx(null)
    setCrossSpaceHoverIdx(null)

    // ── Cross-space drop: note/lexicon onto bible (or vice versa) ──────────
    // Only combine if the merge indicator was active at drop time (user released
    // in the center zone). If they dragged away from the target, wasCrossSpaceHover
    // is false and we fall through to normal same-space reorder logic.
    const crossId    = e.dataTransfer.getData('berean-tab-id')
    const crossType  = e.dataTransfer.getData('berean-tab-type')
    const crossSpace = e.dataTransfer.getData('berean-tab-space')
    const mySpace    = tabs[0]?.spaceId ?? ''
    if (crossId && crossSpace && crossSpace !== mySpace && wasCrossSpaceHover) {
      const store = useAppStore.getState()
      const draggedTab = store.tabs[crossSpace as keyof typeof store.tabs]?.find((t: Tab) => t.id === crossId)
      if (!draggedTab) return

      // Find the target tab (what was dropped on)
      let el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
      while (el && !el.dataset.tabIdx) el = el.parentElement as HTMLElement | null
      const targetTab = el ? tabs[parseInt(el.dataset.tabIdx!, 10)] : tabs[0]
      if (!targetTab) return

      // note → bible: open note in right panel of target bible tab
      if (crossType === 'note' && mySpace === 'scripture') {
        const noteId = (draggedTab.state as { noteId?: string | null }).noteId ?? null
        store.updateTabState('scripture', targetTab.id, {
          rightPanelOpen: true, rightPanelTab: 'notes',
          ...(noteId ? { rightPanelNoteId: noteId } : {}),
        })
        store.activateTab(targetTab)
        store.setActiveSpace('scripture')
        onTabClose(draggedTab)
        return
      }

      // lexicon → bible: open lexicon in right panel
      if (crossType === 'lexicon' && mySpace === 'scripture') {
        const sNum = (draggedTab.state as { strongsNum?: string | null }).strongsNum
        store.updateTabState('scripture', targetTab.id, { rightPanelOpen: true, rightPanelTab: 'lexicon' })
        if (sNum) store.openLexiconEntry(sNum)
        store.activateTab(targetTab)
        store.setActiveSpace('scripture')
        onTabClose(draggedTab)
        return
      }

      // bible → note or bible → lexicon: new scripture tab with right panel open
      if (crossType === 'bible' && (mySpace === 'notes' || mySpace === 'lexicon')) {
        const bState = draggedTab.state as unknown as Record<string, unknown>
        store.createTab('bible')
        const newId = useAppStore.getState().activeTabId['scripture']!
        const noteId = mySpace === 'notes'
          ? (targetTab.state as { noteId?: string | null }).noteId ?? null
          : null
        const sNum = mySpace === 'lexicon'
          ? (targetTab.state as { strongsNum?: string | null }).strongsNum ?? null
          : null
        store.updateTabState('scripture', newId, {
          ...bState,
          rightPanelOpen: true,
          rightPanelTab: mySpace === 'notes' ? 'notes' : 'lexicon',
          ...(noteId ? { rightPanelNoteId: noteId } : {}),
        })
        if (sNum) store.openLexiconEntry(sNum)
        store.setActiveSpace('scripture')
        onTabClose(draggedTab)
        onTabClose(targetTab)
        return
      }
      // ── X → YouTube: note/scripture/lexicon dropped on a YouTube tab ─────────
      if (mySpace === 'youtube') {
        if (!targetTab) return
        let panel: import('@/types').YouTubePanelState | null = null

        if (crossType === 'note') {
          const noteId = (draggedTab.state as { noteId?: string | null }).noteId ?? null
          panel = { type: 'notes', noteId }
        } else if (crossType === 'bible') {
          const bState = draggedTab.state as import('@/types').BibleTabState
          panel = {
            type: 'scripture',
            bookId: bState.bookId,
            chapter: bState.chapter,
            translation: bState.translation,
          }
        } else if (crossType === 'lexicon') {
          const sNum = (draggedTab.state as { strongsNum?: string | null }).strongsNum ?? null
          panel = { type: 'lexicon', strongsNum: sNum }
        }

        if (panel) {
          // Dispatch a custom event that YouTubeTab listens for
          window.dispatchEvent(new CustomEvent('berean:youtubeAddPanel', {
            detail: { tabId: targetTab.id, panel },
          }))
          store.activateTab(targetTab)
          store.setActiveSpace('youtube')
          onTabClose(draggedTab)
          return
        }
      }

      // ── YouTube → X: YouTube dropped on note/scripture/lexicon tab ────────────
      if (crossSpace === 'youtube') {
        const ytState = draggedTab.state as import('@/types').YouTubeTabState
        const videoId = ytState.videoId ?? null

        if (mySpace === 'scripture' && videoId) {
          // Open the video in a new YouTube tab, don't modify the scripture tab
          // (scripture tab currently can't host a YouTube secondary panel)
          const store = useAppStore.getState()
          store.addTab({
            id: `youtube-${videoId}-${Date.now()}`,
            spaceId: 'youtube',
            type: 'youtube',
            title: draggedTab.title,
            state: { videoId, playlistId: null },
          } as import('@/types').Tab)
          store.setActiveSpace('youtube')
          onTabClose(draggedTab)
          return
        }

        if (mySpace === 'notes' || mySpace === 'lexicon') {
          // Similar: open in new YouTube tab
          const store = useAppStore.getState()
          if (videoId) {
            store.addTab({
              id: `youtube-${videoId}-${Date.now()}`,
              spaceId: 'youtube',
              type: 'youtube',
              title: draggedTab.title,
              state: { videoId, playlistId: null },
            } as import('@/types').Tab)
            store.setActiveSpace('youtube')
            onTabClose(draggedTab)
          }
          return
        }
      }

      return  // unhandled cross-space combo — just ignore
    }

    // ── Note-item drop: a note dragged from the notes list/folder view ────────
    // (no berean-tab-id, but has berean-note-id from NotesList/NotesFolderView)
    const noteItemId    = e.dataTransfer.getData('berean-note-id')
    const noteItemTitle = e.dataTransfer.getData('berean-note-title')
    if (noteItemId && !crossId) {
      const store = useAppStore.getState()

      // If dropped on a scripture tab while the merge indicator was active → open in side panel
      if (wasCrossSpaceHover && wasCrossSpaceHoverIdx !== null) {
        const targetTab = tabs[wasCrossSpaceHoverIdx]
        if (targetTab && targetTab.spaceId === 'scripture') {
          store.updateTabState('scripture', targetTab.id, {
            rightPanelOpen:   true,
            rightPanelTab:    'notes',
            rightPanelNoteId: noteItemId,
          })
          store.activateTab(targetTab)
          store.setActiveSpace('scripture')
          return
        }
      }

      // Default: open as a new note tab
      const tab = {
        id:      `note-${noteItemId}-${Date.now()}`,
        spaceId: 'notes' as const,
        type:    'note'  as const,
        title:   noteItemTitle || 'Note',
        state:   { noteId: noteItemId, isNew: false },
      }
      store.addTab(tab)
      store.activateTab(tab)
      store.setActiveSpace('notes')
      return
    }

    if (fromIdx === null) return

    // Primary path: find which tab div is at the exact cursor position
    let el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
    while (el && !el.dataset.tabIdx) {
      el = el.parentElement as HTMLElement | null
    }

    let toIdx: number
    let insertBefore: boolean

    if (el && el.dataset.tabIdx !== undefined) {
      // Cursor landed directly on (or inside) a tab element
      toIdx = parseInt(el.dataset.tabIdx, 10)
      const rect = el.getBoundingClientRect()
      insertBefore = e.clientY < rect.top + rect.height / 2
    } else if (fallbackToIdx !== null) {
      // Cursor landed in the gap between tabs — use the last indicator position
      toIdx = fallbackToIdx
      insertBefore = fallbackBefore
    } else {
      return
    }

    const draggedTab = tabs[fromIdx]
    const targetTab  = tabs[toIdx]

    if (!draggedTab || !targetTab)        return
    if (draggedTab.id === targetTab.id)   return

    onReorder(draggedTab.id, targetTab.id, insertBefore)
  }

  function handleContainerDragOver(e: React.DragEvent) {
    // Must preventDefault on container too so it's a valid drop target
    // when cursor is in the gap between tabs
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  function handleContainerDragLeave(e: React.DragEvent) {
    // Only clear the visual indicator when the cursor truly leaves the list
    const related = e.relatedTarget as Node | null
    if (related === null || !e.currentTarget.contains(related)) {
      setDragOverIdx(null)
      setCrossSpaceHoverIdx(null)
    }
  }

  function handleDragEnd(e: React.DragEvent) {
    // Use coordinate check: if cursor is within window bounds at dragend, user dragged back — cancel float
    const insideWindow = e.clientX > 0 && e.clientX < window.innerWidth &&
                         e.clientY > 0 && e.clientY < window.innerHeight
    const wentOutside = leftWindowRef.current && !insideWindow
    leftWindowRef.current  = false
    const tab = draggingTabRef.current
    draggingTabRef.current = null
    draggingIdxRef.current = null
    setDraggingIdx(null)
    setDragOverIdx(null)
    setCrossSpaceHoverIdx(null)

    if (wentOutside && tab) {
      const floatType = tab.type === 'note' ? 'notes' : tab.type
      const rawState = (tab.state ?? {}) as unknown as Record<string, unknown>
      const floatState: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(rawState)) {
        if (v !== null && v !== undefined) floatState[k] = v
      }
      if (floatType === 'bible' && floatState.rightPanelOpen === true) {
        floatState.rightPanelOpen  = false
        floatState._rightPanelWasOpen = 'true'
      }
      window.app.openFloatingTab(floatType, floatState)
      useAppStore.getState().bumpFloatingTabToken()
      onTabClose(tab)
    }
  }

  function handleContextMenu(e: React.MouseEvent, tab: Tab) {
    e.preventDefault()
    e.stopPropagation()
    openContextMenu({ tab, x: e.clientX, y: e.clientY })
  }

  // ── Render ─────────────────────────────────────────────────────────────

  const otherSessions = sessions.filter(s => s.id !== currentSessionId)

  return (
    <>
      <div
        className="flex flex-col gap-0.5 px-2"
        onDragOver={handleContainerDragOver}
        onDrop={handleContainerDrop}
        onDragLeave={handleContainerDragLeave}
      >
        {tabs.map((tab, idx) => {
          const Icon       = TAB_ICONS[tab.type]
          const isActive   = tab.id === activeTabId
          const isDragging = draggingIdx === idx
          const bibleState = tab.type === 'bible' ? (tab.state as BibleTabState) : null
          const isCompare  = bibleState?.compareMode ?? false
          const isLXX      = (bibleState?.translation?.toUpperCase() ?? '') === 'LXX'

          const showInsertBefore    = dragOverIdx === idx && dragInsertBefore  && draggingIdx !== idx
          const showInsertAfter     = dragOverIdx === idx && !dragInsertBefore && draggingIdx !== idx
          const isCrossSpaceTarget  = crossSpaceHoverIdx === idx

          return (
            <div key={tab.id} className="relative">
              {showInsertBefore && (
                <div className="absolute top-0 left-1 right-1 h-0.5 rounded-full bg-[rgb(var(--color-accent))] z-10 -translate-y-px pointer-events-none" />
              )}

              {/* data-tab-idx is read by handleContainerDrop to identify the target tab */}
              <div
                data-tab-idx={idx}
                draggable
                onDragStart={(e) => handleDragStart(e, idx)}
                onDragOver={(e)  => handleTabDragOver(e, idx)}
                onDragEnd={handleDragEnd}
                onContextMenu={(e) => handleContextMenu(e, tab)}
                className={`
                  group flex items-center gap-2 rounded-md px-2 py-1.5
                  cursor-grab select-none transition-colors duration-100
                  ${isDragging ? 'opacity-40 scale-95' : ''}
                  ${isCrossSpaceTarget
                    ? 'ring-2 ring-[rgb(var(--color-accent))] bg-[rgb(var(--color-accent))/15] text-[rgb(var(--color-accent))]'
                    : isActive
                      ? 'bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))]'
                      : 'text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-3))] hover:text-[rgb(var(--color-text-primary))]'
                  }
                `}
              >
                <button
                  onClick={() => onTabClick(tab)}
                  className="flex items-center gap-2 flex-1 min-w-0 text-left cursor-pointer"
                >
                  <span className="relative flex-shrink-0">
                    <Icon size={13} className="opacity-60" />
                    {tab.type === 'youtube' && tab.id === activeYouTubeTabId && youtubeIsPlaying && (
                      <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                    )}
                  </span>
                  <span className="truncate text-xs">{tab.title}</span>
                  {isCompare && (
                    <GitCompare size={10} className="flex-shrink-0 text-[rgb(var(--color-accent))] opacity-80" aria-label="Compare mode" />
                  )}
                  {isLXX && (
                    <span className="flex-shrink-0 text-[9px] px-1 py-0 rounded font-semibold bg-[rgb(var(--color-accent))/15] text-[rgb(var(--color-accent))]">LXX</span>
                  )}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onTabClose(tab) }}
                  className={`flex-shrink-0 rounded p-0.5
                    text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))]
                    hover:bg-[rgb(var(--color-surface-4))] transition-opacity cursor-pointer
                    ${isActive ? 'opacity-40 hover:opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                >
                  <X size={11} />
                </button>
              </div>

              {showInsertAfter && (
                <div className="absolute bottom-0 left-1 right-1 h-0.5 rounded-full bg-[rgb(var(--color-accent))] z-10 translate-y-px pointer-events-none" />
              )}
            </div>
          )
        })}
      </div>

      {contextMenu && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 9999 }}
          className="min-w-44 rounded-xl bg-[rgb(var(--color-surface-2))] border border-[rgb(var(--color-surface-4))] shadow-2xl p-1 text-xs"
        >
          <button
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
            onClick={() => {
              // Note tabs use type='note' internally but the float shell checks for 'notes'
              const floatType = contextMenu.tab.type === 'note' ? 'notes' : contextMenu.tab.type
              // Filter out null/undefined values — they stringify to "null"/"undefined" in URL params
              const rawState = (contextMenu.tab.state ?? {}) as unknown as Record<string, unknown>
              const floatState: Record<string, unknown> = {}
              for (const [k, v] of Object.entries(rawState)) {
                if (v !== null && v !== undefined) floatState[k] = v
              }
              // Hide the right panel in the float; remember to restore it on put-back
              if (floatType === 'bible' && floatState.rightPanelOpen === true) {
                floatState.rightPanelOpen = false
                floatState._rightPanelWasOpen = 'true'
              }
              window.app.openFloatingTab(floatType, floatState)
              useAppStore.getState().bumpFloatingTabToken()
              onTabClose(contextMenu.tab)
              closeContextMenu()
            }}
          >
            <ExternalLink size={12} />
            Open in floating tab
          </button>
          <button
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
            onClick={() => {
              const store = useAppStore.getState()
              const newTab = {
                ...contextMenu.tab,
                id: `${contextMenu.tab.type}-${Date.now()}`,
                // Deep-clone the state so the duplicate is independent
                state: JSON.parse(JSON.stringify(contextMenu.tab.state)),
              }
              store.addTab(newTab)
              closeContextMenu()
            }}
          >
            <Copy size={12} />
            Duplicate tab
          </button>
          <div className="my-1 h-px bg-[rgb(var(--color-surface-4))]" />
          <button
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
            onClick={() => { archiveTab(contextMenu.tab.spaceId, contextMenu.tab.id); closeContextMenu() }}
          >
            <Archive size={12} />
            Archive tab
          </button>
          <button
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[rgb(var(--color-text-secondary))] hover:bg-red-500/15 hover:text-red-400 transition-colors cursor-pointer"
            onClick={() => { onTabClose(contextMenu.tab); closeContextMenu() }}
          >
            <Trash2 size={12} />
            Close tab
          </button>
          {otherSessions.length > 0 && (
            <>
              <div className="my-1 h-px bg-[rgb(var(--color-surface-4))]" />
              <div className="px-2 py-1 text-[10px] text-[rgb(var(--color-text-muted))] uppercase tracking-wide">Move to session</div>
              {otherSessions.map((session) => (
                <button
                  key={session.id}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
                  onClick={() => {
                    moveTabToSession(contextMenu.tab.spaceId, contextMenu.tab.id, session.id)
                    closeContextMenu()
                  }}
                >
                  <Layers size={12} />
                  {session.name}
                </button>
              ))}
            </>
          )}
        </div>,
        document.body
      )}
    </>
  )
}
