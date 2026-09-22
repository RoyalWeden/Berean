import React, { useEffect, useState } from 'react'
import { Download, X, Check, AlertTriangle } from 'lucide-react'
import { useAppStore } from '@/store'
import { Page, ListSection, Row } from '../primitives/Page'
import { loadPackManifest, downloadPack, cancelPack, packState, subscribePack, type PackManifest, type PackState } from './transcriptPacks'

/**
 * Transcript packs (D-007): which channels have transcripts, how many are on this phone, and a
 * download per channel — resumable, cancellable, verified, merged, then searchable exactly like
 * on the Mac. Base URL editable for self-hosting (Settings key `transcriptPacksBaseUrl`).
 */
export function TranscriptPacksPage({ onBack }: { onBack: () => void }) {
  const [manifest, setManifest] = useState<PackManifest | null | undefined>(undefined)
  const [availability, setAvailability] = useState<Array<{ channelHandle: string; channelName: string; available: number; downloaded: number }>>([])
  const [tick, setTick] = useState(0)
  useEffect(() => { void loadPackManifest().then(setManifest) }, [])
  useEffect(() => { window.youtube.getTranscriptAvailability?.().then(setAvailability).catch(() => {}) }, [tick])
  useEffect(() => {
    if (!manifest) return
    const offs = manifest.packs.map((p) => subscribePack(`pack-${p.channelHandle}`, (s) => { if (s.kind === 'done') setTick((t) => t + 1); setTick((t) => t + 1) }))
    return () => { for (const off of offs) off() }
  }, [manifest])
  const totalMb = manifest ? manifest.packs.reduce((n, p) => n + p.bytes, 0) / 1024 / 1024 : 0

  return (
    <Page title="Transcripts" onBack={onBack}>
      {manifest === undefined && <div className="mobile-empty">Loading…</div>}
      {manifest === null && <div className="mobile-empty">This build has no transcript pack manifest. Generate it on the Mac with scripts/data/split-youtube-seed.mjs and rebuild.</div>}
      {manifest && (
        <>
          <div className="mobile-muted" style={{ padding: '8px 16px' }}>{manifest.packs.length} channels · {totalMb.toFixed(0)} MB in total · seed v{manifest.seedVersion}. Download only the channels you study; transcripts then search offline.</div>
          <ListSection title="Channels">
            {manifest.packs.map((p) => {
              const avail = availability.find((a) => a.channelHandle === p.channelHandle)
              const st = packState(`pack-${p.channelHandle}`)
              const have = avail ? avail.downloaded : 0
              const complete = avail ? have >= avail.available && avail.available > 0 : false
              return (
                <PackRow key={p.channelHandle} pack={p} state={st} have={have} complete={complete}
                  onDownload={() => void downloadPack(manifest, p)} onCancel={() => void cancelPack(p)} />
              )
            })}
          </ListSection>
        </>
      )}
    </Page>
  )
}

function PackRow({ pack, state, have, complete, onDownload, onCancel }: { pack: PackManifest['packs'][number]; state: PackState; have: number; complete: boolean; onDownload: () => void; onCancel: () => void }) {
  const mb = (pack.bytes / 1024 / 1024).toFixed(1)
  const sub =
    state.kind === 'downloading' ? `${state.total > 0 ? Math.round((state.received / state.total) * 100) : 0}% of ${mb} MB` :
    state.kind === 'verifying' ? 'Verifying…' : state.kind === 'merging' ? 'Adding to your library…' :
    state.kind === 'done' ? `${state.videos} transcripts added` :
    state.kind === 'error' ? state.message :
    complete ? `${have} of ${pack.videos} transcripts on this phone` : `${pack.videos} transcripts · ${mb} MB${have ? ` · ${have} already here` : ''}`
  const right =
    state.kind === 'downloading' ? <button type="button" className="mobile-icon-tap" aria-label="Cancel download" onClick={onCancel}><X size={20} aria-hidden /></button> :
    state.kind === 'verifying' || state.kind === 'merging' ? <span className="mobile-muted">…</span> :
    complete ? <Check size={20} aria-label="Downloaded" /> :
    state.kind === 'error' ? <button type="button" className="mobile-icon-tap" aria-label={state.resumable ? 'Resume' : 'Retry'} onClick={onDownload}><AlertTriangle size={20} aria-hidden /></button> :
    <button type="button" className="mobile-icon-tap" aria-label={`Download ${pack.channelName}`} onClick={onDownload}><Download size={20} aria-hidden /></button>
  return <Row title={pack.channelName} subtitle={sub} right={right} />
}

export function useTranscriptPacksEnabled(): boolean { return !!useAppStore }
