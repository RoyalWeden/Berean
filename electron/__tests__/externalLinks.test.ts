import { describe, it, expect, vi, beforeEach } from 'vitest'

const openExternal = vi.fn(async () => {})
vi.mock('electron', () => ({ shell: { openExternal: (...a: unknown[]) => openExternal(...(a as [])) } }))

import { isSafeExternalUrl, keepLinksOutOfApp, leavesApp, openExternalSafely } from '../externalLinks'

describe('external links', () => {
  beforeEach(() => openExternal.mockClear())

  it('allows only web and mail links', () => {
    for (const u of ['https://example.com', 'http://example.com', 'mailto:a@example.com']) expect(isSafeExternalUrl(u)).toBe(true)
    for (const u of ['file:///etc/passwd', 'javascript:alert(1)', 'smb://host/share', 'x-custom://run', 'nonsense', 1, null]) expect(isSafeExternalUrl(u)).toBe(false)
  })

  it('refuses to open anything else', async () => {
    await openExternalSafely('file:///Applications/Calculator.app')
    expect(openExternal).not.toHaveBeenCalled()
    await openExternalSafely('https://example.com')
    expect(openExternal).toHaveBeenCalledWith('https://example.com')
  })

  it('treats a move to another origin as leaving the app', () => {
    expect(leavesApp('http://localhost:5173/', 'http://localhost:5173/#/x')).toBe(false)
    expect(leavesApp('file:///a/index.html', 'file:///a/index.html?x=1')).toBe(false)
    expect(leavesApp('http://localhost:5173/', 'https://example.com/')).toBe(true)
    expect(leavesApp('file:///a/index.html', 'https://example.com/')).toBe(true)
  })

  it('sends new windows to the browser and stops the app window navigating away', () => {
    let open: (d: { url: string }) => { action: string } = () => ({ action: '' })
    let nav: (e: { preventDefault: () => void }, url: string) => void = () => {}
    const contents = { setWindowOpenHandler: (f: typeof open) => { open = f }, on: (_: string, f: typeof nav) => { nav = f }, getURL: () => 'http://localhost:5173/' }
    keepLinksOutOfApp(contents as never)
    expect(open({ url: 'https://example.com' })).toEqual({ action: 'deny' })
    expect(openExternal).toHaveBeenCalledWith('https://example.com')
    const stop = vi.fn()
    nav({ preventDefault: stop }, 'https://evil.example/')
    expect(stop).toHaveBeenCalled()
    const stay = vi.fn()
    nav({ preventDefault: stay }, 'http://localhost:5173/page')
    expect(stay).not.toHaveBeenCalled()
  })
})
