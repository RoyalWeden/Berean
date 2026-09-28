import { useEffect, useState } from 'react'
import { RefreshCcw, FolderOpen } from 'lucide-react'
import { Switch, Button } from '@/components/ui'
import type { SyncConfig } from '@/types/electron'
import type { SyncStatusSnapshot, SyncTraceEntry } from '@/platform/sync/types'

/**
 * Settings → iCloud (docs/mobile/icloud.md; R064). Shared by desktop and, later, the iPhone
 * settings page: it only talks to `window.sync`, which each platform's host implements.
 */
const STATE_LABEL: Record<NonNullable<SyncStatusSnapshot['state']>, string> = {
  synced: 'Up to date — nothing waiting in either direction',
  pending: 'Changes waiting to be written to iCloud',
  offline: 'Offline — changes are kept on this device and sync when the network returns',
  uploading: 'Uploading — iCloud has not accepted the latest changes yet',
  downloading: 'Downloading — another device has changes that are still arriving',
  reconciling: 'Applying changes from another device…',
  unavailable: 'iCloud unavailable — changes are kept on this device and sync when it returns',
  attention: 'Needs attention (see below)',
  held: 'Paused to protect your data — see below',
}

/** What each hold means, in plain words (DATA-SAFE-020/040/041/060). Nothing was deleted. */
function holdText(h: NonNullable<SyncStatusSnapshot['hold']>): { title: string; body: string } {
  if (h.kind === 'quarantine') {
    const n = Object.values(h.entities ?? {}).reduce((a, b) => a + b, 0)
    return { title: `${n} item${n === 1 ? ' is' : 's are'} missing on this device`, body: 'They were NOT deleted from iCloud. If you did not delete them here, restore them from iCloud. Only choose “They were deleted” if you removed them yourself.' }
  }
  if (h.kind === 'account') return { title: 'A different iCloud account is signed in', body: 'Sync is paused so this device’s notes are not mixed into another account and nothing is deleted. Signing back into the previous account resumes sync by itself.' }
  if (h.kind === 'container') return { title: 'Berean’s iCloud data is not where it was', body: 'This device’s sync history is not in iCloud (another account, iCloud Drive turned off, or Berean’s data removed from iCloud). Nothing on this device was changed. Sync resumes by itself when it reappears.' }
  return { title: 'This device’s database needs repair', body: h.detail ?? 'Sync is paused so a damaged database is never sent to iCloud.' }
}

export default function ICloudSection() {
  const api = typeof window !== 'undefined' ? window.sync : undefined
  const [config, setConfig] = useState<SyncConfig | null>(null)
  const [status, setStatus] = useState<SyncStatusSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [trace, setTrace] = useState<{ enabled: boolean; entries: SyncTraceEntry[] } | null>(null)

  const refresh = async () => {
    if (!api) return
    setConfig(await api.getConfig().catch(() => null))
    setStatus(await api.getStatus().catch(() => null))
    if (api.getTrace) setTrace(await api.getTrace().catch(() => null))
  }

  useEffect(() => {
    void refresh()
    const off = api?.onStatus((s) => { setStatus(s); if (api?.getTrace) void api.getTrace().then(setTrace).catch(() => {}) })
    // While this page is open, re-read the status now and then: iCloud can finish an upload /
    // download between sync passes. This refreshes the DISPLAY only — it never triggers a sync.
    const t = setInterval(() => { void api?.getStatus().then(setStatus).catch(() => {}); if (api?.getTrace) void api.getTrace().then(setTrace).catch(() => {}) }, 5000)
    return () => { off?.(); clearInterval(t) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!api) {
    return <p className="text-caption text-text-muted">iCloud sync is not available in this window.</p>
  }

  async function toggle(on: boolean) {
    setBusy(true); setMessage(null)
    try {
      if (on) {
        const r = await api!.enable()
        if (!r.ok) setMessage(r.reason ?? 'Could not enable iCloud sync.')
      } else {
        await api!.disable()
      }
    } finally {
      setBusy(false)
      await refresh()
    }
  }

  async function chooseFolder() {
    const r = await api!.chooseFolder()
    if (!r.canceled) { setMessage(null); await refresh() }
  }

  const fmt = (t: number | null) => (t ? new Date(t).toLocaleTimeString() : '—')

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-subhead font-medium text-text-primary">iCloud sync</p>
          <p className="s-desc text-caption text-text-muted mt-0.5">
            Keep notes, highlights, verse tags, tabs, sessions and workspaces the same on every device signed into your iCloud account. Bible texts never sync — they ship with the app. Works offline; changes upload when iCloud can.
          </p>
        </div>
        <Switch checked={!!config?.enabled && !!config?.running} onCheckedChange={() => void toggle(!(config?.enabled && config?.running))} disabled={busy} />
      </div>

      {message && <p className="text-caption text-danger">{message}</p>}

      <div>
        <p className="text-subhead font-medium text-text-primary mb-1">Sync folder</p>
        <p className="s-desc text-caption text-text-muted mb-2">
          {config?.folderOverride
            ? 'A folder you chose inside iCloud Drive.'
            : 'Berean’s own iCloud container. It appears on this Mac after Berean has been opened once on your iPhone.'}
          {config && !config.containerExists && !config.folderOverride && ' Not found yet on this Mac.'}
        </p>
        <p className="text-caption font-mono text-text-secondary break-all">{config?.folder ?? '…'}</p>
        <div className="mt-2 flex gap-2">
          <Button size="sm" variant="ghost" icon={FolderOpen} onClick={() => void chooseFolder()}>Choose folder in iCloud Drive…</Button>
          {config?.folderOverride && <Button size="sm" variant="ghost" onClick={() => void api!.useDefaultFolder().then(refresh)}>Use Berean container</Button>}
        </div>
      </div>

      {status?.hold && (() => {
        const t = holdText(status.hold)
        const act = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn() } finally { setBusy(false); await refresh() } }
        return (
          <div className="rounded-md border border-warning/40 bg-warning/10 p-3 space-y-2" role="alert">
            <p className="text-subhead font-medium text-text-primary">{t.title}</p>
            <p className="text-caption text-text-secondary">{t.body}</p>
            <div className="flex flex-wrap gap-2">
              {status.hold.kind === 'quarantine' && api.resolveHold && (<>
                <Button size="sm" disabled={busy} onClick={() => void act(() => api.resolveHold!('restore'))}>Restore from iCloud</Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => { if (confirm('Delete these items from iCloud and every device? Only do this if you deleted them yourself.')) void act(() => api.resolveHold!('delete')) }}>They were deleted</Button>
              </>)}
              {(status.hold.kind === 'account' || status.hold.kind === 'container') && api.resolveHold && (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => { if (confirm('Upload everything on this device to the iCloud account that is signed in now? Nothing is deleted anywhere.')) void act(() => api.resolveHold!('republish')) }}>Use this iCloud for this device’s data…</Button>
              )}
            </div>
          </div>
        )
      })()}

      {status && (
        <div>
          <div className="flex items-center justify-between">
            <p className="text-subhead font-medium text-text-primary">Status</p>
            <Button size="sm" variant="ghost" icon={RefreshCcw} onClick={() => void api!.syncNow().then(refresh)}>Sync now</Button>
          </div>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-caption">
            <dt className="text-text-muted">Transport</dt><dd className="text-text-secondary">{status.transport.available ? 'available' : `unavailable — ${status.transport.reason ?? ''}`}</dd>
            {status.state && (<><dt className="text-text-muted">State</dt><dd className={status.state === 'attention' ? 'text-danger' : 'text-text-secondary'}>{STATE_LABEL[status.state]}</dd></>)}
            <dt className="text-text-muted">Pending changes</dt><dd className="text-text-secondary">{status.pendingOutbox}</dd>
            {status.pendingUploads != null && (<><dt className="text-text-muted">Waiting for iCloud upload</dt><dd className="text-text-secondary">{status.pendingUploads} file{status.pendingUploads === 1 ? '' : 's'}</dd></>)}
            {!!status.remoteBehind && (<><dt className="text-text-muted">Still to receive</dt><dd className="text-text-secondary">{status.remoteBehind} change{status.remoteBehind === 1 ? '' : 's'} from other devices</dd></>)}
            {status.lastNotifiedAt != null && (<><dt className="text-text-muted">Last iCloud notification</dt><dd className="text-text-secondary">{fmt(status.lastNotifiedAt)}</dd></>)}
            {status.lastApplied && (<><dt className="text-text-muted">Last received</dt><dd className="text-text-secondary">{status.lastApplied.count} change{status.lastApplied.count === 1 ? '' : 's'} · {fmt(status.lastApplied.at)}</dd></>)}
            {!!status.conflicts && (<><dt className="text-text-muted">Conflict copies</dt><dd className="text-text-secondary">{status.conflicts} — kept in each note's Versions</dd></>)}
            {!!status.mergeConflicts && (<><dt className="text-text-muted">Merge conflicts kept</dt><dd className="text-text-secondary">{status.mergeConflicts} — values two devices changed at once; the other value is kept</dd></>)}
            {!!status.forks && (<><dt className="text-text-muted">Restored / copied database</dt><dd className="text-text-secondary">detected {status.forks}× — resynced as a new device</dd></>)}
            {status.lastFullReconcile != null && (<><dt className="text-text-muted">Last full check</dt><dd className="text-text-secondary">{new Date(status.lastFullReconcile).toLocaleString()}</dd></>)}
            {!!status.failedOps && (<><dt className="text-text-muted">Changes not applied</dt><dd className="text-danger">{status.failedOps} (retrying)</dd></>)}
            <dt className="text-text-muted">Last push / pull</dt><dd className="text-text-secondary">{fmt(status.lastPushAt)} / {fmt(status.lastPullAt)}</dd>
            <dt className="text-text-muted">This device</dt><dd className="text-text-secondary font-mono">{status.deviceId}</dd>
            {status.unreadable > 0 && (<><dt className="text-text-muted">Unreadable entries</dt><dd className="text-danger">{status.unreadable}</dd></>)}
            {status.journal && (<><dt className="text-text-muted">This device's journal</dt><dd className="text-text-secondary">{status.journal.files} file{status.journal.files === 1 ? '' : 's'}, {(status.journal.bytes / 1024).toFixed(0)} KB{status.journal.snapshotSeq != null ? ` · compacted at change #${status.journal.snapshotSeq}` : ''}</dd></>)}
            {status.lastError && (<><dt className="text-text-muted">Last error</dt><dd className="text-danger">{status.lastError}</dd></>)}
            {status.schema != null && (<><dt className="text-text-muted">Database schema</dt><dd className="text-text-secondary">v{status.schema}</dd></>)}
          </dl>
          {api.getTrace && api.setDiagnostics && (
            <div className="mt-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-caption font-medium text-text-primary">Diagnostic log</p>
                  <p className="text-caption text-text-muted">Records each sync step (what changed, when it was sent, noticed, received and shown) — kinds and ids only, never note text. For troubleshooting.</p>
                </div>
                <Switch checked={!!trace?.enabled} onCheckedChange={() => void api.setDiagnostics!(!trace?.enabled).then(refresh)} />
              </div>
              {trace?.enabled && (
                <div className="mt-2">
                  <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard.writeText(traceText(trace.entries)).catch(() => {})}>Copy log</Button>
                  <pre className="mt-1 max-h-64 overflow-auto text-[11px] leading-snug font-mono text-text-secondary whitespace-pre-wrap">{traceText(trace.entries.slice(-80)) || 'Nothing yet.'}</pre>
                </div>
              )}
            </div>
          )}
          {status.devices.length > 0 && (
            <div className="mt-3">
              <p className="text-caption text-text-muted mb-1">Devices</p>
              <ul className="text-caption text-text-secondary space-y-0.5">
                {status.devices.map((d) => (
                  <li key={d.device}>{d.name} <span className="text-text-muted">({d.platform})</span> — {d.applied}/{d.seq} changes applied{d.device === status.deviceId ? ' (this device)' : d.lastSeenAt ? ` · last seen ${new Date(d.lastSeenAt).toLocaleString()}` : ''}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function traceText(entries: SyncTraceEntry[]): string {
  return entries.map((e) => `${new Date(e.t).toLocaleTimeString()}.${String(e.t % 1000).padStart(3, '0')} ${e.event}${e.meta ? ' ' + Object.entries(e.meta).map(([k, v]) => `${k}=${v}`).join(' ') : ''}`).join('\n')
}
