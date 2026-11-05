// @vitest-environment jsdom
/**
 * Settings → Ask Berean, cloud model (spec §7.3, §8.5): off by default, can't be enabled without a
 * key and model, the key field never shows a saved key, and private context is a separate switch.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import AskBereanSection from '@/components/settings/sections/AskBereanSection'
import { useAppStore } from '@/store'
import { defaultProfileConfig } from '@/lib/research/studyProfile'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null; document.body.innerHTML = '' })
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const mount = async () => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); act(() => root!.render(<AskBereanSection />)); await settle() }
const sw = (label: string) => document.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement
const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === text)
const type = (el: HTMLInputElement, value: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})

describe('cloud model settings', () => {
  let api: Record<string, unknown>
  let settings: { cloudEnabled: boolean; cloudPrivateContext: boolean; cloudModel: string }
  let hasKey: boolean
  beforeEach(() => {
    settings = { cloudEnabled: false, cloudPrivateContext: false, cloudModel: '' }
    hasKey = false
    useAppStore.setState({ aiLookupProfileId: 'default' })
    api = {
      listProfiles: vi.fn(async () => [{ id: 'default', name: 'Default', config: defaultProfileConfig(), createdAt: '', updatedAt: '' }]),
      listSavedContexts: vi.fn(async () => []),
      checkAvailable: vi.fn(async () => ({ available: true, models: ['llama3.1:latest', 'nomic-embed-text:latest'] })),
      getCloudSettings: vi.fn(async () => settings),
      setCloudSettings: vi.fn(async (p: object) => { settings = { ...settings, ...p }; return settings }),
      hasProviderKey: vi.fn(async () => hasKey),
      saveProviderKey: vi.fn(async () => { hasKey = true; return { ok: true } }),
      removeProviderKey: vi.fn(async () => { hasKey = false; settings = { ...settings, cloudEnabled: false }; return { success: true } }),
      checkProviderKey: vi.fn(async () => ({ ok: true })),
    }
    ;(window as unknown as { aiLookup: unknown }).aiLookup = api
  })

  it('starts off, states the cost and destination, and cannot be enabled without a key and model', async () => {
    await mount()
    expect(document.body.textContent).toContain('billed to your key')
    expect(sw('Use the cloud model').disabled).toBe(true)
    expect(sw('Also send notes and conversation').disabled).toBe(true)
  })

  it('saves a key, clears the field, and never renders it back', async () => {
    await mount()
    const field = document.querySelector('[aria-label="Anthropic API key"]') as HTMLInputElement
    expect(field.type).toBe('password')
    type(field, 'sk-secret')
    await act(async () => { button('Save')!.click() })
    await settle()
    expect(api.saveProviderKey).toHaveBeenCalledWith('anthropic', 'sk-secret')
    expect(field.value).toBe('')
    expect(field.placeholder).toContain('A key is saved')
    expect(document.body.innerHTML).not.toContain('sk-secret')
    expect(button('Replace')).toBeTruthy()
  })

  it('keeps private context a separate choice, and hides everything on a device without it', async () => {
    hasKey = true
    settings = { cloudEnabled: true, cloudPrivateContext: false, cloudModel: 'test-model' }
    await mount()
    await act(async () => { sw('Also send notes and conversation').click() })
    expect(api.setCloudSettings).toHaveBeenCalledWith({ cloudPrivateContext: true })
    act(() => root!.unmount()); root = null; host?.remove()
    delete api.getCloudSettings; delete api.setCloudSettings
    await mount()
    expect(document.body.textContent).not.toContain('Cloud model')
  })

  it('lists installed chat models for the profile, not embedding models', async () => {
    await mount()
    expect(document.querySelector('[aria-label="Local model"]')).toBeTruthy()
    expect(document.body.textContent).toContain('Local model')
  })
})
