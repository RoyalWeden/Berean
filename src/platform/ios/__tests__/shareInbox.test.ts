/** DATA-SHARE-001 — the Share Extension inbox never loses or duplicates a shared item. */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const inbox = { items: [] as Array<Record<string, unknown>>, acked: [] as string[] }
const settingsStore = new Map<string, unknown>()
const createNote = vi.fn(async (d: { title: string }) => ({ success: true, note: { id: `note-${d.title}` } }))

vi.mock('../plugins', () => ({
  BereanShareInbox: {
    take: async () => ({ items: inbox.items.filter((i) => !inbox.acked.includes(String(i.id))) }),
    readFile: async () => ({ base64: '', bytes: 0 }),
    ack: async ({ ids }: { ids: string[] }) => { inbox.acked.push(...ids) },
  },
}))
vi.mock('../services', () => ({
  iosServices: () => ({ notes: { create: createNote }, settings: { get: async (k: string) => settingsStore.get(k) ?? null, set: async (k: string, v: unknown) => { settingsStore.set(k, v) } }, pdf: {} }),
  iosServiceContext: () => ({ uuid: () => 'u', now: () => 0 }),
}))
vi.mock('../deepLinks', () => ({ openIosDeepLink: vi.fn() }))
vi.mock('@capacitor/filesystem', () => ({ Filesystem: {}, Directory: {} }))

import { drainShareInbox } from '../shareInbox'

beforeEach(() => { inbox.items = []; inbox.acked = []; settingsStore.clear(); createNote.mockClear() })

describe('drainShareInbox', () => {
  it('handles each item once and acknowledges it only after handling', async () => {
    inbox.items = [{ id: 'a', kind: 'text', text: 'A thought about grace\nmore' }, { id: 'b', kind: 'url', url: 'https://example.org/x' }]
    expect(await drainShareInbox()).toBe(2)
    expect(createNote).toHaveBeenCalledTimes(2)
    expect(inbox.acked).toEqual(['a', 'b'])
    expect(await drainShareInbox()).toBe(0)
    expect(createNote).toHaveBeenCalledTimes(2)
  })

  it('a failure leaves the item in the inbox for the next drain (not acked)', async () => {
    inbox.items = [{ id: 'x', kind: 'text', text: 'will fail once' }]
    createNote.mockRejectedValueOnce(new Error('db busy'))
    await drainShareInbox()
    expect(inbox.acked).toEqual([])
    await drainShareInbox()
    expect(inbox.acked).toEqual(['x'])
    expect(createNote).toHaveBeenCalledTimes(2)
  })

  it('an item handled before a kill (not yet acked) is not handled twice', async () => {
    inbox.items = [{ id: 'k', kind: 'text', text: 'note body' }]
    settingsStore.set('shareInboxHandled', ['k'])   // handled, then the app died before ack
    await drainShareInbox()
    expect(createNote).not.toHaveBeenCalled()
    expect(inbox.acked).toEqual(['k'])
  })

  it('an item that keeps failing is never acknowledged (never dropped) — it waits for the next launch', async () => {
    inbox.items = [{ id: 'f', kind: 'text', text: 'keeps failing' }]
    createNote.mockRejectedValue(new Error('db unavailable'))
    for (let i = 0; i < 6; i++) await drainShareInbox()
    expect(inbox.acked).toEqual([])
    expect(createNote).toHaveBeenCalledTimes(3)   // then no more retries this session
    createNote.mockReset()
  })

  it('shared text becomes a note with a stable id, so a kill between writing and recording it cannot duplicate it', async () => {
    createNote.mockImplementation(async (d: { title: string }) => ({ success: true, note: { id: `note-${d.title}` } }))
    inbox.items = [{ id: 'dup-1', kind: 'text', text: 'once only' }]
    await drainShareInbox()
    expect(createNote.mock.calls[0][0]).toMatchObject({ id: 'share-dup-1' })
  })
})
