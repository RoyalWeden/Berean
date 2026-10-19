// @vitest-environment jsdom
/** Transcript rendering cost: appending a message renders only the new row (memoized rows get
 *  the same message object), and only a window of rows is in the DOM for a long history. */
import { describe, it, expect, vi, afterEach } from 'vitest'
import React, { act, createContext } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ChatMsg, TranscriptItem } from '../chatModel'

const renders: Record<string, number> = {}
vi.mock('../AiReplyBody', () => ({
  VerseMenuContext: createContext(null),
  AiReplyBody: ({ message }: { message: { id: string } }) => { renders[message.id] = (renders[message.id] ?? 0) + 1; return null },
}))
const { ChatTranscript } = await import('../ChatTranscript')

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null })

const at = (i: number) => new Date(2026, 9, 17, 9, 0, i).toISOString()
const it_ = (m: ChatMsg): TranscriptItem => ({ key: m.id, chatId: 'c', chatTitle: 'C', message: m })

function render(items: TranscriptItem[]) {
  const el = (
    <ChatTranscript items={items} resetKey="c" crossConversation={false} hasOlder={false} loadingOlder={false} onLoadOlder={() => {}}
      typing={null} failedIds={new Set()} focusMessageId={null} onFocusHandled={() => {}} stickToken={0} empty={<span>empty</span>} />
  )
  if (!root) { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) }
  act(() => root!.render(el))
  return host!
}

describe('ChatTranscript', () => {
  it('appending a message does not re-render existing rows', () => {
    const reply: ChatMsg = { id: 'r1', role: 'assistant', kind: 'ai-reply', content: 'answer', createdAt: at(1) }
    const base = [it_({ id: 'q1', role: 'user', kind: 'ai-request', content: 'q', createdAt: at(0) }), it_(reply)]
    render(base)
    expect(renders.r1).toBe(1)
    render([...base, it_({ id: 'n1', role: 'user', kind: 'note', content: 'a note', createdAt: at(2) })])
    expect(renders.r1).toBe(1)
    expect(host!.textContent).toContain('a note')
  })

  it('keeps only a window of a long history in the DOM', () => {
    const many = Array.from({ length: 600 }, (_, i) => it_({ id: `n${i}`, role: 'user', kind: 'note', content: `note ${i}`, createdAt: new Date(2026, 9, 17, 9, 0, 0, i).toISOString() }))
    const h = render(many)
    const shown = h.querySelectorAll('[data-message-id]').length
    expect(shown).toBeLessThan(200)
    expect(h.textContent).toContain('note 599')
    expect(h.querySelector('[data-message-id="n0"]')).toBeNull()
    expect(h.textContent).toContain('Show Earlier Messages')
  })

  it('shows the empty state with no messages', () => {
    expect(render([]).textContent).toContain('empty')
  })
})
