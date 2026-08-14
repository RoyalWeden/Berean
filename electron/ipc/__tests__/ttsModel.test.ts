import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * In-memory `fs` mock — just enough of the Node `fs` surface ttsModel.ts actually calls (manifest
 * read/write as small JSON text files, plus a fake `createWriteStream` standing in for downloaded
 * bytes) so these tests exercise the real download/cleanup/upgrade logic without touching a real
 * disk, hitting the network, or pulling in a heavier fs-mocking dependency this repo doesn't
 * already have.
 */
const textFiles = new Map<string, string>()
const existingPaths = new Set<string>()

vi.mock('fs', () => {
  // require()'d inside the factory, not imported at module top-level — vi.mock factories are
  // hoisted above all imports, so a top-level `import { EventEmitter } from 'events'` would be
  // referenced here before its own binding is initialized (a TDZ error).
  const { EventEmitter } = require('events') as typeof import('events')
  class FakeWriteStream extends EventEmitter {
    write(_chunk: Buffer, cb?: (err?: Error) => void) {
      cb?.()
      return true
    }
    end() {
      queueMicrotask(() => this.emit('finish'))
    }
  }
  const mocked = {
    mkdirSync: vi.fn((dir: string) => { existingPaths.add(dir) }),
    existsSync: vi.fn((p: string) => textFiles.has(p) || existingPaths.has(p)),
    rmSync: vi.fn((p: string) => { textFiles.delete(p); existingPaths.delete(p) }),
    renameSync: vi.fn((from: string, to: string) => { existingPaths.delete(from); existingPaths.add(to) }),
    writeFileSync: vi.fn((p: string, content: string) => { textFiles.set(p, content) }),
    readFileSync: vi.fn((p: string) => {
      if (!textFiles.has(p)) {
        const e = new Error('ENOENT') as NodeJS.ErrnoException
        e.code = 'ENOENT'
        throw e
      }
      return textFiles.get(p)!
    }),
    createWriteStream: vi.fn(() => new FakeWriteStream()),
  }
  // Some import path in the chain (electron-vite's Node-ESM interop, not Berean's own code)
  // resolves the mock via its `default` export rather than the named exports — providing both
  // keeps `import { readFileSync } from 'fs'` (ttsModel.ts's own style) working either way.
  return { ...mocked, default: mocked }
})

vi.mock('../../ttsModelProtocol', () => ({
  getTTSModelsRoot: () => '/userdata/tts-models',
}))

function fakeFetchOk(): Response {
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => {
        let done = false
        return {
          read: async () => {
            if (done) return { done: true, value: undefined }
            done = true
            return { done: false, value: new Uint8Array([1, 2, 3]) }
          },
        }
      },
    },
  } as unknown as Response
}

function fakeIpcMainAndSender() {
  const handlers: Record<string, (event: { sender: unknown }, ...args: unknown[]) => unknown> = {}
  const ipcMain = { handle: (name: string, fn: (typeof handlers)[string]) => { handlers[name] = fn } }
  const sender = { send: vi.fn() }
  return { ipcMain, handlers, sender }
}

const MODEL_DIR = '/userdata/tts-models/onnx-community/Kokoro-82M-v1.0-ONNX'
const MANIFEST_PATH = `${MODEL_DIR}/.manifest.json`

beforeEach(() => {
  textFiles.clear()
  existingPaths.clear()
  vi.stubGlobal('fetch', vi.fn())
  vi.resetModules()
})

describe('ttsModel:downloadRuntimeFile (upgrade path for a pre-existing pack)', () => {
  it('fails cleanly with no existing manifest to upgrade', async () => {
    const { registerTTSModelHandlers } = await import('../ttsModel')
    const { ipcMain, handlers, sender } = fakeIpcMainAndSender()
    registerTTSModelHandlers(ipcMain as never)

    const result = await handlers['ttsModel:downloadRuntimeFile']({ sender })
    expect(result).toEqual({ success: false, error: 'No existing voice pack found to upgrade.' })
  })

  it('fetches ONLY the runtime file and appends it to the existing manifest, leaving the rest of the pack untouched', async () => {
    const { allManifestFiles, RUNTIME_FILE } = await import('../../ttsModelManifest')
    const preexistingFiles = allManifestFiles().filter((f) => f !== RUNTIME_FILE)
    textFiles.set(MANIFEST_PATH, JSON.stringify({
      modelId: 'onnx-community/Kokoro-82M-v1.0-ONNX', files: preexistingFiles, downloadedAt: '2026-01-01T00:00:00.000Z',
    }))
    vi.mocked(fetch).mockResolvedValue(fakeFetchOk())

    const { registerTTSModelHandlers } = await import('../ttsModel')
    const { ipcMain, handlers, sender } = fakeIpcMainAndSender()
    registerTTSModelHandlers(ipcMain as never)

    const result = await handlers['ttsModel:downloadRuntimeFile']({ sender })
    expect(result).toEqual({ success: true })

    // Exactly one network request — the runtime file, not a re-fetch of anything already on disk.
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
    const [calledUrl] = vi.mocked(fetch).mock.calls[0]
    expect(String(calledUrl)).toContain('ort-wasm-simd-threaded.jsep.wasm')

    const manifest = JSON.parse(textFiles.get(MANIFEST_PATH)!)
    expect(manifest.files).toEqual(expect.arrayContaining([...preexistingFiles, RUNTIME_FILE]))
    expect(manifest.files).toHaveLength(preexistingFiles.length + 1)
  })

  it('on failure, removes only the partial runtime file and leaves the manifest exactly as it was', async () => {
    const { allManifestFiles, RUNTIME_FILE } = await import('../../ttsModelManifest')
    const preexistingFiles = allManifestFiles().filter((f) => f !== RUNTIME_FILE)
    const originalManifest = { modelId: 'onnx-community/Kokoro-82M-v1.0-ONNX', files: preexistingFiles, downloadedAt: '2026-01-01T00:00:00.000Z' }
    textFiles.set(MANIFEST_PATH, JSON.stringify(originalManifest))
    vi.mocked(fetch).mockRejectedValue(new Error('network down'))

    const { registerTTSModelHandlers } = await import('../ttsModel')
    const { ipcMain, handlers, sender } = fakeIpcMainAndSender()
    registerTTSModelHandlers(ipcMain as never)
    const { rmSync } = await import('fs')

    const result = await handlers['ttsModel:downloadRuntimeFile']({ sender })
    expect(result).toEqual({ success: false, error: 'network down' })

    // The manifest on disk is untouched — still missing RUNTIME_FILE, exactly as before the
    // failed attempt (so getTTSModelStatus() keeps reporting needsRuntimeFile, letting a retry
    // work without the user having lost anything).
    expect(JSON.parse(textFiles.get(MANIFEST_PATH)!)).toEqual(originalManifest)
    // Only the one partial file is cleaned up — never the rest of an already-good pack.
    expect(vi.mocked(rmSync)).toHaveBeenCalledWith(`${MODEL_DIR}/${RUNTIME_FILE}`, { force: true })
  })
})

describe('ttsModel:download (full pack) failure cleanup', () => {
  it('deletes the temp dir and never writes a manifest when a file download fails partway through', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('connection reset'))

    const { registerTTSModelHandlers } = await import('../ttsModel')
    const { ipcMain, handlers, sender } = fakeIpcMainAndSender()
    registerTTSModelHandlers(ipcMain as never)
    const { rmSync } = await import('fs')

    const result = await handlers['ttsModel:download']({ sender })
    expect(result).toEqual({ success: false, error: 'connection reset' })

    // No manifest was ever written for the real model dir — a failed download must never leave
    // getTTSModelStatus() reporting "ready".
    expect(textFiles.has(MANIFEST_PATH)).toBe(false)
    // The temp dir was cleaned up (best-effort rmSync on the .download-tmp path).
    expect(vi.mocked(rmSync)).toHaveBeenCalledWith(
      expect.stringContaining('.download-tmp'),
      expect.objectContaining({ recursive: true, force: true }),
    )
  })

  it('reports Cancelled (not a raw error) when the AbortController fires', async () => {
    vi.mocked(fetch).mockRejectedValue(Object.assign(new DOMException('Cancelled', 'AbortError')))

    const { registerTTSModelHandlers } = await import('../ttsModel')
    const { ipcMain, handlers, sender } = fakeIpcMainAndSender()
    registerTTSModelHandlers(ipcMain as never)

    const result = await handlers['ttsModel:download']({ sender })
    expect(result).toEqual({ success: false, error: 'Cancelled' })
  })
})
