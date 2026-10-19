import { useAppStore } from '@/store'
import { performChatNav, getActiveTabContextRef } from './chatNav'
import type { ChatHandoff } from '@/types/electron'

/** Window event the embedded panel listens for: "show this conversation (and draft)". */
export const CHAT_HANDOFF_EVENT = 'berean-chat:handoff'

/**
 * Main-window side of the Berean Chat window (installed once from src/main.tsx for the main
 * window only). The chat window is its own renderer with its own store, so anything that needs
 * THIS window's tabs comes through here:
 *   - chat:openInMain       → open a verse/note/Strong's/video result here
 *   - chat:requestTabContext → answer "what tab is active?" for an Ask Berean "This Tab" request
 *   - chat:showPanel        → "Return to Main Window" re-opens the embedded panel on the
 *                             window's conversation + draft (CHAT_HANDOFF_EVENT)
 */
let installed = false
export function installChatMainBridge(): void {
  const cw = window.chatWindow
  if (installed || !cw) return
  installed = true
  cw.onOpenInMain((payload) => performChatNav(payload))
  cw.onRequestTabContext((requestId) => cw.replyTabContext(requestId, getActiveTabContextRef() ?? null))
  cw.onShowPanel((handoff) => {
    useAppStore.getState().setAiLookupPanelOpen(true)
    if (handoff) window.dispatchEvent(new CustomEvent<ChatHandoff>(CHAT_HANDOFF_EVENT, { detail: handoff }))
  })
}
