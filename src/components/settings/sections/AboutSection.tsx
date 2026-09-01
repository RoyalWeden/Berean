import { useState, useEffect } from 'react'
import { RotateCcw, BookOpen, ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import { useAppStore } from '@/store'
import { clearChapterCache } from '@/lib/chapterCache'
import { clearNoteCache } from '@/lib/noteCache'
import { clearWarmStartNotes } from '@/lib/notesCache'
import { __resetPanelDataCache } from '@/lib/panelDataCache'

// ── Dev-only: simulate first launch ──────────────────────────────────────────

function SimulateFirstLaunchButton() {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  async function handleReset() {
    if (!confirming) { setConfirming(true); return }
    setBusy(true)
    try {
      // 1. Clear every onboarding/tasks/vault-setup setting from SQLite
      const keysToReset = [
        'onboardingCompleted',
        'vaultSync',
        'vaultPath',
        'autoUpdate',
      ]
      await Promise.all(keysToReset.map(k => window.settings?.set(k, null).catch(() => {})))

      // 2. Immediately wipe in-memory tabs so nothing leaks into the next render
      const emptyTabs = { scripture: [], notes: [], lexicon: [], youtube: [], search: [] }
      const emptyActiveTabId = { scripture: null, notes: null, lexicon: null, youtube: null, search: null }
      useAppStore.setState({
        tabs: emptyTabs,
        activeTabId: emptyActiveTabId,
        sessions: [{ id: 'default', name: 'Session 1', tabs: emptyTabs, activeTabId: emptyActiveTabId }],
        currentSessionId: 'default',
        sessionDisplayOrders: {},
        onboardingCompleted: false,
        tasksVisible: false,
        completedTaskIds: [],
        completedStepIds: [],
        verseNoteToken: 0,
        strongsHoverToken: 0,
        versePopoverToken: 0,
        noteEditToken: 0,
        tableInsertToken: 0,
        settingsNavToken: 0,
        floatingTabToken: 0,
        youtubePipToken: 0,
        vaultSyncToken: 0,
      })

      // 3. Wipe the Zustand localStorage store so it reinitialises with defaults
      //    (tabs, tasks, theme, etc. all return to factory state)
      localStorage.removeItem('berean-app-state')

      // 4. Reload — App.tsx mount effect will see onboardingCompleted=false and
      //    open the onboarding wizard, exactly as on first install.
      location.reload()
    } catch {
      setBusy(false)
      setConfirming(false)
    }
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-orange-500/40 bg-orange-500/5">
      <span className="text-[10px] font-mono text-orange-400 flex-shrink-0">DEV</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-orange-300">Simulate first launch</p>
        <p className="text-[10px] text-orange-400/70 leading-snug">
          Clears all onboarding state &amp; reloads. Tests the full first-run experience.
        </p>
      </div>
      <button
        onClick={handleReset}
        disabled={busy}
        className={`flex-shrink-0 px-2.5 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-50 ${
          confirming
            ? 'bg-orange-500 text-white hover:bg-orange-600'
            : 'bg-[rgb(var(--color-surface-4))] text-orange-300 hover:bg-orange-500/20'
        }`}
      >
        {busy ? 'Resetting…' : confirming ? 'Confirm reset' : 'Reset'}
      </button>
      {confirming && !busy && (
        <button
          onClick={() => setConfirming(false)}
          className="flex-shrink-0 text-[10px] text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
        >
          Cancel
        </button>
      )}
    </div>
  )
}

function RebuildSeedButton() {
  const [status, setStatus] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const [result, setResult] = useState('')

  async function handleRebuild() {
    if (status === 'busy') return
    setStatus('busy')
    setResult('')
    try {
      const res = await window.youtube.buildSeed()
      if ('error' in res) {
        setStatus('error')
        setResult(res.error)
      } else {
        setStatus('done')
        setResult(`${res.videos} videos · ${res.transcripts} transcripts · ${res.segments} segments`)
      }
    } catch (err) {
      setStatus('error')
      setResult(String(err))
    }
  }

  return (
    <div className="flex items-start gap-2">
      <button
        onClick={handleRebuild}
        disabled={status === 'busy'}
        className="flex-shrink-0 px-2.5 py-1 rounded text-[11px] font-medium bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-accent))/20] hover:text-[rgb(var(--color-accent))] transition-colors cursor-pointer disabled:opacity-50"
      >
        {status === 'busy' ? 'Building…' : 'Rebuild youtube_seed.db'}
      </button>
      {status !== 'idle' && status !== 'busy' && (
        <span className={`text-[11px] mt-0.5 ${status === 'done' ? 'text-green-400' : 'text-red-400'}`}>
          {status === 'done' ? `Done — ${result}` : `Error: ${result}`}
        </span>
      )}
    </div>
  )
}

export default function AboutSection() {
  const closeSettings = useAppStore((s) => s.closeSettings)
  const openOnboarding = useAppStore((s) => s.openOnboarding)
  const resetTasks = useAppStore((s) => s.resetTasks)
  const [version, setVersion] = useState('')
  const [isDev, setIsDev] = useState(false)
  const [showDevGuide, setShowDevGuide] = useState(false)
  const [recreating, setRecreating] = useState(false)
  const [cacheCleared, setCacheCleared] = useState(false)

  function handleClearCache() {
    clearChapterCache()
    clearNoteCache()
    clearWarmStartNotes()
    __resetPanelDataCache()
    setCacheCleared(true)
    setTimeout(() => setCacheCleared(false), 2000)
  }

  useEffect(() => {
    window.app.getVersion().then(setVersion).catch(() => {})
    window.app.isDev?.().then(setIsDev).catch(() => {})
  }, [])

  function handleReplayOnboarding() {
    closeSettings()
    setTimeout(() => {
      window.settings?.set('onboardingCompleted', false).catch(() => {})
      resetTasks()
      openOnboarding()
    }, 200)
  }

  async function handleRecreateNotes() {
    setRecreating(true)
    try {
      const { createGettingStartedNotes } = await import('@/components/shell/Onboarding')
      await createGettingStartedNotes()
    } catch { /* non-fatal */ } finally {
      setRecreating(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold text-[rgb(var(--color-text-primary))]">Berean</p>
        <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] mt-0.5">Desktop Bible study for Yehovah's servants</p>
        <span className="s-desc text-xs text-[rgb(var(--color-text-muted))] font-mono mt-2 block">
          {version ? `v${version}` : '—'}{isDev ? ' (dev)' : ''}
        </span>
      </div>

      {/* Replay onboarding */}
      <button
        onClick={handleReplayOnboarding}
        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[rgb(var(--color-surface-4))] text-sm text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer w-full text-left"
      >
        <RotateCcw size={13} className="flex-shrink-0 text-[rgb(var(--color-accent))]" />
        Replay getting started walkthrough
      </button>

      {/* Recreate Getting Started notes */}
      <button
        onClick={handleRecreateNotes}
        disabled={recreating}
        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[rgb(var(--color-surface-4))] text-sm text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer w-full text-left disabled:opacity-50"
      >
        <BookOpen size={13} className="flex-shrink-0 text-[rgb(var(--color-accent))]" />
        {recreating ? 'Creating…' : 'Recreate Getting Started notes'}
      </button>

      {/* Clear in-memory content caches (chapters, notes, side-panel fetches). Harmless — the
          app just refetches on next open. Useful if a stale cached chapter/note is showing. */}
      <button
        onClick={handleClearCache}
        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[rgb(var(--color-surface-4))] text-sm text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer w-full text-left"
      >
        <Trash2 size={13} className="flex-shrink-0 text-[rgb(var(--color-accent))]" />
        {cacheCleared ? 'Cached content cleared' : 'Clear cached content'}
      </button>
      <div className="p-3 rounded-lg bg-[rgb(var(--color-surface-3))] border border-[rgb(var(--color-surface-4))]">
        <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] leading-relaxed">
          Texts included: KJV, KJVA (with Apocrypha), Brenton LXX, 1 Enoch, Jubilees, Apocalypse of Elijah,
          Ascension of Isaiah, Epistle of Barnabas (Sharpe 1880), Testaments of the Twelve Patriarchs,
          Recognitions of Clement, and Shepherd of Hermas — all public domain.
          Strong's lexicons from OpenScriptures.
        </p>
      </div>
      {isDev && (
        <div className="space-y-2">
          {/* ── Simulate first launch ─────────────────────────────── */}
          <SimulateFirstLaunchButton />

          <button
            onClick={() => setShowDevGuide((v) => !v)}
            className="flex items-center gap-2 text-xs text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
          >
            {showDevGuide ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            Developer release workflow
          </button>
          {showDevGuide && (
            <div className="mt-2 p-3 rounded-lg bg-[rgb(var(--color-surface-3))] border border-[rgb(var(--color-surface-4))] space-y-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))]">How to release a new version</p>
              <ol className="space-y-1.5 text-xs text-[rgb(var(--color-text-secondary))] leading-relaxed list-none">
                {[
                  ['1', 'Bump the version in package.json (e.g. "0.1.0" → "0.2.0")'],
                  ['2', 'Run: export GH_TOKEN=your_token (needs "repo" scope on RoyalWeden/Berean)'],
                  ['3', 'Run: npm run build:draft — builds the arm64 DMG and creates a draft GitHub Release'],
                  ['4', 'Go to github.com/RoyalWeden/Berean/releases → review the draft → click Publish'],
                  ['5', 'The installed beta app auto-checks on next launch (6 s delay) and shows a notification'],
                ].map(([n, text]) => (
                  <li key={n} className="flex gap-2">
                    <span className="text-[rgb(var(--color-accent))] font-mono flex-shrink-0">{n}.</span>
                    <span>{text}</span>
                  </li>
                ))}
              </ol>
              <div className="border-t border-[rgb(var(--color-surface-4))] pt-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))] mb-1">Local test build (no GitHub)</p>
                <p className="text-xs text-[rgb(var(--color-text-secondary))]">Run <kbd className="font-mono bg-[rgb(var(--color-surface-4))] px-1 rounded">npm run build:local</kbd> — outputs the DMG to <span className="font-mono">release/</span> without publishing</p>
              </div>
              <div className="border-t border-[rgb(var(--color-surface-4))] pt-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))] mb-1">Data separation</p>
                <p className="text-xs text-[rgb(var(--color-text-secondary))]">Dev userData: <span className="font-mono">~/Library/Application Support/Berean-dev</span> · Prod: <span className="font-mono">~/Library/Application Support/Berean</span></p>
              </div>
              <div className="border-t border-[rgb(var(--color-surface-4))] pt-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))] mb-1">Transcript seed workflow</p>
                <p className="text-xs text-[rgb(var(--color-text-secondary))] mb-2">
                  After running <span className="font-mono">fetchTranscripts</span> in the YouTube tab, rebuild the seed DB so the next release ships updated data to users.
                  Then bump <span className="font-mono">SEED_VERSION</span> in <span className="font-mono">electron/db/berean.ts</span> before building.
                </p>
                <RebuildSeedButton />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
