// @vitest-environment jsdom
/** Desktop composer: a rich-text field whose value is markdown; no Send button (Return sends,
 *  Shift+Return is a newline, ⌘Return asks Berean), not user-resizable, auto-grow capped, an
 *  expand/collapse toggle, a formatting toolbar, edit mode and durable per-conversation drafts. */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ChatComposer, type ChatComposerHandle } from '../ChatComposer'
import { CHAT_DRAFTS_KEY, readDraft, writeDraft, MAX_DRAFTS } from '../composer/chatDrafts'
import { editorEl, valueOf, setValue, typeText, press, selectAll } from './composerTestUtils'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root | null = null
let host: HTMLDivElement | null = null
beforeEach(() => { try { localStorage.clear() } catch { /* */ } vi.useRealTimers() })
afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null })

type Props = Partial<React.ComponentProps<typeof ChatComposer>>
function mount(props: Props = {}) {
  const onSend = props.onSend ?? vi.fn(async () => true)
  const ref = React.createRef<ChatComposerHandle>()
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  const render = (p: Props) => act(() => root!.render(<div style={{ height: 600 }}><ChatComposer ref={ref} aiAvailable aiBusy={false} {...props} {...p} onSend={onSend} /></div>))
  render({})
  return { h: host, onSend, ref, rerender: render, field: () => editorEl(host!)! }
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

describe('ChatComposer (desktop)', () => {
  it('is a labelled multi-line textbox; no Send button; Return sends, Shift+Return does not, ⌘Return asks Berean', async () => {
    const { h, onSend, field } = mount()
    expect(h.querySelector('button[aria-label="Send"]')).toBeNull()
    expect(h.querySelector('textarea')).toBeNull()
    expect(field().getAttribute('aria-label')).toBe('Message')
    expect(field().getAttribute('aria-multiline')).toBe('true')
    typeText(field(), 'line one')
    press(field(), 'Enter', { shift: true })
    typeText(field(), 'line two')
    expect(onSend).not.toHaveBeenCalled()
    press(field(), 'Enter')
    await settle()
    expect(onSend).toHaveBeenCalledWith('line one\nline two', {})
    expect(valueOf(field())).toBe('')
    typeText(field(), 'a question')
    press(field(), 'Enter', { mod: true })
    await settle()
    expect(onSend).toHaveBeenLastCalledWith('a question', expect.objectContaining({ ai: expect.any(Object) }))
  })

  it('sends formatting as markdown; an empty field never sends', async () => {
    const { onSend, field } = mount()
    press(field(), 'Enter')
    await settle()
    expect(onSend).not.toHaveBeenCalled()
    typeText(field(), '**Grace** and *truth* came by Yeshua')
    press(field(), 'Enter')
    await settle()
    expect(onSend).toHaveBeenCalledWith('**Grace** and *truth* came by Yeshua', {})
  })

  it('Return inside a code block is a new line, not a send', async () => {
    const { onSend, field } = mount()
    typeText(field(), '```')
    typeText(field(), 'let a = 1')
    press(field(), 'Enter')
    typeText(field(), 'let b = 2')
    await settle()
    expect(onSend).not.toHaveBeenCalled()
    press(field(), 'Enter', { mod: true }) // ⌘Return still sends (as a question)
    await settle()
    expect(onSend).toHaveBeenCalledWith('```\nlet a = 1\nlet b = 2\n```', expect.objectContaining({ ai: expect.any(Object) }))
  })

  it('⌘B formats the selection and never sends; an IME composition Return never sends', async () => {
    const { onSend, field } = mount()
    setValue(field(), 'hesed')
    selectAll(field())
    press(field(), 'b', { mod: true })
    expect(valueOf(field())).toBe('**hesed**')
    press(field(), 'Enter', { composing: true })
    await settle()
    expect(onSend).not.toHaveBeenCalled()
  })

  it('expand toggles a tall field and back; the field is capped at ~5 lines otherwise', () => {
    const { h } = mount()
    const box = h.querySelector<HTMLElement>('.chat-editor')!
    expect(box.style.maxHeight).toBe('100px')
    act(() => h.querySelector<HTMLButtonElement>('button[aria-label="Expand Message Field"]')!.click())
    expect(h.querySelector('button[aria-label="Collapse Message Field"]')).not.toBeNull()
    expect(parseInt(box.style.height, 10)).toBeGreaterThanOrEqual(160)
    act(() => h.querySelector<HTMLButtonElement>('button[aria-label="Collapse Message Field"]')!.click())
    expect(box.style.maxHeight).toBe('100px')
  })

  it('a shortcut the field handled never reaches the window (⌘K is not floating search); an unhandled Esc does', () => {
    const { field } = mount()
    const spy = vi.fn()
    window.addEventListener('keydown', spy)
    press(field(), 'k', { mod: true })
    press(field(), 'b', { mod: true })
    press(field(), 'Escape') // closes the link field ⌘K opened — handled, stays in the field
    expect(spy).not.toHaveBeenCalled()
    press(field(), 'Escape') // nothing left to dismiss → the panel may close
    expect(spy).toHaveBeenCalledTimes(1)
    window.removeEventListener('keydown', spy)
  })

  it('Esc disarms Ask Berean, then collapses the expanded field', () => {
    const { h, field } = mount()
    act(() => h.querySelector<HTMLButtonElement>('button[aria-label="Ask Berean"]')!.click())
    expect(field().getAttribute('aria-label')).toBe('Ask Berean')
    act(() => h.querySelector<HTMLButtonElement>('button[aria-label="Expand Message Field"]')!.click())
    press(field(), 'Escape')
    expect(field().getAttribute('aria-label')).toBe('Message')
    expect(h.querySelector('button[aria-label="Collapse Message Field"]')).not.toBeNull()
    press(field(), 'Escape')
    expect(h.querySelector('button[aria-label="Expand Message Field"]')).not.toBeNull()
  })
})

describe('formatting toolbar', () => {
  it('shows active state from the selection and operates on it, without blurring the field', () => {
    const { h, field } = mount()
    act(() => { field().focus() })
    act(() => { field().dispatchEvent(new FocusEvent('focus')) })
    const reveal = h.querySelector('.chat-fmt-reveal')!
    expect(reveal.getAttribute('data-open')).toBe('true')
    setValue(field(), '**grace**')
    selectAll(field())
    const bold = h.querySelector<HTMLButtonElement>('button[aria-label="Bold"]')!
    expect(bold.getAttribute('aria-pressed')).toBe('true')
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    bold.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true) // keeps the editor's focus + selection
    act(() => bold.click())
    expect(valueOf(field())).toBe('grace')
    expect(bold.getAttribute('aria-pressed')).toBe('false')
    act(() => h.querySelector<HTMLButtonElement>('button[aria-label="Italic"]')!.click())
    expect(valueOf(field())).toBe('*grace*')
    act(() => h.querySelector<HTMLButtonElement>('button[aria-label="Bulleted List"]')!.click())
    expect(valueOf(field())).toBe('- *grace*')
    expect(h.querySelector('button[aria-label="Bulleted List"]')!.getAttribute('aria-pressed')).toBe('true')
  })

  it('Link opens an address field that links the selection; ⌘K too', () => {
    const { h, field } = mount()
    setValue(field(), 'site')
    selectAll(field())
    act(() => h.querySelector<HTMLButtonElement>('button[aria-label="Link"]')!.click())
    const input = h.querySelector<HTMLInputElement>('input[aria-label="Link address"]')!
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => { setter.call(input, 'sitgmeat.com'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })) })
    expect(valueOf(field())).toBe('[site](https://sitgmeat.com)')
    expect(h.querySelector('input[aria-label="Link address"]')).toBeNull()
    setValue(field(), 'more')
    press(field(), 'k', { mod: true })
    expect(h.querySelector('input[aria-label="Link address"]')).not.toBeNull()
    press(field(), 'Escape')
  })
})

describe('edit mode', () => {
  it('loads the message, Return saves the markdown, and the draft comes back', async () => {
    const onEditSubmit = vi.fn()
    const onEditingChange = vi.fn()
    const { h, ref, field, onSend } = mount({ onEditSubmit, onEditingChange, draftKey: 'c1' })
    typeText(field(), 'my draft')
    act(() => ref.current!.beginEdit({ id: 'm1', chatId: 'c1', text: '**Grace** teaches', isRequest: false }))
    expect(field().getAttribute('aria-label')).toBe('Edit message')
    expect(h.textContent).toContain('Editing Message')
    expect(field().querySelector('strong')!.textContent).toBe('Grace') // formatting, not asterisks
    expect(ref.current!.getDraft()).toBe('my draft')
    typeText(field(), ' us')
    press(field(), 'Enter')
    await settle()
    expect(onEditSubmit).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }), '**Grace** teaches us')
    expect(onSend).not.toHaveBeenCalled()
    expect(valueOf(field())).toBe('my draft')
    expect(onEditingChange).toHaveBeenLastCalledWith(null)
  })

  it('Esc cancels the edit and restores the draft; the edited text never becomes the draft', async () => {
    vi.useFakeTimers()
    const { ref, field } = mount({ draftKey: 'c1' })
    typeText(field(), 'kept')
    act(() => { vi.advanceTimersByTime(400) })
    act(() => ref.current!.beginEdit({ id: 'm1', chatId: 'c1', text: 'old', isRequest: false }))
    typeText(field(), ' changed')
    act(() => { vi.advanceTimersByTime(400) })
    expect(readDraft('c1')).toBe('kept')
    press(field(), 'Escape')
    expect(valueOf(field())).toBe('kept')
    vi.useRealTimers()
  })
})

describe('drafts', () => {
  it('persist across remounts (debounced), per conversation, and clear on send', async () => {
    vi.useFakeTimers()
    const first = mount({ draftKey: 'a' })
    typeText(first.field(), 'unsent **thought**')
    expect(readDraft('a')).toBe('') // debounced
    act(() => { vi.advanceTimersByTime(350) })
    expect(readDraft('a')).toBe('unsent **thought**')
    // Switch conversations: a's draft stays, b's (empty) shows; and back.
    first.rerender({ draftKey: 'b' })
    expect(valueOf(first.field())).toBe('')
    typeText(first.field(), 'for b')
    first.rerender({ draftKey: 'a' }) // switching flushes b at once
    expect(readDraft('b')).toBe('for b')
    expect(valueOf(first.field())).toBe('unsent **thought**')
    act(() => root!.unmount()); root = null; host!.remove()
    // A fresh mount (relaunch) restores it.
    const again = mount({ draftKey: 'a' })
    expect(valueOf(again.field())).toBe('unsent **thought**')
    vi.useRealTimers()
    press(again.field(), 'Enter')
    await settle()
    expect(again.onSend).toHaveBeenCalledWith('unsent **thought**', {})
    expect(readDraft('a')).toBe('')
  })

  it("text typed after a new conversation's first send follows it to its real id", async () => {
    const view = mount({ draftKey: 'new' })
    typeText(view.field(), 'first')
    press(view.field(), 'Enter')
    await settle()
    typeText(view.field(), 'second, still typing')
    view.rerender({ draftKey: 'chat-1' })
    expect(valueOf(view.field())).toBe('second, still typing')
    expect(readDraft('new')).toBe('')
    expect(readDraft('chat-1')).toBe('second, still typing')
  })

  it('a handed-over draft (setDraft) follows the conversation switch that comes with it', () => {
    writeDraft('older', 'older draft')
    const view = mount({ draftKey: 'latest' })
    act(() => view.ref.current!.setDraft('from the panel'))
    view.rerender({ draftKey: 'older' })
    expect(valueOf(view.field())).toBe('from the panel')
    expect(readDraft('older')).toBe('from the panel')
    expect(readDraft('latest')).toBe('')
  })

  it('follows another window\'s change while not focused', () => {
    const view = mount({ draftKey: 'a' })
    writeDraft('a', 'typed in the chat window')
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: CHAT_DRAFTS_KEY })) })
    expect(valueOf(view.field())).toBe('typed in the chat window')
  })

  it('keeps at most 50 drafts and survives broken storage', () => {
    for (let i = 0; i < MAX_DRAFTS + 5; i++) writeDraft(`k${i}`, `d${i}`)
    const map = JSON.parse(localStorage.getItem(CHAT_DRAFTS_KEY)!)
    expect(Object.keys(map)).toHaveLength(MAX_DRAFTS)
    localStorage.setItem(CHAT_DRAFTS_KEY, '{not json')
    expect(readDraft('k1')).toBe('')
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    expect(() => writeDraft('x', 'y')).not.toThrow()
    spy.mockRestore()
  })
})
