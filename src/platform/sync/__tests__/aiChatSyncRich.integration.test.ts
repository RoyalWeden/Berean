import { describe, it, expect, beforeEach } from 'vitest'
import { migratedUserDb } from '../../db/__tests__/testDb'
import { createServices, type Services } from '../../services'
import { consoleLogger, createServiceEvents, defaultUuid, type ServiceContext } from '../../services/context'
import { BEREAN_SCHEMA_VERSION } from '../../db/bereanMigrations'
import { SyncEngine } from '../engine'
import { MemoryCloud, MemorySyncStore } from '../stores/memorySyncStore'
import type { DatabaseAdapter } from '../../db/DatabaseAdapter'

/**
 * Berean Chat iCloud audit (2026-10-18 redesign, brief §8B). Formatting is Markdown inside the
 * message's `content`, so it travels inside the ordinary `ai_chat` row: these check that rich
 * content (tables, code, refs, <u>), ordering across time-zone offsets, duplicates on repeated
 * syncs, a failed write retried, edits, sequential deletes, large messages and an offline write
 * that survives an app restart all behave. (MemoryCloud stands in for iCloud Drive — this is not
 * a real two-device cloud test.)
 */
interface Device { name: string; services: Services; engine: SyncEngine; store: MemorySyncStore; db: DatabaseAdapter; events: ReturnType<typeof createServiceEvents> }

let clock = 1_700_000_000_000
const tick = (ms = 1000) => { clock += ms; return clock }
let cloud: MemoryCloud

async function openEngine(name: string, db: DatabaseAdapter, store: MemorySyncStore, events: ReturnType<typeof createServiceEvents>, platform: 'darwin' | 'ios') {
  const engine = await SyncEngine.open({
    db, store, events, deviceId: name, deviceName: name, platform, appVersion: '0.7.3', schema: BEREAN_SCHEMA_VERSION,
    log: { info: () => {}, warn: () => {}, error: () => {} }, now: () => clock, uuid: defaultUuid,
  })
  engine.start()
  return engine
}
async function makeDevice(name: string, platform: 'darwin' | 'ios'): Promise<Device> {
  const db = await migratedUserDb(name)
  const events = createServiceEvents()
  const ctx: ServiceContext = {
    userDb: db, textDb: async () => null, lexiconDb: async () => { throw new Error('n/a') }, dataDb: async () => null,
    events, now: () => clock, uuid: defaultUuid, isDev: true, log: consoleLogger,
  }
  const services = createServices(ctx)
  const store = cloud.device(name)
  MemorySyncStore.all.add(store)
  return { name, services, engine: await openEngine(name, db, store, events, platform), store, db, events }
}
async function syncAll(...devices: Device[]) {
  for (const d of devices) await d.engine.sync()
  for (const d of devices) await d.engine.sync()
}
const note = (id: string, content: string, createdAt = new Date(tick(10)).toISOString()) => ({ id, role: 'user' as const, kind: 'note' as const, content, createdAt })

const RICH = [
  '**Grace** teaches us — Titus 2:11-14 and G5485, <u>denying ungodliness</u>',
  '',
  '| Passage | Theme |',
  '| :-- | --: |',
  '| Exodus 20:8 | Sabbath |',
  '',
  '```',
  'not **bold** inside code',
  '  indented',
  '```',
  '',
  '- first',
  '1. second',
  '> Ps 23:1',
].join('\n')

let mac: Device
let phone: Device
beforeEach(async () => {
  clock = 1_700_000_000_000
  cloud = new MemoryCloud()
  MemorySyncStore.all.clear()
  mac = await makeDevice('mac', 'darwin')
  phone = await makeDevice('phone', 'ios')
})

describe('Berean Chat sync — rich content and integrity', () => {
  it('formatted markdown (table, code, refs, <u>) arrives byte-for-byte', async () => {
    const chat = await mac.services.aiChats.upsertMessages({ messages: [note('r1', RICH)] })
    await syncAll(mac, phone)
    const there = await phone.services.aiChats.getChat(chat.id)
    expect(there!.messages[0].content).toBe(RICH)
    // Search on the other device still finds formatted text.
    const hits = await phone.services.aiChats.queryMessages({ search: 'denying ungodliness' })
    expect(hits.items.map((it) => it.message.id)).toEqual(['r1'])
  })

  it('orders messages by instant even when timestamps carry different time-zone offsets', async () => {
    const chat = await mac.services.aiChats.upsertMessages({ messages: [note('a', 'a', '2026-10-18T10:00:00.000Z')] })
    await syncAll(mac, phone)
    mac.store.setOnline(false); phone.store.setOnline(false)
    // 09:30Z written as 11:30+02:00 on the phone; 09:45Z on the Mac — merged order must be by instant.
    await phone.services.aiChats.upsertMessages({ chatId: chat.id, messages: [note('p', 'p', '2026-10-18T11:30:00.000+02:00')] })
    await mac.services.aiChats.upsertMessages({ chatId: chat.id, messages: [note('m', 'm', '2026-10-18T09:45:00.000Z')] })
    await mac.engine.sync(); await phone.engine.sync()
    mac.store.setOnline(true); phone.store.setOnline(true)
    await syncAll(mac, phone)
    const ids = (await mac.services.aiChats.getChat(chat.id))!.messages.map((m) => m.id)
    expect(ids).toEqual(['p', 'm', 'a'])
    expect((await phone.services.aiChats.getChat(chat.id))!.messages.map((m) => m.id)).toEqual(ids)
  })

  it('repeated syncs never duplicate messages or conversations', async () => {
    const chat = await phone.services.aiChats.upsertMessages({ messages: [note('x', 'once')] })
    for (let i = 0; i < 4; i++) await syncAll(mac, phone)
    const there = await mac.services.aiChats.getChat(chat.id)
    expect(there!.messages.map((m) => m.id)).toEqual(['x'])
    expect((await mac.services.aiChats.listChats()).length).toBe(1)
  })

  it('a failed upload is retried and lands intact', async () => {
    mac.store.failWrites = 2
    const chat = await mac.services.aiChats.upsertMessages({ messages: [note('f', RICH)] })
    await mac.engine.sync().catch(() => {})
    await mac.engine.sync().catch(() => {})
    await syncAll(mac, phone)
    expect((await phone.services.aiChats.getChat(chat.id))!.messages.map((m) => m.content)).toEqual([RICH])
  })

  it('an edit (later editedAt) and a sequential message delete propagate', async () => {
    const chat = await mac.services.aiChats.upsertMessages({ messages: [note('e', 'draft wording'), note('d', 'delete me')] })
    await syncAll(mac, phone)
    tick(); await phone.services.aiChats.upsertMessages({ chatId: chat.id, messages: [{ ...note('e', '**final** wording'), editedAt: new Date(tick()).toISOString() }] })
    await syncAll(mac, phone)
    tick(); await mac.services.aiChats.upsertMessages({ chatId: chat.id, messages: [], removeIds: ['d'] })
    await syncAll(mac, phone)
    for (const d of [mac, phone]) {
      const msgs = (await d.services.aiChats.getChat(chat.id))!.messages
      expect(msgs.map((m) => [m.id, m.content])).toEqual([['e', '**final** wording']])
    }
  })

  it('a very large message (≈300 KB, long table) is not truncated', async () => {
    const rows = Array.from({ length: 6000 }, (_, i) => `| Genesis ${(i % 50) + 1}:${(i % 30) + 1} | row ${i} with some text |`)
    const big = ['| Ref | Note |', '| --- | --- |', ...rows].join('\n')
    expect(big.length).toBeGreaterThan(250_000)
    const chat = await mac.services.aiChats.upsertMessages({ messages: [note('big', big)] })
    await syncAll(mac, phone)
    expect((await phone.services.aiChats.getChat(chat.id))!.messages[0].content).toBe(big)
  })

  it('a message written offline survives an app restart and uploads on reconnect', async () => {
    const chat = await phone.services.aiChats.upsertMessages({ messages: [note('o0', 'start')] })
    await syncAll(mac, phone)
    phone.store.setOnline(false)
    await phone.services.aiChats.upsertMessages({ chatId: chat.id, messages: [note('o1', 'typed on the train')] })
    await phone.engine.sync().catch(() => {})
    // Quit and relaunch the app while still offline.
    phone.engine.stop()
    phone.engine = await openEngine('phone', phone.db, phone.store, phone.events, 'ios')
    phone.store.setOnline(true)
    await syncAll(mac, phone)
    expect((await mac.services.aiChats.getChat(chat.id))!.messages.map((m) => m.id)).toEqual(['o0', 'o1'])
  })

  it('legacy rows (no ids, plain text) stay readable after syncing', async () => {
    const legacy = JSON.stringify([{ role: 'user', content: 'Where is Revelation 9:6?', createdAt: '2026-08-14T00:56:48.328Z' }])
    await mac.db.run('INSERT INTO ai_chats (id, title, messages, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', ['leg', 'Legacy', legacy, '2026-08-14T00:56:48.328Z', '2026-08-14T00:56:48.328Z'])
    // A legacy row inserted under the engine is published by the next local change to it.
    tick(); await mac.services.aiChats.renameChat('leg', 'Legacy question')
    await syncAll(mac, phone)
    const there = await phone.services.aiChats.getChat('leg')
    expect(there!.title).toBe('Legacy question')
    // Legacy user turns were Ask Berean questions.
    expect(there!.messages[0]).toMatchObject({ role: 'user', kind: 'ai-request', content: 'Where is Revelation 9:6?' })
    expect(there!.messages[0].id).toBeTruthy()
  })
})

describe('Berean Chat organisation over iCloud (2026-10-18)', () => {
  it('a pin and a folder made on one device arrive on the other; a folder rename and removal follow', async () => {
    const a = await mac.services.aiChats.upsertMessages({ messages: [note('o1', 'Feast notes')] })
    const b = await mac.services.aiChats.upsertMessages({ messages: [note('o2', 'Sabbath notes')] })
    await syncAll(mac, phone)
    tick(); await phone.services.aiChats.organizeChat(a.id, { pinned: true })
    tick(); await mac.services.aiChats.organizeChat(b.id, { folder: '  Torah   study ' })
    await syncAll(mac, phone)
    for (const d of [mac, phone]) {
      const list = await d.services.aiChats.listChats()
      expect(list.find((s) => s.id === a.id)!.pinnedAt).toBeTruthy()
      expect(list.find((s) => s.id === b.id)!.folder).toBe('Torah study')
    }
    tick(); await phone.services.aiChats.renameFolder('Torah study', 'Feasts')
    await syncAll(mac, phone)
    expect((await mac.services.aiChats.listChats()).find((s) => s.id === b.id)!.folder).toBe('Feasts')
    tick(); await mac.services.aiChats.renameFolder('Feasts', null)
    await syncAll(mac, phone)
    const kept = (await phone.services.aiChats.listChats()).find((s) => s.id === b.id)!
    expect(kept.folder).toBeNull()                      // the conversation stays, just unfiled
    expect((await phone.services.aiChats.getChat(b.id))!.messages.map((m) => m.content)).toEqual(['Sabbath notes'])
  })

  it('a pin on one device and a new message on the other both survive (per-field merge)', async () => {
    const a = await mac.services.aiChats.upsertMessages({ messages: [note('p1', 'first')] })
    await syncAll(mac, phone)
    tick(); await mac.services.aiChats.organizeChat(a.id, { pinned: true })
    tick(); await phone.services.aiChats.upsertMessages({ chatId: a.id, messages: [note('p2', 'second')] })
    await syncAll(mac, phone)
    for (const d of [mac, phone]) {
      const s = (await d.services.aiChats.listChats()).find((x) => x.id === a.id)!
      expect(s.pinnedAt).toBeTruthy()
      expect((await d.services.aiChats.getChat(a.id))!.messages.map((m) => m.content)).toEqual(['first', 'second'])
    }
  })

  it('messages with no conversation, written on both devices, end up in ONE hidden row on both', async () => {
    await mac.services.aiChats.upsertMessages({ chatId: 'berean-unfiled', messages: [note('u1', 'from the Mac')] })
    await phone.services.aiChats.upsertMessages({ chatId: 'berean-unfiled', messages: [note('u2', 'from the iPhone')] })
    await syncAll(mac, phone)
    for (const d of [mac, phone]) {
      expect((await d.services.aiChats.listChats()).map((s) => s.id)).not.toContain('berean-unfiled')
      const page = await d.services.aiChats.queryMessages({})
      expect(page.items.filter((it) => it.chatId === 'berean-unfiled').map((it) => it.message.content).sort()).toEqual(['from the Mac', 'from the iPhone'])
      expect(page.items.every((it) => it.chatId !== 'berean-unfiled' || it.chatTitle === 'Unfiled')).toBe(true)
    }
  })
})
