import { useEffect, useState } from 'react'
import { RefreshCcw, FolderOpen } from 'lucide-react'
import { Switch, Button } from '@/components/ui'
import type { SyncConfig } from '@/types/electron'
import type { SyncStatusSnapshot } from '@/platform/sync/types'

/**
 * Settings → iCloud (docs/mobile/icloud.md; R064). Shared by desktop and, later, the iPhone
 * settings page: it only talks to `window.sync`, which each platform's host implements.
 */
export default function ICloudSection() {
  const api = typeof window !== 'undefined' ? window.sync : undefined
  const [config, setConfig] = useState<SyncConfig | null>(null)
  const [status, setStatus] = useState<SyncStatusSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const refresh = async () => {
    if (!api) return
    setConfig(await api.getConfig().catch(() => null))
    setStatus(await api.getStatus().catch(() => null))
  }

  useEffect(() => {
    void refresh()
    return api?.onStatus((s) => setStatus(s))
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

      {status && (
        <div>
          <div className="flex items-center justify-between">
            <p className="text-subhead font-medium text-text-primary">Status</p>
            <Button size="sm" variant="ghost" icon={RefreshCcw} onClick={() => void api!.syncNow().then(refresh)}>Sync now</Button>
          </div>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-caption">
            <dt className="text-text-muted">Transport</dt><dd className="text-text-secondary">{status.transport.available ? 'available' : `unavailable — ${status.transport.reason ?? ''}`}</dd>
            <dt className="text-text-muted">Pending changes</dt><dd className="text-text-secondary">{status.pendingOutbox}</dd>
            <dt className="text-text-muted">Last push / pull</dt><dd className="text-text-secondary">{fmt(status.lastPushAt)} / {fmt(status.lastPullAt)}</dd>
            <dt className="text-text-muted">This device</dt><dd className="text-text-secondary font-mono">{status.deviceId}</dd>
            {status.unreadable > 0 && (<><dt className="text-text-muted">Unreadable entries</dt><dd className="text-danger">{status.unreadable}</dd></>)}
            {status.journal && (<><dt className="text-text-muted">This device's journal</dt><dd className="text-text-secondary">{status.journal.files} file{status.journal.files === 1 ? '' : 's'}, {(status.journal.bytes / 1024).toFixed(0)} KB{status.journal.snapshotSeq != null ? ` · compacted at change #${status.journal.snapshotSeq}` : ''}</dd></>)}
            {status.lastError && (<><dt className="text-text-muted">Last error</dt><dd className="text-danger">{status.lastError}</dd></>)}
          </dl>
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
