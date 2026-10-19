// @vitest-environment jsdom
/**
 * Performance audit 2026-10-19: a long conversation opens with a bounded window of rows, and Find
 * no longer mounts every row on its first keystroke (649 ms stall in a 600-message conversation):
 * the window grows in batches once Find opens, every match is still found (the oldest message
 * included), and the current match stays the same match while rows are added above it.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ChatTranscript, type TranscriptFind } from '../ChatTranscript'
import type { TranscriptItem } from '../chatModel'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
Element.prototype.scrollIntoView ??= function () { /* jsdom */ }

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null })
const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })

const N = 300
const items: TranscriptItem[] = Array.from({ length: N }, (_, i) => ({
  key: `m${i}`, chatId: 'c', chatTitle: 'Long',
  message: { id: `m${i}`, role: 'user', kind: 'note', content: i === 0 ? 'the oldest sabbath note' : `note ${i} about grace`, createdAt: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString() } as TranscriptItem['message'],
}))

function mount(find: TranscriptFind | null) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  const render = (f: TranscriptFind | null) => act(() => root!.render(
    <ChatTranscript items={items} resetKey="c:c" crossConversation={false} hasOlder={false} loadingOlder={false} onLoadOlder={() => {}}
      typing={null} failedIds={new Set()} focusMessageId={null} onFocusHandled={() => {}} stickToken={0} empty={null} find={f} />,
  ))
  render(find)
  return { render, rows: () => host!.querySelectorAll('[data-message-id]').length }
}

describe('long conversation rendering', () => {
  it('opens with a bounded window, not every message', () => {
    const { rows } = mount(null)
    expect(rows()).toBe(60)
  })

  it('Find grows the window in batches (never all at once) and still finds the oldest message', async () => {
    let last = { count: -1, index: -1 }
    const find = (query: string, index = 0): TranscriptFind => ({ query, index, onMatches: (count, i) => { last = { count, index: i } } })
    const { render, rows } = mount(null)
    render(find(''))
    expect(rows()).toBe(60) // opening Find mounts nothing synchronously
    render(find('sabbath'))
    expect(rows()).toBeLessThan(N) // nor does the first keystroke
    for (let i = 0; i < 40 && rows() < N; i++) await wait(10)
    expect(rows()).toBe(N)
    await wait(20)
    expect(last.count).toBe(1) // "the oldest sabbath note" — found once every row is in
  })

  it('the current match stays the same match while rows are added above it', async () => {
    let last = { count: -1, index: -1 }
    const query = 'grace'
    let index = 0
    const find = (): TranscriptFind => ({ query, index, onMatches: (count, i) => { last = { count, index: i }; index = i } })
    const { render, rows } = mount(null)
    render(find())
    // the first painted match is the first one in the rows mounted so far (m240)
    const firstShown = Number(host!.querySelector('[data-message-id]')!.getAttribute('data-message-id')!.slice(1))
    expect(firstShown).toBe(N - 60)
    for (let i = 0; i < 40 && rows() < N; i++) { await wait(10); render(find()) }
    expect(rows()).toBe(N)
    render(find())
    expect(last.count).toBe(N - 1)
    // index now points at that same message, which has N-1-… earlier matches before it
    expect(last.index).toBe(firstShown - 1) // m0 has no "grace": m240 is match 239
  })
})
