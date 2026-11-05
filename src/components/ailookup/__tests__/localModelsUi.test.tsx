// @vitest-environment jsdom
/** Settings → Ask Berean, local models (spec §8.3): remove needs confirmation, progress and cancel, hidden when absent. */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import LocalModelsSettings from '@/components/settings/sections/LocalModelsSettings'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null; document.body.innerHTML = '' })
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const mount = async () => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); act(() => root!.render(<LocalModelsSettings />)); await settle() }
const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === text)

describe('local models settings', () => {
  let api: Record<string, unknown>
  let list: { available: boolean; installed: Array<{ name: string; size: number }> }
  let progressCb: (e: { id: string; status: string; percent: number | null; completed: number; total: number }) => void
  beforeEach(() => {
    list = { available: true, installed: [{ name: 'llama3.1:latest', size: 4.9e9 }] }
    api = {
      listLocalModels: vi.fn(async () => list),
      downloadModel: vi.fn((_id: string) => new Promise(() => {})),
      cancelModelDownload: vi.fn(async () => true),
      removeModel: vi.fn(async () => ({ ok: true })),
      onModelProgress: vi.fn((cb: typeof progressCb) => { progressCb = cb; return () => {} }),
    }
    ;(window as unknown as { aiLookup: unknown }).aiLookup = api
  })

  it('shows installed size, total, and recommended models with exact size, memory estimate and license', async () => {
    await mount()
    const text = document.body.textContent!
    expect(text).toContain('llama3.1:latest')
    expect(text).toContain('4.9 GB')
    expect(text).toContain('Installed models use 4.9 GB')
    expect(text).toContain('Download 2.0 GB')
    expect(text).toContain('(estimate)')
    expect(text).toContain('Apache-2.0')
    expect(text).not.toContain('Llama 3.1 8B') // installed, so not offered again
  })

  it('needs confirmation before removing, and names the model', async () => {
    await mount()
    await act(async () => { button('Remove')!.click() })
    expect(api.removeModel).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Remove llama3.1:latest?')
    expect(document.body.textContent).toContain('only removes it from Ollama')
    await act(async () => { [...document.querySelectorAll('button')].filter((b) => b.textContent === 'Remove').pop()!.click() })
    await settle()
    expect(api.removeModel).toHaveBeenCalledWith('llama3.1:latest')
  })

  it('shows percent progress and a Cancel that cancels', async () => {
    await mount()
    await act(async () => { (document.querySelector('[aria-label="Download Llama 3.2 3B"]') as HTMLButtonElement).click() })
    expect(api.downloadModel).toHaveBeenCalledWith('llama3.2:3b')
    act(() => progressCb({ id: 'llama3.2:3b', status: 'pulling', percent: 42, completed: 42, total: 100 }))
    expect(document.body.textContent).toContain('42%')
    expect(document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('42')
    await act(async () => { button('Cancel')!.click() })
    expect(api.cancelModelDownload).toHaveBeenCalledWith('llama3.2:3b')
  })

  it('says plainly when Ollama is not running', async () => {
    list = { available: false, installed: [] }
    await mount()
    expect(document.body.textContent).toContain("Ollama isn't running")
    expect(button('Download')).toBeUndefined()
  })

  it('renders nothing on a device without the API', async () => {
    delete api.listLocalModels; delete api.downloadModel
    await mount()
    expect(document.body.textContent).toBe('')
  })
})
