import React, { Fragment, useEffect, useState } from 'react'
import { RefreshCcw, FolderOpen, Check, Circle, Loader2 } from 'lucide-react'
import { Switch, Button } from '@/components/ui'
import type { SyncStatusSnapshot, SyncTraceEntry } from '@/platform/sync/types'
import { useSyncUi, wireSyncUi, presentSync, progressFraction, groupProgress, formatSyncedAt, describeDevices } from '@/lib/syncUi'

/**
 * Settings → iCloud (DATA-UX-001…): the detailed iCloud page on both apps (the Mac's Settings
 * section, the iPhone's iCloud page). The toggle, status and progress come from the ONE shared
 * store (lib/syncUi) — the iPhone's compact Settings row reads the same store, so both toggles
 * always agree. Order: toggle → status (+ first-sync progress) → holds → last synced / counts →
 * devices → Advanced (diagnostics, collapsed).
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

/**
 * First-sync / sync progress (DATA-UX-010): determinate only where the engine knows the total
 * (changes to apply / upload, devices to read); otherwise an honest indeterminate indicator.
 * Stages list the kinds of data actually in this pass.
 */
export function SyncProgressPanel({ compact = false }: { compact?: boolean }) {
  const { config, status, setupInProgress, busy } = useSyncUi()
  const pres = presentSync(config, status, { setupInProgress, busy })
  const p = status?.progress ?? null
  if (!pres.busy && !setupInProgress) return null
  const frac = progressFraction(p)
  const groups = groupProgress(p)
  const first = !!p?.firstSync || setupInProgress
  const stage = (label: string, state: 'done' | 'active' | 'todo') => (
    <li key={label} className="flex items-center gap-2 text-caption">
      {state === 'done' ? <Check size={14} aria-hidden className="text-success" /> : state === 'active' ? <Loader2 size={14} aria-hidden className="animate-spin motion-reduce:animate-none text-accent" /> : <Circle size={10} aria-hidden className="text-text-muted" />}
      <span className={state === 'todo' ? 'text-text-muted' : 'text-text-primary'}>{label}</span>
      <span className="sr-only">{state === 'done' ? 'done' : state === 'active' ? 'in progress' : 'waiting'}</span>
    </li>
  )
  const activity = p?.activity
  const order = ['checking', 'fetching', 'applying', 'uploading', 'finalizing']
  const idx = activity ? order.indexOf(activity) : 0
  return (
    <div className="glass-surface-regular rounded-[var(--radius-card)] p-3 space-y-2" aria-live="polite">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-subhead font-medium text-text-primary">{first ? 'Setting up iCloud…' : 'Syncing…'}</p>
        <p className="text-caption text-text-secondary tabular-nums">{pres.short}</p>
      </div>
      {frac != null
        ? <div className="sync-progress" role="progressbar" aria-label={pres.short} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(frac * 100)}><span style={{ width: `${Math.round(frac * 100)}%` }} /></div>
        : <div className="sync-progress is-indeterminate" role="progressbar" aria-label={pres.short}><span /></div>}
      {!compact && (
        <ul className="space-y-1">
          {stage('Connecting to iCloud', idx > 0 ? 'done' : 'active')}
          {stage('Checking your other devices', idx > 1 ? 'done' : idx === 1 ? 'active' : 'todo')}
          {groups.map((g) => stage(`${g.label}${g.complete ? '' : ` — ${g.done} of ${g.total}`}`, g.complete ? 'done' : activity === 'applying' ? 'active' : 'todo'))}
          {activity === 'uploading' && stage(`Sending this device’s changes${p?.total ? ` — ${p.done} of ${p.total}` : ''}`, 'active')}
          {stage('Finishing', activity === 'finalizing' ? 'active' : 'todo')}
        </ul>
      )}
      {first && <p className="text-caption text-text-muted">You can keep using Berean — this continues in the background.</p>}
    </div>
  )
}

export default function ICloudSection({ variant = 'desktop', renderSwitch }: {
  variant?: 'desktop' | 'mobile'
  /** The platform's own switch (the iPhone passes its iOS-style toggle). */
  renderSwitch?: (p: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) => React.ReactNode
}) {
  const api = typeof window !== 'undefined' ? window.sync : undefined
  const { config, status, busy, error, setupInProgress, setEnabled, refresh } = useSyncUi()
  const [trace, setTrace] = useState<{ enabled: boolean; entries: SyncTraceEntry[] } | null>(null)
  const [holdBusy, setHoldBusy] = useState(false)

  useEffect(() => {
    wireSyncUi()
    void refresh()
    if (api?.getTrace) void api.getTrace().then(setTrace).catch(() => {})
    // While this page is open, re-read the status now and then: iCloud can finish an upload /
    // download between sync passes (the daemon does not notify for that). DISPLAY only — it never
    // triggers a sync; syncing itself is event-driven (docs/mobile/sync.md).
    const t = setInterval(() => { void api?.getStatus().then((s) => useSyncUi.setState({ status: s })).catch(() => {}); if (api?.getTrace) void api.getTrace().then(setTrace).catch(() => {}) }, 5000)
    return () => clearInterval(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!api) return <p className="text-caption text-text-muted">iCloud sync is not available in this window.</p>

  const on = !!config?.enabled
  const pres = presentSync(config, status, { setupInProgress, busy })
  const devices = describeDevices(status)
  const toneClass = pres.tone === 'good' ? 'text-success' : pres.tone === 'warning' ? 'text-warning' : pres.tone === 'danger' ? 'text-danger' : 'text-text-secondary'
  const fmt = (t: number | null) => (t ? new Date(t).toLocaleTimeString() : '—')

  return (
    <div className={`space-y-5 icloud-section is-${variant}`}>
      <div className="icloud-group">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-subhead font-medium text-text-primary">iCloud Sync</p>
            <p className="s-desc text-caption text-text-muted mt-0.5">
              Keeps notes, highlights, verse tags, tabs and workspaces the same on every device signed into your iCloud account. Bible texts never sync — they ship with the app. Works offline.
            </p>
          </div>
          <div className="shrink-0">
            {renderSwitch
              ? renderSwitch({ checked: on, onChange: (v) => void setEnabled(v), label: 'iCloud Sync', disabled: busy })
              : <Switch checked={on} aria-label="iCloud Sync" onCheckedChange={() => void setEnabled(!on)} disabled={busy} />}
          </div>
        </div>
        {error && <p className="text-caption text-danger mt-2" role="alert">{error}</p>}
        <div className="icloud-status mt-3">
          <p className="text-caption text-text-muted">Status</p>
          <p className={`text-subhead font-medium ${toneClass}`}>{pres.short}</p>
          <p className="text-caption text-text-muted">{pres.detail}</p>
        </div>
      </div>

      <SyncProgressPanel />

      {status?.hold && (() => {
        const t = holdText(status.hold)
        const act = async (fn: () => Promise<unknown>) => { setHoldBusy(true); try { await fn() } finally { setHoldBusy(false); await refresh() } }
        return (
          <div className="rounded-md border border-warning/40 bg-warning/10 p-3 space-y-2" role="alert">
            <p className="text-subhead font-medium text-text-primary">{t.title}</p>
            <p className="text-caption text-text-secondary">{t.body}</p>
            <div className="flex flex-wrap gap-2">
              {status.hold.kind === 'quarantine' && api.resolveHold && (<>
                <Button size="sm" disabled={holdBusy} onClick={() => void act(() => api.resolveHold!('restore'))}>Restore from iCloud</Button>
                <Button size="sm" variant="ghost" disabled={holdBusy} onClick={() => { if (confirm('Delete these items from iCloud and every device? Only do this if you deleted them yourself.')) void act(() => api.resolveHold!('delete')) }}>They were deleted</Button>
              </>)}
              {(status.hold.kind === 'account' || status.hold.kind === 'container') && api.resolveHold && (
                <Button size="sm" variant="ghost" disabled={holdBusy} onClick={() => { if (confirm('Upload everything on this device to the iCloud account that is signed in now? Nothing is deleted anywhere.')) void act(() => api.resolveHold!('republish')) }}>Use this iCloud for this device’s data…</Button>
              )}
            </div>
          </div>
        )
      })()}

      {on && status && (
        <dl className="icloud-group grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-caption">
          <dt className="text-text-muted">Last synced</dt><dd className="text-text-secondary">{formatSyncedAt(status.lastSyncedAt)}</dd>
          <dt className="text-text-muted">Changes waiting</dt><dd className="text-text-secondary">{status.pendingOutbox}</dd>
          <dt className="text-text-muted">Conflicts kept</dt><dd className="text-text-secondary">{(status.conflicts ?? 0) + (status.mergeConflicts ?? 0)}{(status.conflicts ?? 0) > 0 ? ' — note conflicts are in each note’s Versions' : ''}</dd>
          <dt className="text-text-muted">Failed changes</dt><dd className={status.failedOps ? 'text-danger' : 'text-text-secondary'}>{status.failedOps ?? 0}{status.failedOps ? ' — retried automatically' : ''}</dd>
        </dl>
      )}

      {on && devices.length > 0 && (
        <div className="icloud-group">
          <p className="text-caption text-text-muted mb-1">Devices</p>
          <ul className="text-caption space-y-1">
            {devices.map((d) => (
              <li key={d.id} className="flex items-baseline justify-between gap-3">
                <span className={d.inactive ? 'text-text-muted' : 'text-text-primary'}>{d.isThis ? `This ${d.platform === 'ios' ? 'iPhone' : 'Mac'}` : d.name}{d.inactive ? ' (inactive)' : ''}</span>
                <span className="text-text-muted">{d.isThis ? pres.short : d.lastSeenAt ? `last active ${formatSyncedAt(d.lastSeenAt)}` : ''}</span>
              </li>
            ))}
          </ul>
          <p className="text-caption text-text-muted mt-1">Devices that have not synced for 90 days are shown as inactive — for example a device Berean was deleted from. They never affect your data.</p>
        </div>
      )}


      {variant === 'desktop' && (
        <div>
          <p className="text-subhead font-medium text-text-primary mb-1">Sync folder</p>
          <p className="s-desc text-caption text-text-muted mb-2">
            {config?.folderOverride ? 'A folder you chose inside iCloud Drive.' : 'Berean’s own iCloud container. It appears on this Mac after Berean has been opened once on your iPhone.'}
            {config && !config.containerExists && !config.folderOverride && ' Not found yet on this Mac.'}
          </p>
          <p className="text-caption font-mono text-text-secondary break-all">{config?.folder ?? '…'}</p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="ghost" icon={FolderOpen} onClick={() => void api.chooseFolder().then((r) => { if (!r.canceled) void refresh() })}>Choose folder in iCloud Drive…</Button>
            {config?.folderOverride && <Button size="sm" variant="ghost" onClick={() => void api.useDefaultFolder().then(refresh)}>Use Berean container</Button>}
          </div>
        </div>
      )}

      {status && (
        <details className="settings-advanced icloud-group">
          <summary className="text-subhead font-medium text-text-primary cursor-pointer">Advanced</summary>
          <div className="mt-2 flex items-center justify-end">
            <Button size="sm" variant="ghost" icon={RefreshCcw} onClick={() => void api.syncNow().then(refresh)}>Sync now</Button>
          </div>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-caption">
            <dt className="text-text-muted">Transport</dt><dd className="text-text-secondary">{status.transport.available ? 'available' : `unavailable — ${status.transport.reason ?? ''}`}</dd>
            {status.state && (<><dt className="text-text-muted">State</dt><dd className={status.state === 'attention' ? 'text-danger' : 'text-text-secondary'}>{STATE_LABEL[status.state]}</dd></>)}
            {status.pendingUploads != null && (<><dt className="text-text-muted">Waiting for iCloud upload</dt><dd className="text-text-secondary">{status.pendingUploads} file{status.pendingUploads === 1 ? '' : 's'}</dd></>)}
            {!!status.remoteBehind && (<><dt className="text-text-muted">Still to receive</dt><dd className="text-text-secondary">{status.remoteBehind} change{status.remoteBehind === 1 ? '' : 's'} from other devices</dd></>)}
            {status.lastNotifiedAt != null && (<><dt className="text-text-muted">Last iCloud notification</dt><dd className="text-text-secondary">{fmt(status.lastNotifiedAt)}</dd></>)}
            {status.lastApplied && (<><dt className="text-text-muted">Last received</dt><dd className="text-text-secondary">{status.lastApplied.count} change{status.lastApplied.count === 1 ? '' : 's'} · {fmt(status.lastApplied.at)}</dd></>)}
            {!!status.forks && (<><dt className="text-text-muted">Restored / copied database</dt><dd className="text-text-secondary">detected {status.forks}× — resynced as a new device</dd></>)}
            {status.lastFullReconcile != null && (<><dt className="text-text-muted">Last full check</dt><dd className="text-text-secondary">{new Date(status.lastFullReconcile).toLocaleString()}</dd></>)}
            <dt className="text-text-muted">Last push / pull</dt><dd className="text-text-secondary">{fmt(status.lastPushAt)} / {fmt(status.lastPullAt)}</dd>
            <dt className="text-text-muted">This device</dt><dd className="text-text-secondary font-mono">{status.deviceId}</dd>
            {status.unreadable > 0 && (<><dt className="text-text-muted">Unreadable entries</dt><dd className="text-danger">{status.unreadable}</dd></>)}
            {status.journal && (<><dt className="text-text-muted">This device's journal</dt><dd className="text-text-secondary">{status.journal.files} file{status.journal.files === 1 ? '' : 's'}, {(status.journal.bytes / 1024).toFixed(0)} KB{status.journal.snapshotSeq != null ? ` · compacted at change #${status.journal.snapshotSeq}` : ''}</dd></>)}
            {status.lastError && (<><dt className="text-text-muted">Last error</dt><dd className="text-danger">{status.lastError}</dd></>)}
            {status.schema != null && (<><dt className="text-text-muted">Database schema</dt><dd className="text-text-secondary">v{status.schema}</dd></>)}
            {status.devices.map((d) => (<Fragment key={d.device}><dt className="text-text-muted">{d.name}</dt><dd className="text-text-secondary">{d.platform} · {d.applied}/{d.seq} changes applied</dd></Fragment>))}
          </dl>
          {api.getTrace && api.setDiagnostics && (
            <div className="mt-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-caption font-medium text-text-primary">Diagnostic log</p>
                  <p className="text-caption text-text-muted">Records each sync step — kinds and ids only, never note text. For troubleshooting.</p>
                </div>
                <Switch checked={!!trace?.enabled} aria-label="Diagnostic log" onCheckedChange={() => void api.setDiagnostics!(!trace?.enabled).then(() => api.getTrace!().then(setTrace))} />
              </div>
              {trace?.enabled && (
                <div className="mt-2">
                  <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard.writeText(traceText(trace.entries)).catch(() => {})}>Copy log</Button>
                  <pre className="mt-1 max-h-64 overflow-auto text-[11px] leading-snug font-mono text-text-secondary whitespace-pre-wrap">{traceText(trace.entries.slice(-80)) || 'Nothing yet.'}</pre>
                </div>
              )}
            </div>
          )}
        </details>
      )}
    </div>
  )
}

function traceText(entries: SyncTraceEntry[]): string {
  return entries.map((e) => `${new Date(e.t).toLocaleTimeString()}.${String(e.t % 1000).padStart(3, '0')} ${e.event}${e.meta ? ' ' + Object.entries(e.meta).map(([k, v]) => `${k}=${v}`).join(' ') : ''}`).join('\n')
}
