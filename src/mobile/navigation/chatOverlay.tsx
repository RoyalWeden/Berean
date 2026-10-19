import React, { useEffect, useSyncExternalStore } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChatPage } from '../chat'
import { performChatNav } from '@/components/ailookup/chatNav'
import { haptic } from '../primitives/haptics'

/**
 * Berean Chat on the iPhone, presented full screen over whatever tab is showing (iOS
 * full-screen cover): from the Home Screen widget (`berean://chat/new`, TEST 2026-10-17 "make a
 * widget for the berean chat so that it can open for them to make a new message very quickly")
 * and from the caret's Go-to row. Chat is not a tab type — the tabs keep their places beneath it
 * and ‹ returns to exactly where the user was.
 *
 * `compose` bumps `token`, which ChatPage turns into "today's conversation (or a new unsaved one)
 * with the keyboard up" — repeated widget taps reuse it, so no empty duplicate conversations.
 */
interface ChatOverlayState { open: boolean; token: number; compose: boolean; instant?: boolean }
let state: ChatOverlayState = { open: false, token: 0, compose: false }
const listeners = new Set<() => void>()
const set = (next: ChatOverlayState) => { state = next; listeners.forEach((l) => l()) }

export function openChatOverlay(opts: { compose?: boolean } = {}): void {
  set({ open: true, token: opts.compose ? state.token + 1 : state.token, compose: !!opts.compose, instant: false })
}
/** `instant`: the edge swipe already slid Chat off screen — no second exit animation. */
export function closeChatOverlay(opts: { instant?: boolean } = {}): void { if (state.open) set({ ...state, open: false, instant: !!opts.instant }) }
export function chatOverlayState(): ChatOverlayState { return state }

export function ChatOverlayHost() {
  const st = useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l) } }, () => state, () => state)
  // The keyboard / VoiceOver focus belongs to the cover while it is up.
  useEffect(() => {
    if (!st.open) return
    const prev = document.documentElement.dataset.chatOpen
    document.documentElement.dataset.chatOpen = '1'
    return () => { if (prev === undefined) delete document.documentElement.dataset.chatOpen; else document.documentElement.dataset.chatOpen = prev }
  }, [st.open])
  return (
    <AnimatePresence>
      {st.open && (
        <motion.div key="chat" className="m-chat-cover" role="dialog" aria-modal="true" aria-label="Berean Chat"
          // Pushed like any other page (slides in from the right) so ‹ and the left-edge swipe read
          // the same as everywhere else in the app (TEST 2026-10-18).
          initial={{ x: '100%' }} animate={{ x: 0, transition: { type: 'spring', stiffness: 380, damping: 38 } }}
          exit={{ x: '100%', transition: st.instant ? { duration: 0 } : { duration: 0.24, ease: [0.32, 0.72, 0, 1] } }}>
          {/* A verse / Strong's link in a message opens it in the tab beneath — so the cover goes. */}
          <ChatPage onBack={() => { void haptic.navigate(); closeChatOverlay() }} onEdgeClose={() => closeChatOverlay({ instant: true })} newMessageToken={st.compose ? st.token : undefined}
            onNavigate={(p) => { performChatNav(p); closeChatOverlay() }} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
