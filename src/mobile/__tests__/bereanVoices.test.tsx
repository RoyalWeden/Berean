// @vitest-environment jsdom
/** Read Aloud on the iPhone: Berean Voices (the Mac's Kokoro voices) download inside the app with
 *  one tap, show progress, switch Read Aloud over when done, and can be removed again. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// The native plugin: a controllable fake download.
const h = vi.hoisted(() => {
  const st = {
    listeners: {} as Record<string, (p: unknown) => void>,
    finishDownload: (_r: { success: boolean; error?: string }) => {},
    manifest: null as unknown,
  }
  const plugin = {
    status: vi.fn(async () => ({ root: '/data/tts-models', manifest: st.manifest, downloading: false })),
    download: vi.fn(() => new Promise<{ success: boolean; error?: string }>((r) => { st.finishDownload = r })),
    cancel: vi.fn(async () => { st.finishDownload({ success: false, error: 'Cancelled' }); return { cancelled: true } }),
    clear: vi.fn(async () => { st.manifest = null; return { success: true } }),
    synthesize: vi.fn(),
    unload: vi.fn(),
    addListener: vi.fn(async (e: string, cb: (p: unknown) => void) => { st.listeners[e] = cb; return { remove: async () => {} } }),
  }
  return { st, plugin }
})
const { st, plugin } = h
vi.mock('@/platform/ios/plugins', () => ({ BereanVoicePack: h.plugin }))
vi.mock('@capacitor/core', () => ({ Capacitor: { convertFileSrc: (p: string) => p.replace('file://', 'capacitor://localhost/_capacitor_file_') } }))
const v = vi.hoisted(() => ({ voices: [] as Array<Record<string, unknown>> }))
vi.mock('@/lib/tts/ttsEngine', () => ({ ttsEngine: new Proxy({}, { get: () => () => {} }), setActiveTTSBackend: () => {}, getVoices: () => v.voices, subscribeVoices: () => () => {}, activateKokoroBackend: async () => {} }))

import { installIosVoicePack, voicePackStore, VOICE_PACK_ESTIMATED_BYTES, IOS_PACK_FILES } from '@/platform/ios/voicePack'
import { allManifestFiles, RUNTIME_FILE } from '../../../electron/ttsModelManifest'
import { getKokoroModelBaseUrl, getKokoroNativeInfer } from '@/lib/tts/kokoro/modelBase'
import { GetVoicesView } from '../audio/GetVoicesView'
import { useAppStore } from '@/store'

const fullManifest = () => ({ modelId: 'onnx-community/Kokoro-82M-v1.0-ONNX', files: IOS_PACK_FILES, downloadedAt: 'x' })
const button = (host: HTMLElement, text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text))
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

let root: Root; let host: HTMLDivElement
beforeEach(() => {
  Object.values(plugin).forEach((f) => (f as { mockClear?: () => void }).mockClear?.())
  installIosVoicePack()
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('Berean Voices on iPhone', () => {
  it('installs the Mac download contract and runs the model natively from app storage', async () => {
    expect(getKokoroNativeInfer()).toBeTypeOf('function')
    st.manifest = { files: allManifestFiles() } // a pack copied over from a Mac counts as installed
    expect((await window.ttsModel.getStatus()).ready).toBe(true)
    st.manifest = null
    expect(getKokoroModelBaseUrl()).toBe('capacitor://localhost/_capacitor_file_/data/tts-models/')
  })

  it('one tap downloads the same files as the Mac, shows progress, then switches Read Aloud over', async () => {
    st.manifest = null
    useAppStore.setState({ kokoroModelReady: false })
    act(() => root.render(<GetVoicesView />))
    await flush()
    const dl = button(host, 'Download Berean Voices')!
    expect(dl.textContent).toContain(`${Math.round(VOICE_PACK_ESTIMATED_BYTES / 1_000_000)} MB`)
    await act(async () => { dl.click() })
    const call = (plugin.download.mock.calls[0] as unknown[])[0] as { files: Array<{ path: string; url: string }> }
    // The Mac's files minus its WebView ONNX runtime (the iPhone runs the model natively).
    expect(call.files.map((f) => f.path)).toEqual(allManifestFiles().filter((f) => f !== RUNTIME_FILE))
    expect(call.files.every((f) => f.url.startsWith('https://'))).toBe(true)
    await act(async () => { st.listeners.progress({ receivedBytes: 180_000_000, totalBytes: 360_000_000 }) })
    expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('50')
    expect(button(host, 'Cancel Download')).toBeTruthy()
    st.manifest = fullManifest()
    await act(async () => { st.finishDownload({ success: true }) })
    await flush()
    expect(voicePackStore.get().status).toBe('ready')
    expect(useAppStore.getState().kokoroModelReady).toBe(true)
    expect(host.textContent).toContain('Installed')
  })

  it('a chapter being read carries on from the same verse when the engine switches', async () => {
    await act(async () => { await (await import('@/platform/ios/voicePack')).removeVoicePack() })
    st.manifest = null
    useAppStore.setState({
      ttsAutoplayOnOpen: true,
      audioPlayback: { isPlaying: true, isPaused: false, textId: 'kjva', bookId: 'PSA', chapter: 23, verse: 4, wordIndex: null, finished: false, endVerse: null },
    })
    act(() => root.render(<GetVoicesView />))
    await flush()
    await act(async () => { button(host, 'Download Berean Voices')!.click() })
    st.manifest = fullManifest()
    await act(async () => { st.finishDownload({ success: true }) })
    await flush()
    expect(useAppStore.getState().kokoroModelReady).toBe(true)
    expect(useAppStore.getState().audioPlayback).toMatchObject({ bookId: 'PSA', chapter: 23, verse: 4, isPlaying: true })
  })

  it('removing them asks first, then hands Read Aloud back to the system voice', async () => {
    act(() => root.render(<GetVoicesView />))
    await flush()
    await act(async () => { button(host, 'Remove Berean Voices…')!.click() })
    expect(plugin.clear).not.toHaveBeenCalled()
    await act(async () => { button(host, 'Remove Berean Voices')!.click() })
    await flush()
    expect(plugin.clear).toHaveBeenCalled()
    expect(useAppStore.getState().kokoroModelReady).toBe(false)
    expect(button(host, 'Download Berean Voices')).toBeTruthy()
  })

  it('a cancelled download goes back to the Download button; a failed one offers Try Again', async () => {
    act(() => root.render(<GetVoicesView />))
    await flush()
    await act(async () => { button(host, 'Download Berean Voices')!.click() })
    await act(async () => { button(host, 'Cancel Download')!.click() })
    await flush()
    expect(button(host, 'Download Berean Voices')).toBeTruthy()
    await act(async () => { button(host, 'Download Berean Voices')!.click() })
    await act(async () => { st.finishDownload({ success: false, error: 'The Internet connection appears to be offline.' }) })
    await flush()
    expect(button(host, 'Try Again')?.textContent).toContain('offline')
  })
})

describe('Settings root: Read Aloud rows', () => {
  it('shows the voice in use and links Berean Voices', async () => {
    const { ReadAloudVoiceRows } = await import('../settings/AudioSettingsPage')
    v.voices = [{ voiceURI: 's', name: 'Samantha', lang: 'en-US', tier: null }]
    useAppStore.setState({ ttsVoiceURI: null, kokoroModelReady: false })
    const openVoices = vi.fn()
    act(() => root.render(<ReadAloudVoiceRows openVoices={openVoices} openReadAloud={() => {}} />))
    await flush()
    expect(host.textContent).toContain('Voice: System default')
    act(() => button(host, 'Berean Voices')!.click())
    expect(openVoices).toHaveBeenCalled()
    // With Berean Voices active, an old system-voice choice reads in the default Berean voice — say so.
    v.voices = [{ voiceURI: 'af_heart', name: 'Heart', lang: 'en-US', tier: 'Premium' }, { voiceURI: 'am_michael', name: 'Michael', lang: 'en-US', tier: null }]
    useAppStore.setState({ ttsVoiceURI: 's', kokoroModelReady: true })
    act(() => root.render(<ReadAloudVoiceRows openVoices={openVoices} openReadAloud={() => {}} />))
    await flush()
    expect(host.textContent).toContain('Voice: Heart (Premium)')
  })
})
