import { describe, it, expect, beforeEach } from 'vitest'
import { migratedUserDb } from '../../db/__tests__/testDb'
import { createServices, type Services } from '../../services'
import { consoleLogger, createServiceEvents, defaultUuid, type ServiceContext, type DataChange } from '../../services/context'
import { BEREAN_SCHEMA_VERSION } from '../../db/bereanMigrations'
import { SyncEngine } from '../engine'
import { MemoryCloud, MemorySyncStore } from '../stores/memorySyncStore'
import { unionJsonArrayById } from '../merge'

/**
 * Berean Chat over iCloud: every chat write (upsertMessages / renameChat / deleteChat / saveChat)
 * reaches the other device through the `ai_chat` entity, remote applies emit `data:changed`
 * {entity:'ai_chat', remote:true} (what the open chat UI refreshes on), and two devices writing
 * into the same conversation while apart keep BOTH messages (messages merge by id).
 */
interface Device { name: string; services: Services; engine: SyncEngine; store: MemorySyncStore; remote: DataChange[] }

let clock = 1_700_000_000_000
const tick = (ms = 1000) => { clock += ms; return clock }
let cloud: MemoryCloud

async function makeDevice(name: string, platform: 'darwin' | 'ios'): Promise<Device> {
  const db = await migratedUserDb(name)
  const events = createServiceEvents()
  const remote: DataChange[] = []
  events.on('data:changed', (c) => { if (c.remote) remote.push(c) })
  const ctx: ServiceContext = {
    userDb: db, textDb: async () => null, lexiconDb: async () => { throw new Error('n/a') }, dataDb: async () => null,
    events, now: () => clock, uuid: defaultUuid, isDev: true, log: consoleLogger,
  }
  const services = createServices(ctx)
  const store = cloud.device(name)
  MemorySyncStore.all.add(store)
  const engine = await SyncEngine.open({
    db, store, events, deviceId: name, deviceName: name, platform, appVersion: '0.7.3', schema: BEREAN_SCHEMA_VERSION,
    log: { info: () => {}, warn: () => {}, error: () => {} }, now: () => clock, uuid: defaultUuid,
  })
  engine.start()
  return { name, services, engine, store, remote }
}
async function syncAll(...devices: Device[]) {
  for (const d of devices) await d.engine.sync()
  for (const d of devices) await d.engine.sync()
}
const note = (id: string, content: string) => ({ id, role: 'user' as const, kind: 'note' as const, content, createdAt: new Date(tick(10)).toISOString() })

let mac: Device
let phone: Device
beforeEach(async () => {
  clock = 1_700_000_000_000
  cloud = new MemoryCloud()
  MemorySyncStore.all.clear()
  mac = await makeDevice('mac', 'darwin')
  phone = await makeDevice('phone', 'ios')
})

describe('Berean Chat sync (ai_chat)', () => {
  it('a conversation written on the Mac reaches the iPhone, with a remote change event for the UI', async () => {
    const chat = await mac.services.aiChats.upsertMessages({ messages: [note('m1', 'from the Mac')] })
    await syncAll(mac, phone)
    const there = await phone.services.aiChats.getChat(chat.id)
    expect(there!.messages.map((m) => [m.id, m.kind, m.content])).toEqual([['m1', 'note', 'from the Mac']])
    expect(phone.remote.some((c) => c.entity === 'ai_chat' && c.id === chat.id && c.op === 'upsert')).toBe(true)
    expect((await phone.services.aiChats.listChats()).map((c) => c.id)).toEqual([chat.id])
  })

  it('appends, renames and deletes from either device propagate', async () => {
    const chat = await phone.services.aiChats.upsertMessages({ messages: [note('p1', 'from the iPhone')] })
    await syncAll(mac, phone)
    tick(); await mac.services.aiChats.upsertMessages({ chatId: chat.id, messages: [note('m2', 'reply on Mac')] })
    tick(); await mac.services.aiChats.renameChat(chat.id, 'Feasts')
    await syncAll(mac, phone)
    const p = await phone.services.aiChats.getChat(chat.id)
    expect(p!.title).toBe('Feasts')
    expect(p!.messages.map((m) => m.id)).toEqual(['p1', 'm2'])

    tick(); await phone.services.aiChats.deleteChat(chat.id)
    await syncAll(mac, phone)
    expect(await mac.services.aiChats.getChat(chat.id)).toBeNull()
    expect(mac.remote.some((c) => c.entity === 'ai_chat' && c.id === chat.id && c.op === 'delete')).toBe(true)
  })

  // Also guards the service's parsed-message cache: the merged row keeps the phone's own
  // updated_at (bookkeeping merges last-writer-wins), so a cache keyed on updated_at alone served
  // the phone its pre-merge messages.
  it('messages written apart on both devices into one conversation are both kept, same order everywhere', async () => {
    const chat = await mac.services.aiChats.upsertMessages({ messages: [note('base', 'shared start')] })
    await syncAll(mac, phone)
    // Offline: each device adds its own note (nothing crosses yet).
    mac.store.setOnline(false); phone.store.setOnline(false)
    await mac.services.aiChats.upsertMessages({ chatId: chat.id, messages: [note('m', 'typed on the Mac')] })
    await phone.services.aiChats.upsertMessages({ chatId: chat.id, messages: [note('p', 'typed on the iPhone')] })
    await mac.engine.sync(); await phone.engine.sync()
    mac.store.setOnline(true); phone.store.setOnline(true)
    await syncAll(mac, phone)
    const onMac = (await mac.services.aiChats.getChat(chat.id))!.messages.map((m) => m.id)
    const onPhone = (await phone.services.aiChats.getChat(chat.id))!.messages.map((m) => m.id)
    expect(onMac).toEqual(['base', 'm', 'p'])
    expect(onPhone).toEqual(onMac)
  })
})

describe('unionJsonArrayById', () => {
  it('is order-independent, keeps later edits, and handles legacy elements without ids', () => {
    const a = JSON.stringify([{ role: 'user', content: 'legacy', createdAt: '2026-01-01T00:00:00.000Z' }, { id: 'x', content: 'old', createdAt: '2026-01-02T00:00:00.000Z' }])
    const b = JSON.stringify([{ role: 'user', content: 'legacy', createdAt: '2026-01-01T00:00:00.000Z' }, { id: 'x', content: 'new', createdAt: '2026-01-02T00:00:00.000Z', editedAt: '2026-01-03T00:00:00.000Z' }, { id: 'y', content: 'y', createdAt: '2026-01-01T12:00:00.000Z' }])
    const ab = unionJsonArrayById(a, b) as string
    expect(ab).toBe(unionJsonArrayById(b, a))
    expect(JSON.parse(ab).map((e: { id?: string; content: string }) => e.id ?? e.content)).toEqual(['legacy', 'y', 'x'])
    expect(JSON.parse(ab)[2].content).toBe('new')
    expect(unionJsonArrayById('not json', b)).toBeUndefined()
  })
})
