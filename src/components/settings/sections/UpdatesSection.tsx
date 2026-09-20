import { useState, useEffect } from 'react'
import { RefreshCw, Download, RotateCcw } from 'lucide-react'
import { Switch, Button } from '@/components/ui'
import { useAppStore } from '@/store'

const BEREAN_SITE_URL = 'https://royalweden.github.io/Berean'

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 30) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

export default function UpdatesSection() {
  const [version, setVersion] = useState('')
  const [isMas, setIsMas] = useState(false)
  const [autoCheck, setAutoCheck] = useState(true)
  const [betaChannel, setBetaChannel] = useState(false)
  const [autoDownload, setAutoDownload] = useState(false)
  // Read the mirrored status from the store (App.tsx owns the single global
  // onUpdateStatus subscription — see its comment) rather than subscribing
  // here too, since the preload bridge only supports one active listener.
  const updateStatus = useAppStore((s) => s.updateStatus)
  const setUpdateStatus = useAppStore((s) => s.setUpdateStatus)
  const lastCheckedAt = useAppStore((s) => s.updateLastCheckedAt)

  useEffect(() => {
    window.app.getVersion().then(setVersion).catch(() => {})
    window.settings.get('autoUpdate').then((v) => setAutoCheck(v !== false)).catch(() => {})
    window.settings.get('updateChannel').then((v) => setBetaChannel(v === 'beta')).catch(() => {})
    window.settings.get('autoDownloadUpdate').then((v) => setAutoDownload(v === true)).catch(() => {})
    window.app.isMasBuild?.().then((mas) => {
      if (mas) { setIsMas(true); setUpdateStatus({ status: 'mas' }) }
    }).catch(() => {})
  }, [setUpdateStatus])

  async function toggleAutoCheck(enabled: boolean) {
    setAutoCheck(enabled)
    await window.settings.set('autoUpdate', enabled)
    // Auto-download only makes sense alongside auto-check (nothing left to trigger a
    // download otherwise) — turning auto-check off also turns it off, both in the UI
    // (the toggle below is hidden entirely once autoCheck is false) and in the actual
    // setting, so re-enabling auto-check later doesn't silently resurrect a stale
    // auto-download preference the user never re-confirmed.
    if (!enabled && autoDownload) {
      setAutoDownload(false)
      await window.settings.set('autoDownloadUpdate', false)
    }
  }

  async function toggleBeta(enabled: boolean) {
    setBetaChannel(enabled)
    await window.settings.set('updateChannel', enabled ? 'beta' : 'stable')
  }

  async function toggleAutoDownload(enabled: boolean) {
    setAutoDownload(enabled)
    await window.settings.set('autoDownloadUpdate', enabled)
  }

  async function checkNow() {
    setUpdateStatus({ status: 'checking' })
    await window.app.checkForUpdates()
  }

  async function downloadUpdate() {
    setUpdateStatus({ status: 'downloading', percent: 0 })
    await window.app.downloadUpdate()
  }

  function installUpdate() { window.app.installUpdate() }

  const st = updateStatus.status

  // ── MAS build: clean App Store UI ─────────────────────────────────────────
  if (isMas) {
    return (
      <div className="space-y-5">
        <div>
          <p className="text-subhead font-semibold text-text-primary">Berean</p>
          <p className="text-caption text-text-muted font-mono mt-0.5">{version ? `v${version}` : '—'}</p>
        </div>
        <div className="px-4 py-4 rounded-card bg-surface-elevated space-y-3">
          <p className="text-subhead font-medium text-text-primary">Updates via Mac App Store</p>
          <p className="text-caption text-text-muted leading-relaxed">
            This copy of Berean was installed from the Mac App Store. Updates are delivered automatically by Apple — no manual action needed. To check now, open the App Store and go to Updates.
          </p>
          <Button variant="secondary" size="sm" onClick={() => window.app.openExternal('macappstore://apps.apple.com')}>
            Open App Store
          </Button>
        </div>
        <div className="flex items-center gap-2 text-caption text-text-muted">
          <span>Download page & release notes:</span>
          <Button variant="ghost" size="sm" onClick={() => window.app.openExternal(BEREAN_SITE_URL)}>
            royalweden.github.io/Berean
          </Button>
        </div>
      </div>
    )
  }

  // ── GitHub / direct distribution UI ───────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Version badge */}
      <div>
        <p className="text-subhead font-semibold text-text-primary">Berean</p>
        <p className="s-desc text-caption text-text-muted font-mono mt-0.5">
          {version ? `v${version}` : '—'}
        </p>
      </div>

      {/* Auto-check toggle */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-subhead font-medium text-text-primary">Check for updates automatically</p>
          <p className="s-desc text-caption text-text-muted mt-0.5">
            Checks on launch (6 seconds after startup), then again every 5 minutes while Berean stays open
          </p>
        </div>
        <Switch checked={autoCheck} onCheckedChange={() => toggleAutoCheck(!autoCheck)} />
      </div>

      {/* Auto-download toggle — only meaningful (and only shown) while auto-check is on;
          nothing triggers a download otherwise. toggleAutoCheck already turns this back off
          whenever auto-check is turned off, so there's no stale "on" value hiding here. */}
      {autoCheck && (
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-subhead font-medium text-text-primary">Automatically download updates</p>
            <p className="s-desc text-caption text-text-muted mt-0.5">
              Download as soon as a new version is found — you'll still confirm before restarting to install
            </p>
          </div>
          <Switch checked={autoDownload} onCheckedChange={() => toggleAutoDownload(!autoDownload)} />
        </div>
      )}

      {/* Beta channel toggle */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-subhead font-medium text-text-primary">Beta updates</p>
          <p className="s-desc text-caption text-text-muted mt-0.5">
            Receive pre-release builds — may contain unfinished features or bugs
          </p>
        </div>
        <Switch checked={betaChannel} onCheckedChange={() => toggleBeta(!betaChannel)} checkedColorClass="bg-warning" />
      </div>

      {/* Status card */}
      <div className="px-3 py-3 rounded-card bg-surface-elevated min-h-[52px]">
        {st === 'idle' && (
          <p className="s-desc text-caption text-text-muted">Click "Check for Updates" to check now.</p>
        )}
        {st === 'checking' && (
          <p className="s-desc text-caption text-text-muted animate-pulse">Checking for updates…</p>
        )}
        {st === 'current' && (
          <p className="text-caption text-success">You're on the latest version.</p>
        )}
        {st === 'available' && (
          <p className="text-caption text-accent">
            Version {updateStatus.version} is available.
          </p>
        )}
        {st === 'downloading' && (
          <div>
            <p className="s-desc text-caption text-text-muted mb-2">
              Downloading update… {updateStatus.percent ?? 0}%
            </p>
            <div className="h-1.5 bg-lift-2 rounded-control overflow-hidden">
              <div
                className="h-full bg-accent rounded-control transition-all duration-300"
                style={{ width: `${updateStatus.percent ?? 0}%` }}
              />
            </div>
          </div>
        )}
        {st === 'ready' && (
          <p className="text-caption text-success">
            Version {updateStatus.version} downloaded — ready to install.
          </p>
        )}
        {st === 'error' && (
          <p className="text-caption text-destructive leading-relaxed">
            {updateStatus.message ?? 'Unknown error during update check.'}
          </p>
        )}
        {(st === 'current' || st === 'error' || st === 'available' || st === 'ready') && lastCheckedAt && (
          <p className="text-caption2 text-text-muted mt-1.5">
            Last checked {timeAgo(lastCheckedAt)}
          </p>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        {(st === 'idle' || st === 'current' || st === 'error') && (
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={checkNow}>
            Check for Updates
          </Button>
        )}
        {st === 'available' && (
          <Button variant="primary" size="sm" icon={Download} onClick={downloadUpdate}>
            Download Update
          </Button>
        )}
        {st === 'ready' && (
          <Button variant="primary" size="sm" icon={RotateCcw} onClick={installUpdate}>
            Restart & Install
          </Button>
        )}
      </div>

      {/* Footer: GitHub Pages link + distribution note */}
      <div className="px-3 py-2 rounded-card bg-surface-elevated space-y-1.5">
        <div className="flex items-center gap-2 text-caption text-text-muted">
          <span>Download page & release notes:</span>
          <Button variant="ghost" size="sm" onClick={() => window.app.openExternal(BEREAN_SITE_URL)}>
            royalweden.github.io/Berean
          </Button>
        </div>
        <p className="text-caption2 text-text-muted">
          Only the installed app (not dev build) can receive automatic updates.
        </p>
      </div>
    </div>
  )
}
