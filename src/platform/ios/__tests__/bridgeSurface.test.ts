// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'

vi.mock('@capacitor/core', () => ({ registerPlugin: () => ({}) }))
vi.mock('@capacitor/browser', () => ({ Browser: { open: async () => {} } }))
vi.mock('@capacitor/filesystem', () => ({ Filesystem: {}, Directory: { Library: 'LIBRARY' }, Encoding: { UTF8: 'utf8' } }))

import { migratedUserDb, recordingEvents } from '../../db/__tests__/testDb'
import { createServices } from '../../services'
import { consoleLogger, defaultUuid, type ServiceContext } from '../../services/context'
import { installIosBridge } from '../bridge'
import { installIosBridgeExtras } from '../bridgeExtras'
import * as iosServices from '../services'

/**
 * Every `window.<namespace>` the renderer is typed against (src/types/electron.d.ts) is either
 * installed on the phone or listed here as desktop-only with the reason documented in
 * docs/mobile/feature-matrix.md. A new namespace added to the desktop preload fails this test
 * until the phone decides what to do with it.
 */
const DESKTOP_ONLY = ['vault', 'bgImport', 'eSwordImport', 'ttsModel', 'ttsAudioCache', 'viewer', 'crossWindow', 'windowControls', 'sync']
const RENDERER_NAMESPACES = ['bible', 'notes', 'highlights', 'verseTags', 'tagGraph', 'lexicon', 'settings', 'pdf', 'vault', 'youtube', 'crossrefs', 'aiLookup', 'app', 'bgImport', 'eSwordImport', 'appHistory', 'studyTrail', 'workspaces', 'playlists', 'sessions', 'sync', 'ttsModel', 'ttsAudioCache', 'viewer', 'crossWindow', 'windowControls']

describe('iOS bridge surface', () => {
  it('installs every renderer namespace that is not documented desktop-only', async () => {
    const db = await migratedUserDb('bridge')
    const rec = recordingEvents()
    const ctx: ServiceContext = { userDb: db, textDb: async () => null, lexiconDb: async () => { throw new Error('n/a') }, dataDb: async () => null, events: rec.events, now: () => Date.now(), uuid: defaultUuid, isDev: true, log: consoleLogger }
    const services = createServices(ctx)
    vi.spyOn(iosServices, 'iosServiceContext').mockReturnValue(ctx)
    installIosBridge(services)
    installIosBridgeExtras(services, '0.0.0')
    const w = window as unknown as Record<string, unknown>
    for (const ns of RENDERER_NAMESPACES) {
      if (DESKTOP_ONLY.includes(ns)) continue
      expect(typeof w[ns], `window.${ns} missing on iOS`).toBe('object')
    }
    // desktop-only ones are absent (capability gating relies on that)
    for (const ns of ['vault', 'bgImport', 'eSwordImport']) expect(w[ns]).toBeUndefined()
    // AppAPI: the calls shared components make must exist
    for (const m of ['openExternal', 'getVersion', 'broadcastAudioState', 'onAudioStateUpdate', 'onMenuAction', 'openStudyTrailWindow', 'isDev']) {
      expect(typeof (w.app as Record<string, unknown>)[m], `window.app.${m}`).toBe('function')
    }
    // studyTrail mirrors the preload method list one-to-one
    const trailMethods = ['startSession', 'pauseSession', 'resumeSession', 'renameSession', 'endSession', 'deleteSession', 'deleteSessions', 'listSessions', 'listAllSessions', 'ensureLooseSession', 'getSession', 'addNode', 'reopenNode', 'promoteRevisit', 'updateNodeSubnote', 'setNodeTopicBreak', 'deleteNode', 'moveNodes', 'addConnection', 'deleteConnection', 'markGlance', 'updateConnectionReason', 'dismissPrompt', 'clearConnectionNote', 'updateRecap', 'getBacklinks', 'search', 'listThreads', 'listSessionsPage', 'getCollapse', 'setCollapse', 'listNotes', 'createNote', 'updateNote', 'deleteNote', 'listTags', 'createTag', 'updateTag', 'deleteTag', 'setSessionTags', 'mergeSessions', 'splitSession', 'reorderSessions', 'onDataChanged']
    for (const m of trailMethods) expect(typeof (w.studyTrail as Record<string, unknown>)[m], `window.studyTrail.${m}`).toBe('function')
    // and it really reaches the service
    const s = await (w.studyTrail as { startSession: (n: string) => Promise<{ id: string }> }).startSession('Bridge test')
    expect((await services.studyTrail.getSession(s.id))?.session.name).toBe('Bridge test')
    // unavailable network/desktop-only calls reject with a clear message rather than hanging
    expect(typeof (w.youtube as Record<string, unknown>).refresh).toBe('function')
    await expect((w.aiLookup as { query: () => Promise<unknown> }).query()).rejects.toThrow(/Mac/)
  })
})
