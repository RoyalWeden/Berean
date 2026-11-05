import { useCallback, useEffect, useState } from 'react'
import { Download, Trash2 } from 'lucide-react'
import { AlertSheet, Button, SectionLabel } from '@/components/ui'
import { RECOMMENDED_MODELS, TIER_LABEL, formatBytes } from '@/lib/research/modelCatalog'

type Installed = Array<{ name: string; size: number }>
interface Progress { percent: number | null; status: string }

/**
 * Settings → Ask Berean → local models (spec §8.3). Desktop only. Models run through Ollama;
 * every download and removal here starts from a button the user pressed. Berean removes a model
 * from Ollama only — it never touches anything else on disk.
 */
export default function LocalModelsSettings() {
  const api = window.aiLookup
  const [state, setState] = useState<{ available: boolean; installed: Installed } | null>(null)
  const [progress, setProgress] = useState<Record<string, Progress>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [confirmRemove, setConfirmRemove] = useState<{ name: string; size: number } | null>(null)

  const reload = useCallback(async () => { setState(await api.listLocalModels?.() ?? null) }, [api])
  useEffect(() => { void reload() }, [reload])
  useEffect(() => api.onModelProgress?.((e) => setProgress((p) => ({ ...p, [e.id]: { percent: e.percent, status: e.status } }))), [api])
  if (!state || !api.downloadModel) return null

  const note = (id: string, text: string) => setNotes((n) => ({ ...n, [id]: text }))
  const download = async (id: string) => {
    note(id, '')
    setProgress((p) => ({ ...p, [id]: { percent: null, status: 'Starting' } }))
    const res = await api.downloadModel?.(id)
    setProgress((p) => { const { [id]: _done, ...rest } = p; return rest })
    if (res && !res.ok) note(id, res.reason)
    await reload()
  }
  const remove = async (name: string) => {
    const res = await api.removeModel?.(name)
    if (res && !res.ok) note(name, res.reason)
    await reload()
  }

  const installedNames = state.installed.map((m) => m.name)
  const available = RECOMMENDED_MODELS.filter((m) => !installedNames.includes(m.id))
  const used = state.installed.reduce((sum, m) => sum + m.size, 0)

  return (
    <div className="space-y-3">
      <SectionLabel>Local models</SectionLabel>
      {!state.available ? (
        <p role="status" className="s-desc text-caption text-text-muted">Ollama isn&apos;t running. Start it to see, download or remove models.</p>
      ) : (
        <>
          <p className="s-desc text-caption text-text-muted">
            Models run on this Mac through Ollama. Nothing downloads until you press Download.
            {state.installed.length > 0 && ` Installed models use ${formatBytes(used)}.`}
          </p>
          {state.installed.length === 0
            ? <p className="s-desc text-caption text-text-muted">No models are installed.</p>
            : state.installed.map((m) => (
              <div key={m.name} className="flex items-center justify-between gap-3 px-3 py-2 rounded-row bg-surface-elevated">
                <div className="min-w-0">
                  <p className="text-caption font-medium text-text-primary truncate">{m.name}</p>
                  <p className="text-caption2 text-text-muted">{formatBytes(m.size)}</p>
                  {notes[m.name] && <p role="status" className="text-caption2 text-text-muted">{notes[m.name]}</p>}
                </div>
                <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Remove ${m.name}`} onClick={() => setConfirmRemove(m)}>Remove</Button>
              </div>
            ))}
          {available.length > 0 && <p className="text-subhead font-medium text-text-primary pt-1">Recommended</p>}
          {available.map((m) => {
            const p = progress[m.id]
            return (
              <div key={m.id} className="space-y-1.5 px-3 py-2 rounded-row bg-surface-elevated">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-caption font-medium text-text-primary">{m.label} <span className="text-text-muted font-normal">· {TIER_LABEL[m.tier]}</span></p>
                    <p className="text-caption2 text-text-muted">{m.purpose}</p>
                    <p className="text-caption2 text-text-muted">
                      Download {formatBytes(m.sizeBytes)} · about {formatBytes(m.estimatedMemoryBytes)} of memory when running (estimate) · {m.license}
                    </p>
                  </div>
                  {p
                    ? <Button size="sm" variant="ghost" onClick={() => void api.cancelModelDownload?.(m.id)}>Cancel</Button>
                    : <Button size="sm" variant="ghost" icon={Download} aria-label={`Download ${m.label}`} onClick={() => void download(m.id)}>Download</Button>}
                </div>
                {p && (
                  <div>
                    <div role="progressbar" aria-label={`Downloading ${m.label}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.percent ?? undefined}
                      className="h-1.5 rounded-full bg-separator overflow-hidden">
                      <div className="h-full bg-accent" style={{ width: `${p.percent ?? 0}%` }} />
                    </div>
                    <p className="text-caption2 text-text-muted mt-1">{p.percent === null ? `${p.status}…` : `${p.percent}%`}</p>
                  </div>
                )}
                {notes[m.id] && <p role="status" className="text-caption2 text-text-muted">{notes[m.id]}</p>}
              </div>
            )
          })}
        </>
      )}
      <AlertSheet open={!!confirmRemove} onOpenChange={(o) => { if (!o) setConfirmRemove(null) }}
        title={`Remove ${confirmRemove?.name ?? ''}?`}
        message={`This frees ${confirmRemove ? formatBytes(confirmRemove.size) : ''}. Berean only removes it from Ollama; you can download it again later.`}
        confirmLabel="Remove" destructive defaultIsCancel
        onConfirm={() => { const m = confirmRemove; setConfirmRemove(null); if (m) void remove(m.name) }} />
    </div>
  )
}
