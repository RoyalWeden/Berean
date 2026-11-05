// @vitest-environment jsdom
/**
 * Study profiles and saved research in the UI (spec §7.1–7.2): Settings → Ask Berean switches,
 * edits and deletes (with confirmation) profiles; display names are marked in Berean's prose and
 * never applied inside quotations; "Save research" saves a reply's verified refs and ids.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import AskBereanSection from '@/components/settings/sections/AskBereanSection'
import { ChatMarkdown } from '../ChatMarkdown'
import { ChatNavContext } from '../chatNav'
import { useAppStore } from '@/store'
import { defaultProfileConfig, type StudyProfile } from '@/lib/research/studyProfile'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null; document.body.innerHTML = '' })
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const mount = (node: React.ReactNode) => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); act(() => root!.render(<ChatNavContext.Provider value={vi.fn()}>{node}</ChatNavContext.Provider>)) }

const prof = (id: string, name: string, over = {}): StudyProfile => ({ id, name, config: { ...defaultProfileConfig(), ...over }, createdAt: '', updatedAt: '' })

describe('Settings → Ask Berean', () => {
  let profiles: StudyProfile[]
  beforeEach(() => {
    profiles = [prof('default', 'Default'), prof('p2', 'Torah', { collections: ['canon'], defaultCommentary: true, displayAliases: [{ from: 'Jesus', to: 'Yeshua' }] })]
    useAppStore.setState({ aiLookupProfileId: 'default', aiLookupCollections: ['canon', 'apocrypha'], aiLookupCommentaryOn: false })
    ;(window as unknown as { aiLookup: unknown }).aiLookup = {
      listProfiles: vi.fn(async () => profiles),
      listSavedContexts: vi.fn(async () => [{ id: 'c1', title: 'Grace study', content: { topic: 'grace', refs: ['TIT 2:11'], strongs: ['G5485'], summary: '' }, createdAt: '', updatedAt: '' }]),
      updateProfile: vi.fn(async (id: string, patch: { config?: object }) => { const p = profiles.find((x) => x.id === id)!; p.config = { ...p.config, ...(patch.config ?? {}) }; return p }),
      deleteProfile: vi.fn(async (id: string) => { profiles = profiles.filter((p) => p.id !== id); return { success: true } }),
      createProfile: vi.fn(), duplicateProfile: vi.fn(), deleteSavedContext: vi.fn(async () => ({ success: true })),
    }
  })

  it('shows the Default profile without a Delete button, and the saved research list', async () => {
    mount(<AskBereanSection />)
    await settle()
    expect(document.body.textContent).toContain('New chats start with')
    expect([...document.querySelectorAll('button')].some((b) => b.textContent === 'Delete')).toBe(false)
    expect(document.body.textContent).toContain('Grace study')
  })

  it('editing collections saves to the profile and updates the composer scope', async () => {
    mount(<AskBereanSection />)
    await settle()
    const pseudo = [...document.querySelectorAll('label')].find((l) => l.textContent?.startsWith('Septuagint'))!.querySelector('input')!
    act(() => pseudo.click())
    await settle()
    expect((window.aiLookup.updateProfile as ReturnType<typeof vi.fn>).mock.calls[0][1].config.collections).toContain('lxx')
    expect(useAppStore.getState().aiLookupCollections).toContain('lxx')
  })

  it('a non-default profile can be deleted only after confirming; this device falls back to Default', async () => {
    useAppStore.setState({ aiLookupProfileId: 'p2' })
    mount(<AskBereanSection />)
    await settle()
    act(() => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Delete')!.click())
    expect(window.aiLookup.deleteProfile).not.toHaveBeenCalled()
    const confirm = [...document.querySelectorAll('button')].filter((b) => b.textContent === 'Delete').at(-1)!
    act(() => confirm.click())
    await settle()
    expect(window.aiLookup.deleteProfile).toHaveBeenCalledWith('p2')
    expect(useAppStore.getState().aiLookupProfileId).toBe('default')
  })
})

describe('display names in replies (scenario 19)', () => {
  it('marks substitutions in prose and leaves quotations and blockquotes as written', () => {
    mount(<ChatMarkdown text={'Jesus taught this; the verse says “Jesus wept”.\n\n> Jesus answered'} aliases={[{ from: 'Jesus', to: 'Yeshua' }]} />)
    const marked = [...document.querySelectorAll('.chat-alias')]
    expect(marked.map((m) => m.textContent)).toEqual(['Yeshua'])
    expect(marked[0].getAttribute('title')).toMatch(/written “Jesus”/)
    expect(document.body.textContent).toContain('“Jesus wept”')
    expect(document.querySelector('blockquote')!.textContent).toBe('Jesus answered')
  })
})
