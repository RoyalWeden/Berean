// @vitest-environment jsdom
/** Ask Berean modes and study profiles on iPhone: the armed composer shows the active profile and
 *  opens an options page (profile, mode, Search in, saved research). Without an AI model the
 *  modes are disabled rows with the reason; profile and collections reach `aiLookup.query`; the
 *  plain message composer is unchanged (AI is armed per send). The profile editor reaches the
 *  same fields as the Mac. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { makeContext, migratedUserDb } from '@/platform/db/__tests__/testDb'
import { createAiChatsService } from '@/platform/services/aiChatsService'
import { SheetHost } from '../../primitives/Sheet'
import { PopoverMenuHost } from '../../primitives/PopoverMenu'
import { typeText } from '@/components/ailookup/__tests__/composerTestUtils'
import { useAppStore } from '@/store'
import { defaultProfileConfig, type StudyProfile } from '@/lib/research/studyProfile'
import { NO_MODEL_REASON } from '@/components/ailookup/chatModes'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('@capacitor/haptics', () => ({ Haptics: { impact: () => Promise.resolve(), selectionChanged: () => Promise.resolve(), notification: () => Promise.resolve() }, ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' }, NotificationType: { Success: 'SUCCESS', Warning: 'WARNING' } }))
const { ChatPage } = await import('../ChatPage')
const { AskBereanSettingsPage } = await import('../../settings/AskBereanSettingsPage')
Element.prototype.scrollIntoView ??= function scrollIntoView() {}

const prof = (id: string, name: string, over = {}): StudyProfile => ({ id, name, config: { ...defaultProfileConfig(), ...over }, createdAt: '', updatedAt: '' })
let svc: ReturnType<typeof createAiChatsService>
let profiles: StudyProfile[]
let models: string[]
const query = vi.fn()
const updateProfile = vi.fn()
const answer = { results: [], visibleCount: 0, keywords: [], related: [], errorCode: 'NO_MODEL_INSTALLED', partial: false }

beforeEach(async () => {
  try { localStorage.clear() } catch { /* */ }
  let n = 0
  svc = createAiChatsService(makeContext({ userDb: await migratedUserDb(), uuid: () => `chat-${++n}` }))
  profiles = [prof('default', 'Default'), prof('p2', 'Torah', { collections: ['canon', 'lxx'], defaultCommentary: true })]
  models = []
  query.mockReset(); query.mockResolvedValue(answer)
  updateProfile.mockReset()
  updateProfile.mockImplementation(async (id: string, patch: { config?: object }) => { const p = profiles.find((x) => x.id === id)!; p.config = { ...p.config, ...(patch.config ?? {}) }; return p })
  useAppStore.setState({ aiLookupProfileId: 'default', aiLookupCollections: ['canon', 'apocrypha'], aiLookupCommentaryOn: false, aiLookupAgenticOn: false })
  ;(window as unknown as { aiLookup: unknown }).aiLookup = {
    checkAvailable: async () => ({ available: true, models }),
    query,
    listProfiles: async () => profiles,
    listSavedContexts: async () => [{ id: 's1', title: 'Grace study', content: { topic: 'grace', refs: ['TIT 2:11'], strongs: ['G5485'], summary: '' }, createdAt: '', updatedAt: '' }],
    updateProfile, createProfile: vi.fn(), duplicateProfile: vi.fn(), deleteProfile: vi.fn(), deleteSavedContext: vi.fn(),
    listChats: () => svc.listChats(), getChat: (id: string) => svc.getChat(id), deleteChat: (id: string) => svc.deleteChat(id),
    upsertMessages: (i: never) => svc.upsertMessages(i), renameChat: (id: string, t: string) => svc.renameChat(id, t),
    queryMessages: (q: never) => svc.queryMessages(q), listDays: () => svc.listDays(),
    onChatsChanged: () => () => {}, onProgress: () => {}, onPartial: () => {},
  }
})
let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null })
const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 5)) })
async function mount(el: React.ReactElement) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  act(() => root!.render(<SheetHost>{el}<PopoverMenuHost /></SheetHost>))
  await settle()
  return host
}
const field = (h: HTMLElement) => h.querySelector<HTMLElement>('.m-chat-input [role="textbox"]')!
const click = (el: Element | null | undefined) => { act(() => (el as HTMLElement).click()) }
// The pushed options page's back button is the last one in the stack.
const back = (h: HTMLElement) => click([...h.querySelectorAll('.mobile-back')].pop())
const arm = async (h: HTMLElement) => { click(h.querySelector('.m-chat-ask')); await settle() }
const openOptions = async (h: HTMLElement) => { await arm(h); click(h.querySelector('.m-chat-ask-options')); await settle() }
const rowByTitle = (h: HTMLElement, title: string) => [...h.querySelectorAll<HTMLElement>('.mobile-row')].find((r) => r.querySelector('.mobile-row-title')?.textContent === title)!
async function send(h: HTMLElement, text: string) {
  typeText(field(h), text)
  click(h.querySelector('.m-chat-send'))
  await settle()
}

describe('Ask Berean options (iPhone composer)', () => {
  it('arming shows the active profile and scope; plain sends stay plain', async () => {
    const h = await mount(<ChatPage newMessageToken={1} />)
    expect(h.querySelector('.m-chat-ask-options')).toBeNull()
    await send(h, 'a quick note')
    expect(query).not.toHaveBeenCalled()
    await arm(h)
    expect(h.querySelector('.m-chat-ask-options')!.textContent).toContain('Default · 2 collections')
  })

  it('the options page offers profile, Search in and saved research; modes are disabled with the reason when there is no model', async () => {
    const h = await mount(<ChatPage newMessageToken={1} />)
    await openOptions(h)
    const text = h.textContent ?? ''
    for (const t of ['Study Profile', 'Torah', 'Search In', 'Septuagint (Brenton English)', 'Use Saved Research', 'Grace study', 'Manage Profiles']) expect(text).toContain(t)
    expect(text).toContain(NO_MODEL_REASON)
    const disabled = [...h.querySelectorAll('.m-ask-unavailable')]
    expect(disabled.map((d) => d.querySelector('.mobile-row-title')!.textContent)).toEqual(['Commentary', 'Deep Search'])
    expect(disabled.every((d) => d.getAttribute('aria-disabled') === 'true' && !d.querySelector('[role="switch"]'))).toBe(true)
  })

  it('with a model the modes are switches that reach the query', async () => {
    models = ['qwen3:8b']
    const h = await mount(<ChatPage newMessageToken={1} />)
    await openOptions(h)
    expect(h.querySelector('.m-ask-unavailable')).toBeNull()
    click(h.querySelector('[role="switch"][aria-label="Commentary"]'))
    expect(useAppStore.getState().aiLookupCommentaryOn).toBe(true)
    back(h)
    await settle()
    await send(h, 'what is grace')
    expect(query.mock.calls[0][1]).toMatchObject({ commentary: true, agentic: false })
  })

  it('without a model an armed send is research only even when the profile defaults to Commentary', async () => {
    useAppStore.setState({ aiLookupCommentaryOn: true, aiLookupAgenticOn: true })
    const h = await mount(<ChatPage newMessageToken={1} />)
    await arm(h)
    await send(h, 'what is grace')
    expect(query.mock.calls[0][1]).toMatchObject({ commentary: false, agentic: false })
  })

  it('switching profile changes the query options, and a collection change reaches the query', async () => {
    const h = await mount(<ChatPage newMessageToken={1} />)
    await openOptions(h)
    click(rowByTitle(h, 'Torah'))
    expect(useAppStore.getState().aiLookupProfileId).toBe('p2')
    expect(useAppStore.getState().aiLookupCollections).toEqual(['canon', 'lxx'])
    click(h.querySelector('[role="switch"][aria-label="Apocrypha / Deuterocanon (KJV 1611)"]'))
    expect(useAppStore.getState().aiLookupCollections).toEqual(['canon', 'lxx', 'apocrypha'])
    back(h)
    await settle()
    await send(h, 'sabbath rest')
    expect(query.mock.calls[0][1]).toMatchObject({ profileId: 'p2', collections: ['canon', 'lxx', 'apocrypha'] })
  })

  it('saved research chosen in the options is used by the next armed send only', async () => {
    const h = await mount(<ChatPage newMessageToken={1} />)
    await openOptions(h)
    click(rowByTitle(h, 'Grace study'))
    back(h)
    await settle()
    expect(h.querySelector('.m-chat-ask-options')!.textContent).toContain('Saved research')
    await send(h, 'what is grace')
    expect(query.mock.calls[0][1]).toMatchObject({ savedContextId: 's1' })
    await arm(h)
    await send(h, 'and mercy')
    expect(query.mock.calls[1][1].savedContextId).toBeUndefined()
  })
})

describe('Settings → Ask Berean (iPhone)', () => {
  it('reaches the profile fields, shows modes disabled with the reason, and hides Mac-only pieces', async () => {
    useAppStore.setState({ aiLookupProfileId: 'p2' })
    const h = await mount(<AskBereanSettingsPage />)
    const text = h.textContent ?? ''
    for (const t of ['Study Profile', 'Name', 'New Chats Start With', 'Search In', 'Your Notes', 'Names in Berean', 'Research Focus', 'Interpretive Approach', 'Saved Research', 'Grace study']) expect(text).toContain(t)
    expect(text).toContain(NO_MODEL_REASON)
    expect(text).not.toMatch(/cloud|local model|api key/i)
    const focus = h.querySelector<HTMLTextAreaElement>('textarea[aria-label="Research focus"]')!
    act(() => { focus.value = 'Prefer Torah'; focus.dispatchEvent(new Event('input', { bubbles: true })); focus.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
    focus.blur()
    await settle()
    expect(updateProfile).toHaveBeenCalledWith('p2', { config: { researchInstructions: 'Prefer Torah' } })
  })

  it('adding a name alias saves it and updates the reply display names', async () => {
    const h = await mount(<AskBereanSettingsPage />)
    const set = (label: string, v: string) => {
      const el = h.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
      act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) })
    }
    set('Name as written', 'Jesus'); set('Preferred name', 'Yeshua')
    click([...h.querySelectorAll('button')].find((b) => b.textContent === 'Add'))
    await settle()
    expect(updateProfile).toHaveBeenCalledWith('default', { config: { displayAliases: [{ from: 'Jesus', to: 'Yeshua' }] } })
    expect(useAppStore.getState().aiLookupDisplayAliases).toEqual([{ from: 'Jesus', to: 'Yeshua' }])
  })
})
