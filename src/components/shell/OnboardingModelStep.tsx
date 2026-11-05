import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui'
import { RECOMMENDED_MODELS, formatBytes } from '@/lib/research/modelCatalog'

/** The Ask Berean onboarding step is offered only where local models can be managed (desktop). */
export const hasModelSetup = () => typeof window !== 'undefined' && !!window.aiLookup?.downloadModel

// The first compact entry is the recommended starter model.
const MODEL = RECOMMENDED_MODELS[0]

type Phase = { kind: 'checking' } | { kind: 'down' } | { kind: 'ready' } | { kind: 'installed' }

/**
 * Onboarding step for local models (spec §8.3). Optional and never blocks finishing: nothing
 * downloads until Download is pressed, and Next works at any time.
 */
export default function StepAskBerean() {
  const api = window.aiLookup
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' })
  const [progress, setProgress] = useState<{ percent: number | null; status: string } | null>(null)
  const [note, setNote] = useState('')

  useEffect(() => {
    let live = true
    void Promise.resolve().then(() => api.listLocalModels?.()).then((r) => {
      if (!live) return
      if (!r || !r.available) setPhase({ kind: 'down' })
      else setPhase({ kind: r.installed.some((m) => m.name === MODEL.id) ? 'installed' : 'ready' })
    }).catch(() => { if (live) setPhase({ kind: 'down' }) })
    return () => { live = false }
  }, [api])
  useEffect(() => api.onModelProgress?.((e) => {
    if (e.id === MODEL.id) setProgress({ percent: e.percent, status: e.status })
  }), [api])

  const download = async () => {
    setNote('')
    setProgress({ percent: null, status: 'Starting' })
    const res = await api.downloadModel?.(MODEL.id)
    setProgress(null)
    if (res && !res.ok) setNote(res.reason)
    else if (res?.ok) setPhase({ kind: 'installed' })
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-title2 font-semibold text-text-primary mb-2">Ask Berean</h2>
        <p className="text-subhead text-text-secondary leading-relaxed">
          Ask Berean works without a model for verses, Strong&apos;s and comparisons. A local model adds Commentary and Deep Search.
          This step is optional.
        </p>
      </div>

      {phase.kind === 'down' && (
        <p role="status" className="text-caption text-text-muted">
          Ollama isn&apos;t running, and Ask Berean still works. You can set up a model later in <strong>Settings → Ask Berean</strong>.
        </p>
      )}

      {phase.kind === 'installed' && (
        <p role="status" className="text-caption text-text-muted">{MODEL.label} is already installed.</p>
      )}

      {phase.kind === 'ready' && (
        <div className="space-y-1.5 px-3 py-2 rounded-row bg-surface-elevated">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-caption font-medium text-text-primary">{MODEL.label} <span className="text-text-muted font-normal">· Recommended</span></p>
              <p className="text-caption2 text-text-muted">
                Download {formatBytes(MODEL.sizeBytes)} · about {formatBytes(MODEL.estimatedMemoryBytes)} of memory when running (estimate) · {MODEL.license}
              </p>
            </div>
            {progress
              ? <Button size="sm" variant="ghost" onClick={() => void api.cancelModelDownload?.(MODEL.id)}>Cancel</Button>
              : (
                <div className="flex gap-1 shrink-0">
                  <Button size="sm" variant="ghost" icon={Download} aria-label={`Download ${MODEL.label}`} onClick={() => void download()}>Download</Button>
                  <Button size="sm" variant="ghost" onClick={() => setPhase({ kind: 'down' })} aria-label="Skip model download">Skip</Button>
                </div>
              )}
          </div>
          {progress && (
            <div>
              <div role="progressbar" aria-label={`Downloading ${MODEL.label}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent ?? undefined}
                className="h-1.5 rounded-full bg-separator overflow-hidden">
                <div className="h-full bg-accent" style={{ width: `${progress.percent ?? 0}%` }} />
              </div>
              <p className="text-caption2 text-text-muted mt-1">{progress.percent === null ? `${progress.status}…` : `${progress.percent}%`}</p>
            </div>
          )}
          {note && <p role="status" className="text-caption2 text-text-muted">{note}</p>}
        </div>
      )}
    </div>
  )
}
