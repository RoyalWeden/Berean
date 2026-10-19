import { createContext, useContext } from 'react'
import { useAppStore } from '@/store'
import { recordNavigation } from '@/lib/verseNavigation'
import { bookName } from '@/lib/parseRef'
import type { AiLookupTabContextRef, ChatNavPayload } from '@/types/electron'

/**
 * What a chat result does when clicked. The embedded panel runs `performChatNav` against its own
 * window's store; the standalone chat window has no tabs of its own, so it hands the same payload
 * to the main window (window.chatWindow.openInMain → chatMainBridge → performChatNav there).
 */
export type ChatNavigate = (payload: ChatNavPayload) => void

export const ChatNavContext = createContext<ChatNavigate>(() => {})
export const useChatNavigate = () => useContext(ChatNavContext)

export function performChatNav(payload: ChatNavPayload): void {
  const state = useAppStore.getState()
  switch (payload.kind) {
    case 'note':
      state.ensureTab('note'); state.setActiveSpace('notes'); state.requestOpenNote(payload.noteId)
      return
    case 'lexicon':
      state.ensureTab('lexicon'); state.openLexiconEntry(payload.strongsNum); state.setActiveSpace('lexicon')
      return
    case 'video':
      state.openYouTubeVideoInNewTab(payload.videoId, payload.startSeconds); state.setActiveSpace('youtube')
      return
    case 'verse': {
      const r = payload.result
      const activeId = state.activeTabId.scripture
      const activeScripture = activeId ? state.tabs.scripture.find((t) => t.id === activeId) : null
      const priorState = activeScripture?.state as { bookId?: string; chapter?: number; targetVerse?: number } | undefined
      const title = `${r.bookName} ${r.chapter}:${r.verse}${r.endVerse ? '-' + r.endVerse : ''}`
      if (activeScripture) {
        state.updateTabState('scripture', activeScripture.id, { bookId: r.bookId, chapter: r.chapter, targetVerse: r.verse, endVerse: r.endVerse, scrollPosition: 0, translation: r.textId.toUpperCase() })
      } else {
        state.addTab({
          id: `bible-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          spaceId: 'scripture', type: 'bible', title,
          state: { bookId: r.bookId, chapter: r.chapter, targetVerse: r.verse, endVerse: r.endVerse, translation: r.textId.toUpperCase(), showStrongs: false, scrollPosition: 0 },
        })
      }
      state.setActiveSpace('scripture')
      // Tier 1 — the chat's suggestion IS the reason; the asked question is threaded through as
      // the Study Trail connection's reason text. A nested cross-ref result also knows which
      // verse's cross-ref list it came from.
      recordNavigation(
        { bookId: priorState?.bookId, chapter: priorState?.chapter, verse: priorState?.targetVerse },
        { bookId: r.bookId, chapter: r.chapter, verse: r.verse },
        { kind: 'ai-lookup', question: payload.question ?? '', fromVerse: r.crossRefOf?.verse },
      )
    }
  }
}

/**
 * A lightweight {type, ref} pointer to whatever tab is active in the current space — the main
 * process fetches the REAL content server-side from just this reference (buildTabContextBlock in
 * electron/ipc/aiLookup.ts), never trusting renderer-supplied text. Undefined when the active tab
 * isn't a supported type (search/pdf) or nothing is open.
 */
export function getActiveTabContextRef(): AiLookupTabContextRef | undefined {
  const state = useAppStore.getState()
  const space = state.activeSpace
  const activeId = state.activeTabId[space]
  const tab = activeId ? state.tabs[space].find((t) => t.id === activeId) : null
  if (!tab) return undefined
  const label = tab.title || undefined
  if (tab.type === 'bible') {
    const s = tab.state as { bookId: string; chapter: number; translation: string }
    // Labelled with what is actually sent (the chapter), not the tab title — a tab showing
    // Advanced Search results still sends its chapter, as it always has.
    return { type: 'bible', bookId: s.bookId, chapter: s.chapter, translation: s.translation, label: `${bookName(s.bookId)} ${s.chapter}` }
  }
  if (tab.type === 'note') {
    const s = tab.state as { noteId: string | null }
    return s.noteId ? { type: 'note', noteId: s.noteId, label } : undefined
  }
  if (tab.type === 'lexicon') {
    const s = tab.state as { strongsNum: string | null }
    return s.strongsNum ? { type: 'lexicon', strongsNum: s.strongsNum, label } : undefined
  }
  if (tab.type === 'youtube') {
    const s = tab.state as { videoId: string | null }
    return s.videoId ? { type: 'youtube', videoId: s.videoId, label } : undefined
  }
  return undefined
}
