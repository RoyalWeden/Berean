import { describe, it, expect, vi, beforeEach } from 'vitest'

const fetchMock = vi.fn()
vi.mock('electron', () => ({ net: { fetch: (...a: unknown[]) => fetchMock(...a) } }))

const streamOf = (chunks: string[]) => new ReadableStream<Uint8Array>({
  start(c) { const enc = new TextEncoder(); chunks.forEach((x) => c.enqueue(enc.encode(x))); c.close() },
})

describe('pullOllamaModel stream parsing', () => {
  let pull: typeof import('../ollama').pullOllamaModel
  beforeEach(async () => { fetchMock.mockReset(); ;({ pullOllamaModel: pull } = await import('../ollama')) })

  it('parses newline-delimited JSON split across chunks', async () => {
    fetchMock.mockResolvedValue({ ok: true, body: streamOf(['{"status":"pulling manifest"}\n{"status":"pulling abc","total":100,', '"completed":40}\n{"status":"success"}']) })
    const seen: unknown[] = []
    await pull('llama3.2:3b', (p) => seen.push(p))
    expect(seen).toEqual([{ status: 'pulling manifest' }, { status: 'pulling abc', total: 100, completed: 40 }, { status: 'success' }])
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ model: 'llama3.2:3b', stream: true })
  })

  it('throws a typed error on an error line', async () => {
    fetchMock.mockResolvedValue({ ok: true, body: streamOf(['{"status":"x"}\n{"error":"pull model manifest: file does not exist"}\n']) })
    await expect(pull('nope:1b', () => {})).rejects.toMatchObject({ name: 'ModelCallError', code: 'NO_MODEL_INSTALLED' })
  })

  it('rejects with AbortError when cancelled', async () => {
    fetchMock.mockImplementation((_u: string, init: { signal: AbortSignal }) => new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    }))
    const ctrl = new AbortController()
    const p = pull('llama3.2:3b', () => {}, ctrl.signal)
    ctrl.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('model manager', () => {
  const make = async (over: Record<string, unknown> = {}) => {
    const { createModelManager } = await import('../ipc/aiModels')
    const deps = {
      list: vi.fn(async () => [{ name: 'llama3.1:latest', size: 4.9e9 }]),
      pull: vi.fn(async (_n: string, on: (p: { status: string; total?: number; completed?: number }) => void) => { on({ status: 'pulling', total: 200, completed: 50 }) }),
      remove: vi.fn(async () => {}),
      freeBytes: vi.fn(async () => 100e9),
      ...over,
    }
    return { deps, mgr: createModelManager(deps) }
  }

  it('downloads a catalog model and reports percent', async () => {
    const { deps, mgr } = await make()
    const events: unknown[] = []
    expect(await mgr.download('llama3.2:3b', (e) => events.push(e))).toEqual({ ok: true })
    expect(deps.pull).toHaveBeenCalledWith('llama3.2:3b', expect.any(Function), expect.any(AbortSignal))
    expect(events).toEqual([{ id: 'llama3.2:3b', status: 'pulling', percent: 25, completed: 50, total: 200 }])
  })

  it('refuses ids outside the catalog and installed list, for download and remove', async () => {
    const { deps, mgr } = await make()
    expect((await mgr.download('evil:latest', () => {})).ok).toBe(false)
    expect((await mgr.download('../etc', () => {})).ok).toBe(false)
    expect((await mgr.download(42, () => {})).ok).toBe(false)
    expect((await mgr.remove('qwen3.5:9b-q4_K_M')).ok).toBe(false) // in the catalog but not installed
    expect(deps.pull).not.toHaveBeenCalled()
    expect(deps.remove).not.toHaveBeenCalled()
  })

  it('removes an installed model', async () => {
    const { deps, mgr } = await make()
    expect(await mgr.remove('llama3.1:latest')).toEqual({ ok: true })
    expect(deps.remove).toHaveBeenCalledWith('llama3.1:latest')
  })

  it('refuses before pulling when free disk is too small', async () => {
    const { deps, mgr } = await make({ freeBytes: vi.fn(async () => 3e9) })
    const res = await mgr.download('gemma4:12b-it-qat', () => {})
    expect(res).toMatchObject({ ok: false })
    expect((res as { reason: string }).reason).toContain('Not enough free disk space')
    expect(deps.pull).not.toHaveBeenCalled()
  })

  it('says so plainly when Ollama is not running', async () => {
    const { mgr } = await make({ list: vi.fn(async () => { throw new Error('down') }) })
    expect(await mgr.list()).toEqual({ available: false, installed: [] })
    expect(await mgr.download('llama3.2:3b', () => {})).toMatchObject({ ok: false, reason: expect.stringContaining("isn't running") })
  })

  it('cancels an active download', async () => {
    let started: () => void = () => {}
    const began = new Promise<void>((r) => { started = r })
    const { mgr } = await make({
      pull: vi.fn((_n: string, _o: unknown, signal: AbortSignal) => new Promise<void>((_, reject) => {
        started()
        signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
      })),
    })
    const p = mgr.download('llama3.2:3b', () => {})
    await began
    expect(mgr.cancel('llama3.2:3b')).toBe(true)
    expect(await p).toMatchObject({ ok: false, cancelled: true })
    expect(mgr.cancel('llama3.2:3b')).toBe(false)
  })
})
