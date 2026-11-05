import { homedir } from 'node:os'
import { statfs } from 'node:fs/promises'
import type { IpcMain, WebContents } from 'electron'
import { deleteOllamaModel, listOllamaModels, pullOllamaModel, type OllamaModelInfo, type OllamaPullProgress } from '../ollama'
import { catalogModel, formatBytes, isAllowedModelId } from '../../src/lib/research/modelCatalog'
import { classifyModelError } from '../../src/lib/research/errors'

// Local model management (spec §8.3). Every download and delete starts from a button the user
// pressed; the renderer only ever names a model, and the name is checked against the catalog or
// the installed list before it reaches Ollama.

/** Room kept free beyond the model itself. */
const DISK_MARGIN_BYTES = 1_000_000_000

export type ModelResult = { ok: true } | { ok: false; reason: string; cancelled?: boolean }
export interface LocalModelList { available: boolean; installed: OllamaModelInfo[] }
export interface ModelProgressEvent { id: string; status: string; percent: number | null; completed: number; total: number }

export interface ModelDeps {
  list: () => Promise<OllamaModelInfo[]>
  pull: (name: string, onProgress: (p: OllamaPullProgress) => void, signal?: AbortSignal) => Promise<void>
  remove: (name: string) => Promise<void>
  /** Free bytes on the volume holding Ollama's models. */
  freeBytes: () => Promise<number>
}

const defaultDeps: ModelDeps = {
  list: listOllamaModels,
  pull: pullOllamaModel,
  remove: deleteOllamaModel,
  freeBytes: async () => {
    const s = await statfs(homedir()) // Ollama keeps models under ~/.ollama, on the home volume
    return Number(s.bavail) * Number(s.bsize)
  },
}

export function createModelManager(deps: ModelDeps = defaultDeps) {
  const active = new Map<string, AbortController>()

  async function installedNames(): Promise<string[] | null> {
    try { return (await deps.list()).map((m) => m.name) } catch { return null }
  }

  return {
    async list(): Promise<LocalModelList> {
      try { return { available: true, installed: await deps.list() } } catch { return { available: false, installed: [] } }
    },

    async download(id: unknown, onProgress: (e: ModelProgressEvent) => void): Promise<ModelResult> {
      const installed = await installedNames()
      if (!installed) return { ok: false, reason: "Ollama isn't running. Start it, then try again." }
      if (!isAllowedModelId(id, installed)) return { ok: false, reason: 'That model is not one Berean can download.' }
      if (active.has(id)) return { ok: false, reason: 'This model is already downloading.' }
      const need = (catalogModel(id)?.sizeBytes ?? 0) + DISK_MARGIN_BYTES
      let free = Infinity
      try { free = await deps.freeBytes() } catch { /* unknown free space: let Ollama decide */ }
      if (free < need) return { ok: false, reason: `Not enough free disk space. ${formatBytes(need)} is needed and ${formatBytes(free)} is free.` }

      const ctrl = new AbortController()
      active.set(id, ctrl)
      try {
        await deps.pull(id, (p) => {
          const total = p.total ?? 0
          const completed = p.completed ?? 0
          onProgress({ id, status: p.status, percent: total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : null, completed, total })
        }, ctrl.signal)
        return { ok: true }
      } catch (e) {
        if (ctrl.signal.aborted || (e as Error).name === 'AbortError') return { ok: false, reason: 'Download cancelled. Starting it again continues where it stopped.', cancelled: true }
        const code = classifyModelError(e)
        return { ok: false, reason: code === 'RUNTIME_UNAVAILABLE' ? "Ollama isn't running or stopped answering." : `The download failed: ${(e as Error).message}` }
      } finally {
        active.delete(id)
      }
    },

    cancel(id: unknown): boolean {
      const ctrl = typeof id === 'string' ? active.get(id) : undefined
      ctrl?.abort()
      return !!ctrl
    },

    async remove(id: unknown): Promise<ModelResult> {
      const installed = await installedNames()
      if (!installed) return { ok: false, reason: "Ollama isn't running. Start it, then try again." }
      if (!isAllowedModelId(id, installed) || !installed.includes(id)) return { ok: false, reason: 'That model is not installed.' }
      try {
        await deps.remove(id)
        return { ok: true }
      } catch (e) {
        return { ok: false, reason: `The model could not be removed: ${(e as Error).message}` }
      }
    },
  }
}

export function registerAiModelHandlers(ipcMain: IpcMain): void {
  const manager = createModelManager()
  const send = (sender: WebContents) => (e: ModelProgressEvent) => { if (!sender.isDestroyed()) sender.send('aimodels:progress', e) }
  ipcMain.handle('aimodels:list', () => manager.list())
  ipcMain.handle('aimodels:download', (e, id: unknown) => manager.download(id, send(e.sender)))
  ipcMain.handle('aimodels:cancel', (_e, id: unknown) => manager.cancel(id))
  ipcMain.handle('aimodels:remove', (_e, id: unknown) => manager.remove(id))
}
