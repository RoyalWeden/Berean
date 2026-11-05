// @vitest-environment jsdom
/** Onboarding Ask Berean step (spec §8.3): optional, nothing downloads until Download, hidden without the API. */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import StepAskBerean, { hasModelSetup } from '../OnboardingModelStep'
import Onboarding from '../Onboarding'
import { useAppStore } from '@/store'
import { RECOMMENDED_MODELS } from '@/lib/research/modelCatalog'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null; document.body.innerHTML = '' })
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const mount = async (el: React.ReactElement) => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); act(() => root!.render(el)); await settle() }
const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === text)
const MODEL = RECOMMENDED_MODELS[0]

describe('onboarding Ask Berean step', () => {
  let api: Record<string, unknown>
  let list: { available: boolean; installed: Array<{ name: string; size: number }> }
  let progressCb: (e: { id: string; status: string; percent: number | null; completed: number; total: number }) => void
  beforeEach(() => {
    list = { available: true, installed: [] }
    api = {
      listLocalModels: vi.fn(async () => list),
      downloadModel: vi.fn((_id: string) => new Promise(() => {})),
      cancelModelDownload: vi.fn(async () => true),
      onModelProgress: vi.fn((cb: typeof progressCb) => { progressCb = cb; return () => {} }),
    }
    ;(window as unknown as { aiLookup: unknown }).aiLookup = api
  })

  it('offers the recommended model with size, memory, license, and downloads nothing yet', async () => {
    await mount(<StepAskBerean />)
    const text = document.body.textContent!
    expect(text).toContain('works without a model')
    expect(text).toContain(MODEL.label)
    expect(text).toContain('Download 1.9 GB')
    expect(text).toContain('(estimate)')
    expect(text).toContain('Apache-2.0')
    expect(api.downloadModel).not.toHaveBeenCalled()
  })

  it('Skip hides the offer without downloading', async () => {
    await mount(<StepAskBerean />)
    await act(async () => { button('Skip')!.click() })
    expect(api.downloadModel).not.toHaveBeenCalled()
    expect(document.querySelector('[aria-label^="Download"]')).toBeNull()
  })

  it('shows progress after Download and Cancel cancels', async () => {
    await mount(<StepAskBerean />)
    await act(async () => { (document.querySelector(`[aria-label="Download ${MODEL.label}"]`) as HTMLButtonElement).click() })
    expect(api.downloadModel).toHaveBeenCalledWith(MODEL.id)
    act(() => progressCb({ id: MODEL.id, status: 'pulling', percent: 42, completed: 42, total: 100 }))
    expect(document.body.textContent).toContain('42%')
    expect(document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('42')
    await act(async () => { button('Cancel')!.click() })
    expect(api.cancelModelDownload).toHaveBeenCalledWith(MODEL.id)
  })

  it('says Ask Berean still works when Ollama is down', async () => {
    list = { available: false, installed: [] }
    await mount(<StepAskBerean />)
    expect(document.body.textContent).toContain("Ollama isn't running")
    expect(document.body.textContent).toContain('Settings → Ask Berean')
    expect(button('Download')).toBeUndefined()
  })

  it('says so when the model is already installed', async () => {
    list = { available: true, installed: [{ name: MODEL.id, size: 1.9e9 }] }
    await mount(<StepAskBerean />)
    expect(document.body.textContent).toContain('is already installed')
    expect(button('Download')).toBeUndefined()
  })

  it('is hidden from the wizard where the API is absent', async () => {
    delete api.downloadModel
    expect(hasModelSetup()).toBe(false)
    useAppStore.setState({ onboardingOpen: true })
    await mount(<Onboarding />)
    expect(document.body.textContent).toContain('Step 1 of 7')
  })

  it('adds one step to the wizard when the API is present', async () => {
    expect(hasModelSetup()).toBe(true)
    useAppStore.setState({ onboardingOpen: true })
    await mount(<Onboarding />)
    expect(document.body.textContent).toContain('Step 1 of 8')
  })
})
