import { useState, useEffect } from 'react'
import { RefreshCw, Download, RotateCcw } from 'lucide-react'
import Switch from '@/components/shell/Switch'
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
          <p className="text-sm font-semibold text-[rgb(var(--color-text-primary))]">Berean</p>
          <p className="text-xs text-[rgb(var(--color-text-muted))] font-mono mt-0.5">{version ? `v${version}` : '—'}</p>
        </div>
        <div className="px-4 py-4 rounded-xl bg-[rgb(var(--color-surface-3))] border border-[rgb(var(--color-surface-4))] space-y-3">
          <p className="text-sm text-[rgb(var(--color-text-primary))] font-medium">Updates via Mac App Store</p>
          <p className="text-xs text-[rgb(var(--color-text-muted))] leading-relaxed">
            This copy of Berean was installed from the Mac App Store. Updates are delivered automatically by Apple — no manual action needed. To check now, open the App Store and go to Updates.
          </p>
          <button
            onClick={() => window.app.openExternal('macappstore://apps.apple.com')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
          >
            Open App Store
          </button>
        </div>
        <div className="flex items-center gap-2 text-xs text-[rgb(var(--color-text-muted))]">
          <span>Download page & release notes:</span>
          <button
            onClick={() => window.app.openExternal(BEREAN_SITE_URL)}
            className="text-[rgb(var(--color-accent))] hover:underline cursor-pointer"
          >
            royalweden.github.io/Berean
          </button>
        </div>
      </div>
    )
  }

  // ── GitHub / direct distribution UI ───────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Version badge */}
      <div>
        <p className="text-sm font-semibold text-[rgb(var(--color-text-primary))]">Berean</p>
        <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] font-mono mt-0.5">
          {version ? `v${version}` : '—'}
        </p>
      </div>

      {/* Auto-check toggle */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-[rgb(var(--color-text-primary))]">Check for updates automatically</p>
          <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] mt-0.5">
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
            <p className="text-sm font-medium text-[rgb(var(--color-text-primary))]">Automatically download updates</p>
            <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] mt-0.5">
              Download as soon as a new version is found — you'll still confirm before restarting to install
            </p>
          </div>
          <Switch checked={autoDownload} onCheckedChange={() => toggleAutoDownload(!autoDownload)} />
        </div>
      )}

      {/* Beta channel toggle */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-[rgb(var(--color-text-primary))]">Beta updates</p>
          <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] mt-0.5">
            Receive pre-release builds — may contain unfinished features or bugs
          </p>
        </div>
        <Switch checked={betaChannel} onCheckedChange={() => toggleBeta(!betaChannel)} checkedColorClass="bg-amber-500" />
      </div>

      {/* Status card */}
      <div className="px-3 py-3 rounded-lg bg-[rgb(var(--color-surface-3))] border border-[rgb(var(--color-surface-4))] min-h-[52px]">
        {st === 'idle' && (
          <p className="s-desc text-xs text-[rgb(var(--color-text-muted))]">Click "Check for Updates" to check now.</p>
        )}
        {st === 'checking' && (
          <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] animate-pulse">Checking for updates…</p>
        )}
        {st === 'current' && (
          <p className="text-xs text-green-400">You're on the latest version.</p>
        )}
        {st === 'available' && (
          <p className="text-xs text-[rgb(var(--color-accent))]">
            Version {updateStatus.version} is available.
          </p>
        )}
        {st === 'downloading' && (
          <div>
            <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] mb-2">
              Downloading update… {updateStatus.percent ?? 0}%
            </p>
            <div className="h-1.5 bg-[rgb(var(--color-surface-4))] rounded-full overflow-hidden">
              <div
                className="h-full bg-[rgb(var(--color-accent))] rounded-full transition-all duration-300"
                style={{ width: `${updateStatus.percent ?? 0}%` }}
              />
            </div>
          </div>
        )}
        {st === 'ready' && (
          <p className="text-xs text-green-400">
            Version {updateStatus.version} downloaded — ready to install.
          </p>
        )}
        {st === 'error' && (
          <p className="text-xs text-red-400 leading-relaxed">
            {updateStatus.message ?? 'Unknown error during update check.'}
          </p>
        )}
        {(st === 'current' || st === 'error' || st === 'available' || st === 'ready') && lastCheckedAt && (
          <p className="text-[10px] text-[rgb(var(--color-text-muted))] mt-1.5">
            Last checked {timeAgo(lastCheckedAt)}
          </p>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        {(st === 'idle' || st === 'current' || st === 'error') && (
          <button
            onClick={checkNow}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
          >
            <RefreshCw size={11} />
            Check for Updates
          </button>
        )}
        {st === 'available' && (
          <button
            onClick={downloadUpdate}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-[rgb(var(--color-accent))] text-white hover:opacity-90 transition-opacity cursor-pointer"
          >
            <Download size={11} />
            Download Update
          </button>
        )}
        {st === 'ready' && (
          <button
            onClick={installUpdate}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-[rgb(var(--color-accent))] text-white hover:opacity-90 transition-opacity cursor-pointer"
          >
            <RotateCcw size={11} />
            Restart & Install
          </button>
        )}
      </div>

      {/* Footer: GitHub Pages link + distribution note */}
      <div className="px-3 py-2 rounded-lg bg-[rgb(var(--color-surface-3))] border border-[rgb(var(--color-surface-4))] space-y-1.5">
        <div className="flex items-center gap-2 text-xs text-[rgb(var(--color-text-muted))]">
          <span>Download page & release notes:</span>
          <button
            onClick={() => window.app.openExternal(BEREAN_SITE_URL)}
            className="text-[rgb(var(--color-accent))] hover:underline cursor-pointer"
          >
            royalweden.github.io/Berean
          </button>
        </div>
        <p className="text-[10px] text-[rgb(var(--color-text-muted))]">
          Only the installed app (not dev build) can receive automatic updates.
        </p>
      </div>
    </div>
  )
}
