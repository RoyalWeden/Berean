// @vitest-environment jsdom
/**
 * Berean Chat markdown renderer (ChatMarkdown) — markdown-it tokens → React elements: safety,
 * tables, code, headings, lists, verse / Strong's linking (and where it must NOT link), streaming.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ChatNavContext } from '../chatNav'
import { ChatMarkdown } from '../ChatMarkdown'
import { acceptChatRef, linkifyRefs, prepareStreamingMarkdown } from '../chatMarkdownParse'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null; host = null })

function render(text: string, opts: { tone?: 'accent' | 'plain'; streaming?: boolean } = {}) {
  const nav = vi.fn()
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  act(() => root!.render(<ChatNavContext.Provider value={nav}><ChatMarkdown text={text} {...opts} /></ChatNavContext.Provider>))
  return { el: host, nav }
}
const links = (el: Element) => [...el.querySelectorAll<HTMLButtonElement>('button.chat-link')].map((b) => b.textContent)

describe('ChatMarkdown — safety', () => {
  it('renders javascript:/data:/vbscript:/file: links as plain text', () => {
    const { el } = render('[a](javascript:alert(1)) [b](data:text/html,<b>x</b>) [c](vbscript:x) [d](file:///etc/passwd) [ok](https://sitgmeat.com)')
    const anchors = [...el.querySelectorAll('a')]
    expect(anchors.map((a) => a.getAttribute('href'))).toEqual(['https://sitgmeat.com'])
    expect(anchors[0].getAttribute('target')).toBe('_blank')
    expect(anchors[0].getAttribute('rel')).toBe('noreferrer noopener')
    expect(el.textContent).toContain('a b c d ok')
  })
  it('shows raw HTML as literal text and never creates elements from it', () => {
    const { el } = render('<img src=x onerror=alert(1)>\n\n<script>alert(1)</script>\n\n<b>bold?</b>')
    expect(el.querySelector('img, script, b')).toBeNull()
    expect(el.textContent).toContain('<img src=x onerror=alert(1)>')
    expect(el.textContent).toContain('<script>alert(1)</script>')
  })
  it('never loads markdown images — shows them as a link', () => {
    const { el } = render('![tracking pixel](https://evil.example/p.png) ![x](javascript:alert(1))')
    expect(el.querySelector('img')).toBeNull()
    expect(el.querySelector('a')!.getAttribute('href')).toBe('https://evil.example/p.png')
    expect(el.querySelector('a')!.textContent).toBe('tracking pixel')
  })
  it('survives malformed markdown', () => {
    const { el } = render('**unclosed *mixed _ [link( `tick\n| a | b\n|--\n> > > deep\n1.\n-')
    expect(el.textContent).toContain('unclosed')
  })
  it('bare https links link; bare domains and emails do not', () => {
    const { el } = render('see https://sitgmeat.com/a-very/long/path?x=1 or sitgmeat.com or me@example.com')
    expect([...el.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['https://sitgmeat.com/a-very/long/path?x=1'])
  })
})

describe('ChatMarkdown — blocks', () => {
  it('renders a table with header, alignment and a horizontal scroll wrapper', () => {
    const { el } = render('| Book | Ref | Count |\n|:--|:-:|--:|\n| Isaiah | Isaiah 58:13 | 3 |\n| Strong | H7676 | 111 |')
    const wrap = el.querySelector('.chat-table-wrap')!
    expect(wrap).toBeTruthy()
    const table = wrap.querySelector('table')!
    expect([...table.querySelectorAll('th')].map((t) => t.textContent)).toEqual(['Book', 'Ref', 'Count'])
    expect((table.querySelectorAll('th')[1] as HTMLElement).style.textAlign).toBe('center')
    expect((table.querySelectorAll('td')[2] as HTMLElement).style.textAlign).toBe('right')
    expect(links(table)).toEqual(['Isaiah 58:13', 'H7676'])
  })
  it('code blocks keep whitespace, have a Copy button and nothing is formatted or linked inside', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const code = 'const x = **bold** // John 3:16 H7225\n    indented  [l](https://a.b)'
    const { el } = render('```ts\n' + code + '\n```')
    const pre = el.querySelector('pre.chat-pre')!
    expect(pre.textContent).toBe(code)
    expect(pre.querySelector('strong, a, button')).toBeNull()
    const copy = el.querySelector<HTMLButtonElement>('button[aria-label="Copy code"]')!
    await act(async () => { copy.click() })
    expect(writeText).toHaveBeenCalledWith(code)
  })
  it('maps headings to restrained sizes', () => {
    const { el } = render('# Big\n## Section\n### Small\n###### Tiny')
    expect(el.querySelector('h1')!.className).toContain('chat-h-lg')
    expect(el.querySelector('h2')!.className).toContain('chat-h-lg')
    expect(el.querySelector('h3')!.className).toContain('chat-h-sm')
    expect(el.querySelector('h6')!.className).toContain('chat-h-sm')
  })
  it('renders bullet, ordered and read-only task lists', () => {
    const { el } = render('- one\n- two\n\n3. three\n4. four\n\n- [x] keep the Sabbath\n- [ ] read Jubilees 2')
    expect([...el.querySelectorAll('ul.list-disc li')].map((li) => li.textContent)).toEqual(['one', 'two'])
    expect(el.querySelector('ol')!.getAttribute('start')).toBe('3')
    const tasks = [...el.querySelectorAll('li.chat-task')]
    expect(tasks.map((t) => t.textContent)).toEqual(['keep the Sabbath', 'read Jubilees 2'])
    expect(tasks[0].className).toContain('is-done')
    expect(tasks[0].querySelector('[aria-label="Done"]')).toBeTruthy()
    expect(el.querySelector('input')).toBeNull()
  })
  it('renders quotes, rules, strike, underline and highlight', () => {
    const { el } = render('> Titus 2:11\n\n---\n\n~~old~~ <u>new</u> ==key==')
    expect(el.querySelector('blockquote button.chat-link')!.textContent).toBe('Titus 2:11')
    expect(el.querySelector('hr')).toBeTruthy()
    expect(el.querySelector('s')!.textContent).toBe('old')
    expect(el.querySelector('u')!.textContent).toBe('new')
    expect(el.querySelector('mark')!.textContent).toBe('key')
  })
  it('keeps a legacy plain message as-is (one newline = one line, • bullets still list)', () => {
    const { el } = render('Read Isaiah 58 before the feast\nthen rest\n• Yeshua kept it\n• so do we')
    expect(el.querySelectorAll('br').length).toBe(1)
    expect(el.textContent).toContain('Read Isaiah 58 before the feast')
    expect([...el.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['Yeshua kept it', 'so do we'])
    expect(links(el)).toEqual(['Isaiah 58'])
  })
})

describe('ChatMarkdown — verse and Strong\'s links', () => {
  it('links refs in text, quotes and lists but not inside code or links', () => {
    const { el } = render('John 3:16 and `John 3:16` and [Gen 1:1](https://x.y) and H7225\n- Ps 23\n> G5485')
    expect(links(el)).toEqual(['John 3:16', 'H7225', 'Ps 23', 'G5485'])
  })
  it('navigates with the same payloads as before', () => {
    const { el, nav } = render('Isaiah 66:3 LXX then Titus 2:11-12 and H7225')
    const [lxx, titus, h] = [...el.querySelectorAll<HTMLButtonElement>('button.chat-link')]
    act(() => lxx.click())
    expect(nav).toHaveBeenLastCalledWith({ kind: 'verse', result: expect.objectContaining({ textId: 'lxx', bookId: 'ISA', chapter: 66, verse: 3, text: '', source: 'keyword' }) })
    act(() => titus.click())
    expect(nav).toHaveBeenLastCalledWith({ kind: 'verse', result: expect.objectContaining({ bookId: 'TIT', chapter: 2, verse: 11, endVerse: 12 }) })
    expect(titus.title).toBe('Open Titus 2:11-12')
    act(() => h.click())
    expect(nav).toHaveBeenLastCalledWith({ kind: 'lexicon', strongsNum: 'H7225' })
    expect(h.className).toContain('is-strongs')
  })
  it('does not link ordinary English that looks like a book abbreviation', () => {
    for (const s of ['I am 3 years old', 'It is 1 thing', 'Meet at 3 pm', 'At 3 pm we met', 'Is 1 enough?', 'Am 3 here', 'Song 2 is on repeat', 'my ex 2 years ago', 'mark 4 times', 'job 3 at work']) {
      expect(linkifyRefs(s).filter((x) => x.kind === 'verse'), s).toEqual([])
    }
    // …but real references still link
    for (const s of ['Song 2:4', 'Song of Solomon 2', 'Job 5', 'Mark 4', 'Ps 23', 'Gen 1', 'is 5:1']) {
      expect(linkifyRefs(s).some((x) => x.kind === 'verse'), s).toBe(true)
    }
    expect(acceptChatRef('Isaiah 58', 'Isaiah 58')).toBe(true)
  })
  it('marks links on the accent bubble', () => {
    const { el } = render('Titus 2:11 [site](https://sitgmeat.com)', { tone: 'accent' })
    expect([...el.querySelectorAll('.chat-link')].every((l) => l.className.includes('is-on-accent'))).toBe(true)
    expect(el.firstElementChild!.className).toContain('is-accent')
  })
})

describe('ChatMarkdown — streaming', () => {
  it('closes an unclosed fence for display', () => {
    expect(prepareStreamingMarkdown('text\n```js\nlet a = 1')).toBe('text\n```js\nlet a = 1\n```')
    const { el } = render('Here:\n```\n**not bold**', { streaming: true })
    expect(el.querySelector('pre')!.textContent).toBe('**not bold**')
    expect(el.textContent).not.toContain('```')
  })
  it('drops a trailing unmatched ** / * / ` so syntax never flashes', () => {
    expect(prepareStreamingMarkdown('Grace is **divine infl')).toBe('Grace is divine infl')
    expect(prepareStreamingMarkdown('a *b')).toBe('a b')
    expect(prepareStreamingMarkdown('use `H72')).toBe('use H72')
    expect(prepareStreamingMarkdown('**done** and *ok*')).toBe('**done** and *ok*')
    expect(prepareStreamingMarkdown('* item\n* item two')).toBe('* item\n* item two')
    const { el } = render('Grace is **divine infl', { streaming: true })
    expect(el.textContent).toBe('Grace is divine infl')
  })
})
