import { useState, useEffect, useCallback } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Sun, Moon, Monitor, Keyboard, FolderOpen, Trash2, ExternalLink, ChevronDown, ChevronRight, BookOpen, ToggleLeft, ToggleRight, RefreshCw, Download, RotateCcw, Sword } from 'lucide-react'
import { useAppStore } from '@/store'
import { LAYOUT_DEFS } from '@/components/bible/LayoutPicker'
import { YOUTUBE_LAYOUTS } from '@/lib/youtubeLayouts'
import type { WordReplacerRule } from '@/store'
import type { UpdateStatus } from '@/types/electron'
import type { ScriptureLayout } from '@/types'
import BibleGatewayImporter from './BibleGatewayImporter'
import ESwordImporter from './ESwordImporter'
import { BULLET_STYLE_DEFS } from '@/components/notes/NoteEditor'

function YtLayoutSetting() {
  const layout = useAppStore((s) => s.defaultYoutubeLayout)
  const set = useAppStore((s) => s.setDefaultYoutubeLayout)
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {YOUTUBE_LAYOUTS.map((def) => (
        <button
          key={def.id}
          onClick={() => set(def.id)}
          className={`flex flex-col items-start gap-0.5 px-3 py-2 rounded-lg text-left border transition-all cursor-pointer text-xs
            ${layout === def.id
              ? 'border-[rgb(var(--color-accent))] bg-[rgb(var(--color-accent))/10] text-[rgb(var(--color-accent))]'
              : 'border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))]'
            }`}
        >
          <span className="font-semibold">{def.label}</span>
          <span className="text-[9px] text-[rgb(var(--color-text-muted))] leading-snug">{def.description}</span>
        </button>
      ))}
    </div>
  )
}

interface WordReplacerSectionProps {
  enabled: boolean
  rules: WordReplacerRule[]
  onToggleEnabled: (v: boolean) => void
  onToggleRule: (id: string) => void
}

function WordReplacerSection({ enabled, rules, onToggleEnabled, onToggleRule }: WordReplacerSectionProps) {
  return (
    <div className="space-y-5">
      {/* Master toggle */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-[rgb(var(--color-text-primary))]">Word replacer</p>
          <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] mt-0.5">
            Substitute archaic or Latinised names in scripture text with more recognisable forms.
            Only applies to the Scripture tab — never to notes, lexicon, or YouTube.
          </p>
        </div>
        <button
          onClick={() => onToggleEnabled(!enabled)}
          className={`relative flex-shrink-0 w-10 h-5 rounded-full transition-colors cursor-pointer ${
            enabled ? 'bg-[rgb(var(--color-accent))]' : 'bg-[rgb(var(--color-surface-4))]'
          }`}
        >
          <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-5' : ''}`} />
        </button>
      </div>

      {/* Divine name rules (Strong's-number-based, KJVA only) */}
      {(() => {
        const strongsRules = rules.filter(r => r.strongsNum)
        const textRules = rules.filter(r => !r.strongsNum)
        const RuleRow = (rule: WordReplacerRule) => (
          <div
            key={rule.id}
            className={`flex items-center justify-between px-3 py-2 rounded-lg border transition-colors ${
              rule.enabled && enabled
                ? 'border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-3))]'
                : 'border-[rgb(var(--color-surface-4))/50] bg-[rgb(var(--color-surface-3))/50] opacity-60'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <code className="text-[11px] font-mono text-[rgb(var(--color-text-muted))] truncate">
                {rule.strongsNum ?? rule.queries.join(' / ')}
              </code>
              <span className="text-[10px] text-[rgb(var(--color-text-muted))] flex-shrink-0">→</span>
              <span className="text-[11px] text-[rgb(var(--color-text-primary))] font-medium truncate">{rule.replacement}</span>
              {rule.strongsNum && (
                <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/15 text-amber-400 flex-shrink-0 font-semibold">KJVA</span>
              )}
              {rule.wholeWord && (
                <span className="text-[9px] px-1 py-0.5 rounded bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] flex-shrink-0">whole word</span>
              )}
            </div>
            <button
              onClick={() => onToggleRule(rule.id)}
              title={rule.enabled ? 'Disable this rule' : 'Enable this rule'}
              className="flex-shrink-0 ml-2 cursor-pointer"
            >
              {rule.enabled
                ? <ToggleRight size={18} className="text-[rgb(var(--color-accent))]" />
                : <ToggleLeft size={18} className="text-[rgb(var(--color-text-muted))]" />
              }
            </button>
          </div>
        )
        return (
          <>
            {strongsRules.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))]">Divine Name</p>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 font-semibold">KJVA only</span>
                </div>
                <p className="text-[10px] text-[rgb(var(--color-text-muted))] mb-2 leading-relaxed">
                  Matches by Strong's number — precise per-word replacement regardless of how the word is spelled in English. Only applies where Strong's tags are available (KJVA).
                </p>
                <div className="space-y-1">
                  {strongsRules.map(RuleRow)}
                </div>
              </div>
            )}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))] mb-2">Text rules</p>
              <div className="space-y-1">
                {textRules.map(RuleRow)}
              </div>
            </div>
          </>
        )
      })()}
    </div>
  )
}

function MarkdownRefButton({ onClose }: { onClose: () => void }) {
  const open = useAppStore((s) => s.openMarkdownReference)
  return (
    <button
      onClick={() => { onClose(); setTimeout(open, 100) }}
      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[rgb(var(--color-surface-3))] border border-[rgb(var(--color-surface-4))] text-sm text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer w-full text-left"
    >
      <BookOpen size={14} className="flex-shrink-0 text-[rgb(var(--color-accent))]" />
      Markdown reference guide
    </button>
  )
}

const SHORTCUT_GROUPS = [
  {
    label: 'Navigation',
    shortcuts: [
      { key: '⌘1–5', action: 'Switch to space by number' },
      { key: '⌘T', action: 'New tab / floating search' },
      { key: '⌘K / ⌘L', action: 'Floating command bar' },
      { key: '⌘W', action: 'Close current tab' },
      { key: '⌘⇧S', action: 'Toggle sidebar' },
      { key: 'Esc', action: 'Close modal / dismiss popover' },
      { key: '⌘,', action: 'Open settings' },
      { key: 'Ctrl+Tab', action: 'Tab switcher (most recent first)' },
    ],
  },
  {
    label: 'Find in Page',
    shortcuts: [
      { key: '⌘F', action: 'Open find bar (find in current view)' },
      { key: '↵ / ⇧↵', action: 'Next / previous match in find bar' },
      { key: '⌘⇧F', action: 'Advanced full-text search (Search tab)' },
    ],
  },
  {
    label: 'Bible Reader',
    shortcuts: [
      { key: '⌘F', action: 'Find text in current chapter' },
      { key: '⌘/', action: 'Scripture floating search (Cmd+/)' },
      { key: 'Search icon', action: 'Scripture floating search (toolbar button)' },
      { key: 'Advanced search tab', action: 'Full scripture search tab with all text filters' },
    ],
  },
  {
    label: 'Notes',
    shortcuts: [
      { key: '⌘⇧N', action: 'New general note' },
      { key: '⌘⇧M', action: 'Toggle markdown preview' },
      { key: '⌘Z / ⌘⇧Z', action: 'Undo / Redo' },
      { key: '⌘B', action: 'Bold' },
      { key: '⌘I', action: 'Italic' },
      { key: '⌘U', action: 'Underline' },
      { key: '⌘⇧H', action: 'Highlight text (==text==)' },
      { key: '⌘F', action: 'Find text in note (Cmd+F only — no type-anywhere)' },
    ],
  },
  {
    label: 'Lexicon',
    shortcuts: [
      { key: '⌘F', action: 'Find text in lexicon entry' },
    ],
  },
  {
    label: 'YouTube',
    shortcuts: [
      { key: '⌘⇧P', action: 'Toggle Picture-in-Picture' },
      { key: '⌘⇧L', action: 'Insert timestamp into note' },
    ],
  },
]

const DEFAULT_TRANSLATIONS = [
  { id: 'kjva',          label: 'KJVA — King James + Apocrypha' },
  { id: 'lxx',           label: 'LXX — Brenton Septuagint' },
  { id: 'enoch',         label: '1 Enoch — R.H. Charles' },
  { id: 'jubilees',      label: 'Jubilees — R.H. Charles' },
  { id: 'apoc_elijah',   label: 'Apocalypse of Elijah' },
  { id: 'asc_isaiah',    label: 'Ascension of Isaiah — R.H. Charles' },
  { id: 'ep_barnabas',   label: 'Epistle of Barnabas — Samuel Sharpe' },
  { id: 't12p',          label: 'Testaments of the 12 Patriarchs — R.H. Charles' },
  { id: 'recog_clement', label: 'Recognitions of Clement (Ante-Nicene Fathers)' },
  { id: 'hermas',        label: 'Shepherd of Hermas (Ante-Nicene Fathers)' },
  { id: 'gad',           label: 'Gad the Seer — Beir Bar-Ilan' },
  { id: 't_job',         label: 'Testament of Job — M.R. James (1897)' },
  { id: '1clement',      label: '1 Clement — J.B. Lightfoot' },
  { id: 'apoc_abraham',  label: 'Apocalypse of Abraham — G.H. Box (1918)' },
]

// Theme preset data — bg/accent/text are "r g b" strings matching global.css vars
// natural: which mode this preset was designed for ('dark' | 'light')
// dark/light: color values for swatch preview in each mode
interface ThemePresetDef {
  id: string
  label: string
  natural: 'dark' | 'light'
  dark: { bg: string; accent: string; text: string }
  light: { bg: string; accent: string; text: string }
}

const THEME_PRESETS: ThemePresetDef[] = [
  { id: '',               label: 'Default',  natural: 'dark',
    dark:  { bg: '17 17 20',    accent: '100 120 220', text: '230 230 238' },
    light: { bg: '245 245 248', accent: '80 100 200',  text: '20 20 28'   } },
  { id: 'theme-neon',     label: 'Neon',     natural: 'dark',
    dark:  { bg: '8 8 14',     accent: '255 0 180',   text: '240 240 255' },
    light: { bg: '250 248 255', accent: '200 0 145',   text: '18 5 35'    } },
  { id: 'theme-midnight', label: 'Midnight', natural: 'dark',
    dark:  { bg: '6 8 22',     accent: '120 160 255', text: '210 220 255' },
    light: { bg: '238 242 255', accent: '70 105 215',  text: '12 18 55'   } },
  { id: 'theme-obsidian', label: 'Obsidian', natural: 'dark',
    dark:  { bg: '12 10 14',   accent: '140 100 220', text: '230 225 240' },
    light: { bg: '248 246 252', accent: '108 72 188',  text: '22 16 35'   } },
  { id: 'theme-forest',   label: 'Forest',   natural: 'dark',
    dark:  { bg: '8 14 10',    accent: '80 195 110',  text: '210 240 215' },
    light: { bg: '238 252 240', accent: '38 145 62',   text: '6 28 10'    } },
  { id: 'theme-royal',    label: 'Royal',    natural: 'dark',
    dark:  { bg: '12 8 22',    accent: '218 170 50',  text: '240 228 200' },
    light: { bg: '252 248 235', accent: '165 115 15',  text: '28 18 52'   } },
  { id: 'theme-ember',    label: 'Ember',    natural: 'dark',
    dark:  { bg: '16 10 6',    accent: '240 140 30',  text: '248 230 200' },
    light: { bg: '255 248 238', accent: '195 92 8',    text: '48 22 6'    } },
  { id: 'theme-ocean',    label: 'Ocean',    natural: 'dark',
    dark:  { bg: '6 14 22',    accent: '30 200 190',  text: '200 235 240' },
    light: { bg: '232 248 252', accent: '12 148 142',  text: '6 28 42'    } },
  { id: 'theme-slate',    label: 'Slate',    natural: 'dark',
    dark:  { bg: '14 16 18',   accent: '100 180 230', text: '220 228 235' },
    light: { bg: '238 242 246', accent: '52 132 182',  text: '16 26 36'   } },
  { id: 'theme-terminal', label: 'Terminal', natural: 'dark',
    dark:  { bg: '4 10 4',     accent: '0 220 80',    text: '0 255 100'   },
    light: { bg: '238 252 238', accent: '0 155 50',    text: '4 22 4'     } },
  { id: 'theme-bible',    label: 'Bible',    natural: 'light',
    dark:  { bg: '26 18 8',    accent: '195 132 52',  text: '228 212 182' },
    light: { bg: '240 232 210', accent: '130 80 30',   text: '55 35 15'   } },
  { id: 'theme-sand',     label: 'Sand',     natural: 'light',
    dark:  { bg: '30 22 10',   accent: '205 142 48',  text: '232 218 192' },
    light: { bg: '238 228 210', accent: '190 110 30',  text: '60 40 20'   } },
  { id: 'theme-rose',     label: 'Rose',     natural: 'light',
    dark:  { bg: '26 10 18',   accent: '215 88 128',  text: '248 215 230' },
    light: { bg: '252 240 244', accent: '180 60 100',  text: '55 20 35'   } },
  { id: 'theme-ivory',    label: 'Ivory',    natural: 'light',
    dark:  { bg: '18 16 28',   accent: '148 118 208', text: '232 228 245' },
    light: { bg: '250 248 245', accent: '110 85 175',  text: '35 30 45'   } },
  { id: 'theme-arctic',   label: 'Arctic',   natural: 'light',
    dark:  { bg: '8 20 30',    accent: '28 175 198',  text: '200 228 242' },
    light: { bg: '234 242 248', accent: '20 160 180',  text: '15 35 50'   } },
  { id: 'theme-dawn',     label: 'Dawn',     natural: 'light',
    dark:  { bg: '24 12 5',    accent: '228 118 48',  text: '250 225 205' },
    light: { bg: '255 245 238', accent: '200 95 40',   text: '55 30 15'   } },
]

// Derive the CSS class to apply for a given preset + variant
function resolvePresetClass(preset: ThemePresetDef, variant: 'dark' | 'light'): string {
  if (!preset.id) return '' // Default: clear preset
  // If requesting the preset's natural mode, use the base class (backward compat)
  if (variant === preset.natural) return preset.id
  // Otherwise append -dark or -light
  return `${preset.id}-${variant}`
}

const BEREAN_SITE_URL = 'https://royalweden.github.io/Berean'

function UpdatesSection() {
  const [version, setVersion] = useState('')
  const [isMas, setIsMas] = useState(false)
  const [autoCheck, setAutoCheck] = useState(true)
  const [betaChannel, setBetaChannel] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ status: 'idle' })

  useEffect(() => {
    window.app.getVersion().then(setVersion).catch(() => {})
    window.settings.get('autoUpdate').then((v) => setAutoCheck(v !== false)).catch(() => {})
    window.settings.get('updateChannel').then((v) => setBetaChannel(v === 'beta')).catch(() => {})
    window.app.onUpdateStatus((s) => setUpdateStatus(s as UpdateStatus))
    window.app.isMasBuild?.().then((mas) => {
      if (mas) { setIsMas(true); setUpdateStatus({ status: 'mas' }) }
    }).catch(() => {})
  }, [])

  async function toggleAutoCheck(enabled: boolean) {
    setAutoCheck(enabled)
    await window.settings.set('autoUpdate', enabled)
  }

  async function toggleBeta(enabled: boolean) {
    setBetaChannel(enabled)
    await window.settings.set('updateChannel', enabled ? 'beta' : 'stable')
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
            Check on launch, 6 seconds after startup
          </p>
        </div>
        <button
          onClick={() => toggleAutoCheck(!autoCheck)}
          className={`relative flex-shrink-0 w-10 h-5 rounded-full transition-colors cursor-pointer ${
            autoCheck ? 'bg-[rgb(var(--color-accent))]' : 'bg-[rgb(var(--color-surface-4))]'
          }`}
        >
          <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${autoCheck ? 'translate-x-5' : ''}`} />
        </button>
      </div>

      {/* Beta channel toggle */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-[rgb(var(--color-text-primary))]">Beta updates</p>
          <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] mt-0.5">
            Receive pre-release builds — may contain unfinished features or bugs
          </p>
        </div>
        <button
          onClick={() => toggleBeta(!betaChannel)}
          className={`relative flex-shrink-0 w-10 h-5 rounded-full transition-colors cursor-pointer ${
            betaChannel ? 'bg-amber-500' : 'bg-[rgb(var(--color-surface-4))]'
          }`}
        >
          <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${betaChannel ? 'translate-x-5' : ''}`} />
        </button>
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

type Section = 'appearance' | 'display' | 'notes' | 'vault' | 'workspaces' | 'youtube' | 'word-replacer' | 'shortcuts' | 'updates' | 'about' | 'danger' | 'import'

interface WatchHistoryEntry {
  videoId: string
  positionSeconds: number
  lastWatched: string
  title: string
  channelName: string
  thumbnailUrl: string
}

export default function SettingsModal() {
  const settingsOpen = useAppStore((s) => s.settingsOpen)
  const closeSettings = useAppStore((s) => s.closeSettings)
  const settingsInitialSection = useAppStore((s) => s.settingsInitialSection)
  const theme = useAppStore((s) => s.theme)
  const setTheme = useAppStore((s) => s.setTheme)
  const themePreset = useAppStore((s) => s.themePreset)
  const setThemePreset = useAppStore((s) => s.setThemePreset)
  const scriptureFontFamily = useAppStore((s) => s.scriptureFontFamily)
  const notesFontFamily = useAppStore((s) => s.notesFontFamily)
  const uiFontFamily = useAppStore((s) => s.uiFontFamily)
  const setScriptureFontFamily = useAppStore((s) => s.setScriptureFontFamily)
  const setNotesFontFamily = useAppStore((s) => s.setNotesFontFamily)
  const setUiFontFamily = useAppStore((s) => s.setUiFontFamily)
  const autoCloseTabsAfter = useAppStore((s) => s.autoCloseTabsAfter)
  const setAutoCloseTabsAfter = useAppStore((s) => s.setAutoCloseTabsAfter)
  const bibleFontSize = useAppStore((s) => s.bibleFontSize)
  const setBibleFontSize = useAppStore((s) => s.setBibleFontSize)
  const defaultBibleTranslation = useAppStore((s) => s.defaultBibleTranslation)
  const setDefaultBibleTranslation = useAppStore((s) => s.setDefaultBibleTranslation)
  const bibleLineHeight = useAppStore((s) => s.bibleLineHeight)
  const setBibleLineHeight = useAppStore((s) => s.setBibleLineHeight)
  const defaultScriptureLayout = useAppStore((s) => s.defaultScriptureLayout)
  const noteTransformLayout = useAppStore((s) => s.noteTransformLayout)
  const setNoteTransformLayout = useAppStore((s) => s.setNoteTransformLayout)
  const setDefaultScriptureLayout = useAppStore((s) => s.setDefaultScriptureLayout)
  const autoPiP = useAppStore((s) => s.autoPiP)
  const setAutoPiP = useAppStore((s) => s.setAutoPiP)
  const wordReplacerEnabled = useAppStore((s) => s.wordReplacerEnabled)
  const wordReplacerRules = useAppStore((s) => s.wordReplacerRules)
  const setWordReplacerEnabled = useAppStore((s) => s.setWordReplacerEnabled)
  const toggleWordReplacerRule = useAppStore((s) => s.toggleWordReplacerRule)
  const noteVerseRefsEnabled = useAppStore((s) => s.noteVerseRefsEnabled)
  const noteLexiconRefsEnabled = useAppStore((s) => s.noteLexiconRefsEnabled)
  const setNoteVerseRefsEnabled = useAppStore((s) => s.setNoteVerseRefsEnabled)
  const setNoteLexiconRefsEnabled = useAppStore((s) => s.setNoteLexiconRefsEnabled)
  const noteScriptureBlock = useAppStore((s) => s.noteScriptureBlock)
  const setNoteScriptureBlock = useAppStore((s) => s.setNoteScriptureBlock)
  const noteScriptureBlockThreshold = useAppStore((s) => s.noteScriptureBlockThreshold)
  const setNoteScriptureBlockThreshold = useAppStore((s) => s.setNoteScriptureBlockThreshold)
  const sidebarNewTabIconOnly = useAppStore((s) => s.sidebarNewTabIconOnly)
  const setSidebarNewTabIconOnly = useAppStore((s) => s.setSidebarNewTabIconOnly)
  const floatingSearchDensity = useAppStore((s) => s.floatingSearchDensity)
  const setFloatingSearchDensity = useAppStore((s) => s.setFloatingSearchDensity)
  const defaultNoteEditorMode = useAppStore((s) => s.defaultNoteEditorMode)
  const setDefaultNoteEditorMode = useAppStore((s) => s.setDefaultNoteEditorMode)
  const confirmNoteDelete = useAppStore((s) => s.confirmNoteDelete)
  const setConfirmNoteDelete = useAppStore((s) => s.setConfirmNoteDelete)
  const showVerseNumbers = useAppStore((s) => s.showVerseNumbers)
  const setShowVerseNumbers = useAppStore((s) => s.setShowVerseNumbers)
  const showRedLetters = useAppStore((s) => s.showRedLetters)
  const setShowRedLetters = useAppStore((s) => s.setShowRedLetters)
  const autoCopyOnHighlight = useAppStore((s) => s.autoCopyOnHighlight)
  const setAutoCopyOnHighlight = useAppStore((s) => s.setAutoCopyOnHighlight)
  const noteSpellCheck = useAppStore((s) => s.noteSpellCheck)
  const setNoteSpellCheck = useAppStore((s) => s.setNoteSpellCheck)
  const noteHeadingDivider = useAppStore((s) => s.noteHeadingDivider)
  const setNoteHeadingDivider = useAppStore((s) => s.setNoteHeadingDivider)
  const noteBulletStyle = useAppStore((s) => s.noteBulletStyle)
  const setNoteBulletStyle = useAppStore((s) => s.setNoteBulletStyle)

  const [section, setSection] = useState<Section>('appearance')
  // Compact mode — hides description text and reduces spacing so more settings
  // fit on screen at once. Default ON; user can toggle to expanded view.
  const [compact, setCompact] = useState(() => {
    try { return localStorage.getItem('settings-compact') !== 'false' } catch { return true }
  })
  function toggleCompact() {
    setCompact((v) => {
      const next = !v
      try { localStorage.setItem('settings-compact', String(next)) } catch { /* ignore */ }
      return next
    })
  }
  // previewVariant: which palette to show in the preset swatches
  // follows base theme (dark/light) and can be toggled independently
  const [previewVariant, setPreviewVariant] = useState<'dark' | 'light'>(
    theme === 'light' ? 'light' : 'dark'
  )

  // When settings opens, jump to the requested initial section (e.g. 'import')
  useEffect(() => {
    if (settingsOpen && settingsInitialSection) {
      setSection(settingsInitialSection as Section)
    }
  }, [settingsOpen, settingsInitialSection])

  // Keep previewVariant in sync when base theme changes (not system)
  useEffect(() => {
    if (theme !== 'system') setPreviewVariant(theme === 'light' ? 'light' : 'dark')
  }, [theme])

  const [vaultSync, setVaultSync] = useState(false)
  const [vaultPath, setVaultPath] = useState('')
  const [watchHistory, setWatchHistory] = useState<WatchHistoryEntry[]>([])
  const [showYTSignIn, setShowYTSignIn] = useState(false)
  const [ytSignedOut, setYtSignedOut] = useState(false)
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(new Set())
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!settingsOpen) return
    window.settings.getAll().then((all) => {
      if (all.vaultSync != null) setVaultSync(Boolean(all.vaultSync))
      if (all.vaultPath) setVaultPath(all.vaultPath as string)
    }).catch(() => {})
  }, [settingsOpen])

  useEffect(() => {
    if (section === 'youtube') {
      window.youtube.getWatchHistory().then((history) => {
        setWatchHistory(history)
        // Default all months to collapsed on first load
        const monthKeys = new Set<string>()
        for (const entry of history) {
          const d = new Date(entry.lastWatched)
          if (!isNaN(d.getTime())) {
            monthKeys.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
          }
        }
        setCollapsedMonths(monthKeys)
      }).catch(() => {})
    }
  }, [section])

  const handleRemoveFromHistory = useCallback(async (videoId: string) => {
    await window.youtube.removeFromHistory(videoId).catch(() => {})
    setWatchHistory((prev) => prev.filter((h) => h.videoId !== videoId))
    window.dispatchEvent(new CustomEvent('berean:watchHistoryChanged'))
  }, [])

  const handleClearHistory = useCallback(async () => {
    await window.youtube.clearWatchHistory().catch(() => {})
    setWatchHistory([])
    window.dispatchEvent(new CustomEvent('berean:watchHistoryChanged'))
  }, [])

  const handleJumpToVideo = useCallback((videoId: string) => {
    useAppStore.getState().setActiveSpace('youtube')
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('berean:openYouTubeVideo', { detail: { videoId } }))
    }, 150)
    closeSettings()
  }, [closeSettings])

  async function saveTranslation(id: string) {
    setDefaultBibleTranslation(id)
    await window.settings.set('defaultTranslation', id)
  }

  async function saveFontSize(size: number) {
    setBibleFontSize(size)
    await window.settings.set('fontSize', size)
  }

  async function toggleVaultSync(enabled: boolean) {
    setVaultSync(enabled)
    await window.settings.set('vaultSync', enabled)
    if (enabled) {
      window.vault.watchVault().catch(() => {})
      useAppStore.getState().bumpVaultSyncToken()
    }
  }

  async function saveVaultPath(path: string) {
    setVaultPath(path)
    await window.settings.set('vaultPath', path)
  }

  const NAV: { id: Section; label: string }[] = [
    { id: 'appearance',    label: 'Appearance' },
    { id: 'display',       label: 'Display' },
    { id: 'notes',         label: 'Notes' },
    { id: 'vault',         label: 'Vault Sync' },
    { id: 'workspaces',    label: 'Workspaces' },
    { id: 'youtube',       label: 'YouTube' },
    { id: 'word-replacer', label: 'Word Replacer' },
    { id: 'shortcuts',     label: 'Shortcuts' },
    { id: 'updates',       label: 'Updates' },
    { id: 'import',        label: 'Import' },
    { id: 'about',         label: 'About' },
    { id: 'danger',        label: 'Danger' },
  ]

  return (
    <Dialog.Root open={settingsOpen} onOpenChange={(open) => !open && closeSettings()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content
          aria-describedby={undefined}
          className="
            fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
            z-50 w-full max-w-2xl max-h-[80vh]
            bg-[rgb(var(--color-surface-2))] border border-[rgb(var(--color-surface-4))]
            rounded-xl shadow-2xl overflow-hidden flex flex-col
          "
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-6 py-3 border-b border-[rgb(var(--color-surface-4))] flex-shrink-0">
            <Dialog.Title className="text-base font-semibold text-[rgb(var(--color-text-primary))] flex-1">
              Settings
            </Dialog.Title>
            {/* Compact / Expanded toggle */}
            <button
              onClick={toggleCompact}
              title={compact ? 'Switch to expanded view (show descriptions)' : 'Switch to compact view (hide descriptions)'}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors cursor-pointer border ${
                compact
                  ? 'border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-secondary))]'
                  : 'border-[rgb(var(--color-accent))/40] bg-[rgb(var(--color-accent))/8] text-[rgb(var(--color-accent))]'
              }`}
            >
              <span>{compact ? '⊟ Compact' : '⊞ Expanded'}</span>
            </button>
            <button
              onClick={closeSettings}
              className="p-1 rounded text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
          {/* Compact-mode style injection — hides .s-desc description text and tightens gaps */}
          {compact && (
            <style>{`
              .settings-content .s-desc { display: none !important; }
              .settings-content .s-section { margin-bottom: 0.25rem !important; }
            `}</style>
          )}

          <div className="flex flex-1 overflow-hidden min-h-0">
            {/* Left nav */}
            <div className="w-36 border-r border-[rgb(var(--color-surface-4))] flex-shrink-0 p-1.5 space-y-px overflow-y-auto">
              {NAV.map((n) => (
                <button
                  key={n.id}
                  onClick={() => { setSection(n.id); useAppStore.getState().bumpSettingsNavToken() }}
                  className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs transition-colors cursor-pointer ${
                    n.id === 'danger'
                      ? section === n.id
                        ? 'bg-red-500/15 text-red-400'
                        : 'text-red-400/70 hover:bg-red-500/10 hover:text-red-400'
                      : section === n.id
                        ? 'bg-[rgb(var(--color-accent))/15] text-[rgb(var(--color-accent))]'
                        : 'text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))]'
                  }`}
                >
                  {n.label}
                </button>
              ))}
            </div>

            {/* Content */}
            <div className={`settings-content flex-1 overflow-y-auto ${compact ? 'px-4 py-3 space-y-4' : 'px-6 py-6 space-y-6'}`}>
              {section === 'appearance' && (
                <>
                  {/* Color mode: Dark / Light / System — controls all themes including presets */}
                  <div>
                    <p className="text-sm font-medium text-[rgb(var(--color-text-primary))] mb-1">Color mode</p>
                    <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] mb-3">Controls dark or light for all themes and preset palettes</p>
                    <div className="flex gap-2">
                      {([['dark', Moon, 'Dark'], ['light', Sun, 'Light'], ['system', Monitor, 'System']] as const).map(([t, Icon, label]) => (
                        <button
                          key={t}
                          onClick={() => setTheme(t)}
                          className={`
                            flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm
                            border transition-colors cursor-pointer
                            ${theme === t
                              ? 'border-[rgb(var(--color-accent))] bg-[rgb(var(--color-accent))/10] text-[rgb(var(--color-accent))]'
                              : 'border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))]'
                            }
                          `}
                        >
                          <Icon size={14} />
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Preset themes */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="text-sm font-medium text-[rgb(var(--color-text-primary))]">Preset themes</p>
                        <p className="s-desc text-xs text-[rgb(var(--color-text-muted))]">
                          {theme === 'system' ? 'Previews show dark/light split — system picks automatically' : `Showing ${previewVariant} variants`}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-4 gap-2">
                      {THEME_PRESETS.map((preset) => {
                        const { id, label, dark: darkColors, light: lightColors } = preset
                        // A preset is "active" if themePreset matches the base id or either variant
                        const isActive = themePreset === id ||
                          themePreset === `${id}-dark` ||
                          themePreset === `${id}-light`

                        // Determine click action
                        const handlePresetClick = () => {
                          if (!id) {
                            // Default: clear preset
                            setThemePreset('')
                          } else if (theme === 'system') {
                            setThemePreset(id)
                          } else {
                            setThemePreset(resolvePresetClass(preset, previewVariant))
                          }
                        }

                        // Colors to use for the swatch preview
                        const swatchColors = theme === 'system' ? null : (previewVariant === 'dark' ? darkColors : lightColors)
                        const checkmarkAccent = swatchColors?.accent ?? darkColors.accent

                        return (
                          <button
                            key={id}
                            onClick={handlePresetClick}
                            title={label}
                            className={`
                              rounded-lg p-1.5 border transition-all cursor-pointer text-left
                              ${isActive
                                ? 'border-[rgb(var(--color-accent))] ring-1 ring-[rgb(var(--color-accent))/60]'
                                : 'border-[rgb(var(--color-surface-4))] hover:border-[rgb(var(--color-text-muted))]'
                              }
                            `}
                          >
                            {/* Mini color preview */}
                            <div className="h-9 rounded-md overflow-hidden mb-1.5 relative">
                              {theme === 'system' ? (
                                /* Diagonal split: top-left = dark, bottom-right = light */
                                <>
                                  <div
                                    className="absolute inset-0"
                                    style={{
                                      background: `linear-gradient(135deg, rgb(${darkColors.bg}) 50%, rgb(${lightColors.bg}) 50%)`
                                    }}
                                  />
                                  {/* Accent stripes: dark half (top) + light half (bottom) */}
                                  <div className="absolute inset-y-0 left-0 w-2" style={{
                                    background: `linear-gradient(to bottom, rgb(${darkColors.accent}) 50%, rgb(${lightColors.accent}) 50%)`
                                  }} />
                                  {/* Diagonal divider line */}
                                  <div className="absolute inset-0" style={{
                                    background: 'linear-gradient(135deg, transparent calc(50% - 0.75px), rgba(140,140,140,0.45) calc(50% - 0.75px), rgba(140,140,140,0.45) calc(50% + 0.75px), transparent calc(50% + 0.75px))'
                                  }} />
                                </>
                              ) : (
                                /* Single-mode swatch */
                                <>
                                  <div className="absolute inset-0" style={{ background: `rgb(${swatchColors!.bg})` }} />
                                  <div className="absolute inset-y-0 left-0 w-2" style={{ background: `rgb(${swatchColors!.accent})` }} />
                                  <div className="absolute inset-0 flex flex-col justify-center pl-3.5 pr-1.5 gap-1">
                                    <div className="h-1 rounded-full" style={{ background: `rgb(${swatchColors!.text})`, opacity: 0.65, width: '85%' }} />
                                    <div className="h-1 rounded-full" style={{ background: `rgb(${swatchColors!.text})`, opacity: 0.4, width: '55%' }} />
                                  </div>
                                </>
                              )}
                              {/* Active checkmark */}
                              {isActive && (
                                <div className="absolute top-0.5 right-0.5 w-3 h-3 rounded-full bg-white/90 flex items-center justify-center">
                                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                                    <path d="M1.5 4L3 5.5L6.5 2" stroke={`rgb(${checkmarkAccent})`} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                  </svg>
                                </div>
                              )}
                            </div>
                            <span className={`text-[10px] font-medium leading-none ${isActive ? 'text-[rgb(var(--color-accent))]' : 'text-[rgb(var(--color-text-secondary))]'}`}>
                              {label}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Font family per section */}
                  <div>
                    <p className="text-sm font-medium text-[rgb(var(--color-text-primary))] mb-1">Section fonts</p>
                    <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] mb-3">Choose typefaces independently for each area</p>
                    <div className="space-y-3">
                      {([
                        ['UI chrome', uiFontFamily, setUiFontFamily],
                        ['Scripture', scriptureFontFamily, setScriptureFontFamily],
                        ['Notes', notesFontFamily, setNotesFontFamily],
                      ] as [string, string, (v: string) => void][]).map(([label, value, setter]) => (
                        <div key={label} className="flex items-center gap-3">
                          <span className="s-desc text-xs text-[rgb(var(--color-text-muted))] w-20 flex-shrink-0">{label}</span>
                          <select
                            value={value}
                            onChange={(e) => setter(e.target.value)}
                            className="flex-1 bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] text-xs px-2 py-1.5 rounded-lg border border-[rgb(var(--color-surface-4))] outline-none cursor-pointer"
                          >
                            <option value="system">System default</option>
                            <option value="serif">Serif (Georgia)</option>
                            <option value="sansserif">Sans-serif (Inter)</option>
                            <option value="mono">Monospace</option>
                            <option value="garamond">EB Garamond</option>
                            <option value="palatino">Palatino</option>
                            <option value="merriweather">Merriweather</option>
                            <option value="lora">Lora</option>
                            <option value="crimson">Crimson Text</option>
                            <option value="sourceserif">Source Serif 4</option>
                            <option value="nunito">Nunito</option>
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {section === 'display' && (
                <>
                  <div>
                    <p className="text-sm font-medium text-[rgb(var(--color-text-primary))] mb-1">Default translation</p>
                    <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] mb-3">Used when opening a new Bible tab</p>
                    <select
                      value={defaultBibleTranslation}
                      onChange={(e) => saveTranslation(e.target.value)}
                      className="w-full bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] text-sm px-3 py-2 rounded-lg border border-[rgb(var(--color-surface-4))] outline-none cursor-pointer focus:border-[rgb(var(--color-accent))] transition-colors"
                    >
                      {DEFAULT_TRANSLATIONS.map((t) => (
                        <option key={t.id} value={t.id}>{t.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <p className="text-sm font-medium text-[rgb(var(--color-text-primary))] mb-1">Default scripture layout</p>
                    <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] mb-3">Starting layout for new scripture tabs — can be overridden per-tab using the layout button in the tab toolbar</p>
                    <select
                      value={defaultScriptureLayout}
                      onChange={(e) => setDefaultScriptureLayout(e.target.value as ScriptureLayout)}
                      className="w-full bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] text-sm px-3 py-2 rounded-lg border border-[rgb(var(--color-surface-4))] outline-none cursor-pointer focus:border-[rgb(var(--color-accent))] transition-colors"
                    >
                      {LAYOUT_DEFS.map((def) => (
                        <option key={def.id} value={def.id}>{def.label} — {def.description}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <p className="text-sm font-medium text-[rgb(var(--color-text-primary))] mb-1">Open note alongside scripture</p>
                    <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] mb-3">Where the note appears when using the "Open alongside scripture" button in the notes toolbar</p>
                    <div className="flex gap-2">
                      {([
                        { value: 'right',  label: 'Right panel' },
                        { value: 'left',   label: 'Left panel'  },
                        { value: 'bottom', label: 'Bottom'      },
                      ] as const).map(({ value, label }) => (
                        <button
                          key={value}
                          onClick={() => setNoteTransformLayout(value)}
                          className={`
                            px-3 py-1.5 rounded-lg text-sm border transition-colors cursor-pointer
                            ${noteTransformLayout === value
                              ? 'border-[rgb(var(--color-accent))] bg-[rgb(var(--color-accent))/10] text-[rgb(var(--color-accent))]'
                              : 'border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))]'
                            }
                          `}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-sm font-medium text-[rgb(var(--color-text-primary))] mb-1">Line height</p>
                    <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] mb-3">Spacing between verse lines</p>
                    <div className="flex gap-2">
                      {(['compact', 'comfortable', 'spacious'] as const).map((h) => (
                        <button
                          key={h}
                          onClick={() => setBibleLineHeight(h)}
                          className={`
                            px-3 py-1.5 rounded-lg text-sm capitalize border transition-colors cursor-pointer
                            ${bibleLineHeight === h
                              ? 'border-[rgb(var(--color-accent))] bg-[rgb(var(--color-accent))/10] text-[rgb(var(--color-accent))]'
                              : 'border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))]'
                            }
                          `}
                        >
                          {h}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-sm font-medium text-[rgb(var(--color-text-primary))] mb-1">Floating search density</p>
                    <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] mb-3">Controls how many results are visible before scrolling — compact shows fewer lines, spacious shows more context</p>
                    <div className="flex gap-2">
                      {(['compact', 'comfortable', 'spacious'] as const).map((d) => (
                        <button
                          key={d}
                          onClick={() => setFloatingSearchDensity(d)}
                          className={`
                            px-3 py-1.5 rounded-lg text-sm capitalize border transition-colors cursor-pointer
                            ${floatingSearchDensity === d
                              ? 'border-[rgb(var(--color-accent))] bg-[rgb(var(--color-accent))/10] text-[rgb(var(--color-accent))]'
                              : 'border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))]'
                            }
                          `}
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-sm font-medium text-[rgb(var(--color-text-primary))] mb-1">Bible text size</p>
                    <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] mb-3">Font size for verse text (px)</p>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={12}
                        max={22}
                        step={1}
                        value={bibleFontSize}
                        onChange={(e) => saveFontSize(Number(e.target.value))}
                        className="flex-1 accent-[rgb(var(--color-accent))]"
                      />
                      <span className="text-sm font-mono text-[rgb(var(--color-text-secondary))] w-8">{bibleFontSize}</span>
                    </div>
                  </div>

                  {/* Sidebar new-tab button style */}
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-[rgb(var(--color-text-primary))]">Compact sidebar space buttons</p>
                      <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] mt-0.5">
                        Show Scripture / Notes / Lexicon / YouTube as a single row of icon chips instead of a column. Hover to reveal a + indicator.
                      </p>
                    </div>
                    <button
                      onClick={() => setSidebarNewTabIconOnly(!sidebarNewTabIconOnly)}
                      className={`relative flex-shrink-0 w-10 h-5 rounded-full transition-colors cursor-pointer ${
                        sidebarNewTabIconOnly ? 'bg-[rgb(var(--color-accent))]' : 'bg-[rgb(var(--color-surface-4))]'
                      }`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${sidebarNewTabIconOnly ? 'translate-x-5' : ''}`} />
                    </button>
                  </div>

                  {/* Auto-close tabs */}
                  <div>
                    <p className="text-sm font-medium text-[rgb(var(--color-text-primary))] mb-1">Auto-close inactive tabs</p>
                    <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] mb-3">Automatically close tabs that haven't been visited for the selected period</p>
                    <div className="flex flex-wrap gap-2">
                      {([
                        [0, 'Never'],
                        [60 * 60 * 1000, '1 hour'],
                        [6 * 60 * 60 * 1000, '6 hours'],
                        [24 * 60 * 60 * 1000, '1 day'],
                        [3 * 24 * 60 * 60 * 1000, '3 days'],
                        [7 * 24 * 60 * 60 * 1000, '1 week'],
                        [30 * 24 * 60 * 60 * 1000, '1 month'],
                      ] as const).map(([ms, label]) => (
                        <button
                          key={ms}
                          onClick={() => setAutoCloseTabsAfter(ms)}
                          className={`
                            px-3 py-1.5 rounded-lg text-xs border transition-colors cursor-pointer
                            ${autoCloseTabsAfter === ms
                              ? 'border-[rgb(var(--color-accent))] bg-[rgb(var(--color-accent))/10] text-[rgb(var(--color-accent))]'
                              : 'border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))]'
                            }
                          `}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* ── Show verse numbers ── */}
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-[rgb(var(--color-text-primary))]">Show verse numbers</p>
                      <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] mt-0.5">Display verse numbers in the reading panel</p>
                    </div>
                    <button
                      onClick={() => setShowVerseNumbers(!showVerseNumbers)}
                      className={`relative flex-shrink-0 w-10 h-5 rounded-full transition-colors cursor-pointer ${showVerseNumbers ? 'bg-[rgb(var(--color-accent))]' : 'bg-[rgb(var(--color-surface-4))]'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${showVerseNumbers ? 'translate-x-5' : ''}`} />
                    </button>
                  </div>

                  {/* ── Red letters ── */}
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-[rgb(var(--color-text-primary))]">Red letter text</p>
                      <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] mt-0.5">Highlight words of Yeshua in the KJVA text (requires tagged source)</p>
                    </div>
                    <button
                      onClick={() => setShowRedLetters(!showRedLetters)}
                      className={`relative flex-shrink-0 w-10 h-5 rounded-full transition-colors cursor-pointer ${showRedLetters ? 'bg-[rgb(var(--color-accent))]' : 'bg-[rgb(var(--color-surface-4))]'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${showRedLetters ? 'translate-x-5' : ''}`} />
                    </button>
                  </div>
                </>
              )}

              {section === 'notes' && (
                <div className="space-y-5">
                  <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] -mt-2">
                    Control how Berean auto-detects references while you write notes.
                  </p>

                  {/* Verse refs toggle */}
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-[rgb(var(--color-text-primary))]">Auto-detect verse references</p>
                      <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] mt-0.5">
                        Highlight and make clickable any Bible reference typed in a note (e.g. Genesis 1:1). Clicking navigates the Scripture panel.
                      </p>
                    </div>
                    <button
                      onClick={() => setNoteVerseRefsEnabled(!noteVerseRefsEnabled)}
                      className={`relative flex-shrink-0 w-10 h-5 rounded-full transition-colors cursor-pointer ${
                        noteVerseRefsEnabled ? 'bg-[rgb(var(--color-accent))]' : 'bg-[rgb(var(--color-surface-4))]'
                      }`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${noteVerseRefsEnabled ? 'translate-x-5' : ''}`} />
                    </button>
                  </div>

                  {/* Lexicon refs toggle */}
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-[rgb(var(--color-text-primary))]">Auto-detect lexicon references</p>
                      <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] mt-0.5">
                        Highlight and make clickable any Strong's number typed in a note (e.g. H7225 or G3056). Clicking opens the lexicon entry.
                      </p>
                    </div>
                    <button
                      onClick={() => setNoteLexiconRefsEnabled(!noteLexiconRefsEnabled)}
                      className={`relative flex-shrink-0 w-10 h-5 rounded-full transition-colors cursor-pointer ${
                        noteLexiconRefsEnabled ? 'bg-[rgb(var(--color-accent))]' : 'bg-[rgb(var(--color-surface-4))]'
                      }`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${noteLexiconRefsEnabled ? 'translate-x-5' : ''}`} />
                    </button>
                  </div>

                  {/* Scripture block auto-format toggle */}
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-[rgb(var(--color-text-primary))]">Auto-format verse blocks</p>
                      <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] mt-0.5">
                        When a verse reference is followed by its text, it is displayed as a styled scripture block (left border, bold reference) — but the text stays plain, so copying it gives back the original text only. Works for multi-line blocks (reference line + numbered verses) and single-line verses (e.g. <span className="font-mono text-[10px]">1 John 2:4 He that saith…</span>). A bare reference alone is not affected.
                      </p>
                    </div>
                    <button
                      onClick={() => setNoteScriptureBlock(!noteScriptureBlock)}
                      className={`relative flex-shrink-0 w-10 h-5 rounded-full transition-colors cursor-pointer ${
                        noteScriptureBlock ? 'bg-[rgb(var(--color-accent))]' : 'bg-[rgb(var(--color-surface-4))]'
                      }`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${noteScriptureBlock ? 'translate-x-5' : ''}`} />
                    </button>
                  </div>

                  {/* Verse-text match threshold slider — only when auto-format is on */}
                  {noteScriptureBlock && (
                    <div className="pl-1">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs font-medium text-[rgb(var(--color-text-secondary))]">Verse-text match sensitivity</p>
                        <span className="text-xs font-mono text-[rgb(var(--color-accent))]">{Math.round(noteScriptureBlockThreshold * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min={50}
                        max={100}
                        step={5}
                        value={Math.round(noteScriptureBlockThreshold * 100)}
                        onChange={(e) => setNoteScriptureBlockThreshold(Number(e.target.value) / 100)}
                        className="w-full accent-[rgb(var(--color-accent))] cursor-pointer"
                      />
                      <p className="text-[11px] text-[rgb(var(--color-text-muted))] mt-1 leading-relaxed">
                        A line only formats when at least this percent of the actual verse text is present. Higher = stricter. This prevents formatting a line where you're just commenting on a verse (e.g. <span className="font-mono text-[10px]">Genesis 5:4 my thoughts here</span>).
                      </p>
                    </div>
                  )}

                  <div className="px-3 py-2 rounded-lg bg-[rgb(var(--color-surface-3))] border border-[rgb(var(--color-surface-4))]">
                    <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] leading-relaxed">
                      To suppress auto-detection for a specific piece of text, select it in the editor and press <kbd className="font-mono text-[rgb(var(--color-text-secondary))] bg-[rgb(var(--color-surface-4))] px-1 py-0.5 rounded text-[10px]">⌘⇧R</kbd> or click the <span className="font-mono">↗︎̵</span> button in the selection toolbar. Suppression is per-session — retyping the text removes it.
                    </p>
                  </div>

                  {/* Markdown reference guide */}
                  <div>
                    <p className="text-sm font-medium text-[rgb(var(--color-text-primary))] mb-1">Markdown reference</p>
                    <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] mb-2">
                      A full guide to note formatting, verse references, wikilinks, and all supported book names.
                    </p>
                    <MarkdownRefButton onClose={closeSettings} />
                  </div>

                  {/* ── Bullet list style ── */}
                  <div>
                    <p className="text-sm font-medium text-[rgb(var(--color-text-primary))] mb-1">Bullet list style</p>
                    <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] mb-3">Symbol used at each indent level in unordered lists</p>
                    <div className="grid grid-cols-1 gap-1.5">
                      {Object.entries(BULLET_STYLE_DEFS).map(([id, def]) => (
                        <button
                          key={id}
                          onClick={() => setNoteBulletStyle(id)}
                          className={`flex items-center gap-3 px-3 py-2 rounded-lg border text-left transition-colors cursor-pointer ${
                            noteBulletStyle === id
                              ? 'border-[rgb(var(--color-accent))] bg-[rgb(var(--color-accent))/10]'
                              : 'border-[rgb(var(--color-surface-4))] hover:bg-[rgb(var(--color-surface-4))]'
                          }`}
                        >
                          <span className={`text-xs font-medium w-16 flex-shrink-0 ${noteBulletStyle === id ? 'text-[rgb(var(--color-accent))]' : 'text-[rgb(var(--color-text-secondary))]'}`}>
                            {def.label}
                          </span>
                          {/* Preview: 3 indent levels */}
                          <span className="flex items-center gap-3 font-mono text-[11px] text-[rgb(var(--color-text-secondary))]">
                            {def.symbols.slice(0, 3).map((sym, i) => (
                              <span key={i} className="flex items-center gap-1">
                                <span className="text-[rgb(var(--color-text-muted))] text-[9px]" style={{ marginLeft: `${i * 10}px` }}>{sym}</span>
                                <span className="text-[rgb(var(--color-text-muted))] opacity-50 text-[9px]">item</span>
                              </span>
                            ))}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* ── Heading divider lines ── */}
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-[rgb(var(--color-text-primary))]">Heading divider lines</p>
                      <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] mt-0.5">Show a subtle separator line below each heading. Also affects how sections collapse — the divider marks where each section ends.</p>
                    </div>
                    <button
                      onClick={() => setNoteHeadingDivider(!noteHeadingDivider)}
                      className={`relative flex-shrink-0 w-10 h-5 rounded-full transition-colors cursor-pointer ${noteHeadingDivider ? 'bg-[rgb(var(--color-accent))]' : 'bg-[rgb(var(--color-surface-4))]'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${noteHeadingDivider ? 'translate-x-5' : ''}`} />
                    </button>
                  </div>

                  {/* ── Spell check in notes ── */}
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-[rgb(var(--color-text-primary))]">Spell check</p>
                      <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] mt-0.5">Underline misspelled words in the notes editor</p>
                    </div>
                    <button
                      onClick={() => setNoteSpellCheck(!noteSpellCheck)}
                      className={`relative flex-shrink-0 w-10 h-5 rounded-full transition-colors cursor-pointer ${noteSpellCheck ? 'bg-[rgb(var(--color-accent))]' : 'bg-[rgb(var(--color-surface-4))]'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${noteSpellCheck ? 'translate-x-5' : ''}`} />
                    </button>
                  </div>

                  {/* ── Auto-copy on highlight ── */}
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-[rgb(var(--color-text-primary))]">Copy verse on highlight</p>
                      <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] mt-0.5">Automatically copy the verse text to clipboard when a highlight color is applied</p>
                    </div>
                    <button
                      onClick={() => setAutoCopyOnHighlight(!autoCopyOnHighlight)}
                      className={`relative flex-shrink-0 w-10 h-5 rounded-full transition-colors cursor-pointer ${autoCopyOnHighlight ? 'bg-[rgb(var(--color-accent))]' : 'bg-[rgb(var(--color-surface-4))]'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${autoCopyOnHighlight ? 'translate-x-5' : ''}`} />
                    </button>
                  </div>

                  {/* ── Default editor mode ── */}
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[rgb(var(--color-text-primary))]">Default editor mode</p>
                      <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] mt-0.5">Starting view when opening a note — Raw shows all syntax, Edit hides markers while typing, View is read-only</p>
                    </div>
                    <div className="flex items-center bg-[rgb(var(--color-surface-3))] rounded-md p-0.5 gap-px flex-shrink-0">
                      {(['raw', 'wysiwyg', 'preview'] as const).map((m) => {
                        const labels: Record<string, string> = { raw: 'Raw', wysiwyg: 'Edit', preview: 'View' }
                        const isActive = defaultNoteEditorMode === m
                        return (
                          <button
                            key={m}
                            onClick={() => setDefaultNoteEditorMode(m)}
                            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all cursor-pointer select-none ${
                              isActive
                                ? 'bg-[rgb(var(--color-surface-1))] text-[rgb(var(--color-text-primary))] shadow-sm'
                                : 'text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-secondary))]'
                            }`}
                          >
                            {labels[m]}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* ── Confirm before deleting notes ── */}
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-[rgb(var(--color-text-primary))]">Confirm before deleting notes</p>
                      <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] mt-0.5">Show a prompt when deleting a note that has content</p>
                    </div>
                    <button
                      onClick={() => setConfirmNoteDelete(!confirmNoteDelete)}
                      className={`relative flex-shrink-0 w-10 h-5 rounded-full transition-colors cursor-pointer ${
                        confirmNoteDelete ? 'bg-[rgb(var(--color-accent))]' : 'bg-[rgb(var(--color-surface-4))]'
                      }`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${confirmNoteDelete ? 'translate-x-5' : ''}`} />
                    </button>
                  </div>

                </div>
              )}

              {section === 'vault' && (
                <>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-[rgb(var(--color-text-primary))]">Markdown vault sync</p>
                      <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] mt-0.5">
                        Write notes to a local Markdown folder. Changes made externally are synced back. Works with Obsidian, Logseq, iA Writer, or any Markdown app.
                      </p>
                    </div>
                    <button
                      onClick={() => toggleVaultSync(!vaultSync)}
                      className={`relative flex-shrink-0 w-10 h-5 rounded-full transition-colors cursor-pointer ${
                        vaultSync ? 'bg-[rgb(var(--color-accent))]' : 'bg-[rgb(var(--color-surface-4))]'
                      }`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${vaultSync ? 'translate-x-5' : ''}`} />
                    </button>
                  </div>

                  <div>
                    <p className="text-sm font-medium text-[rgb(var(--color-text-primary))] mb-1">Vault folder</p>
                    <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] mb-2">
                      Choose the root folder where Berean will read and write <span className="font-mono">.md</span> files
                    </p>
                    <div className="flex gap-2 items-center">
                      <input
                        type="text"
                        value={vaultPath}
                        onChange={(e) => setVaultPath(e.target.value)}
                        onBlur={(e) => saveVaultPath(e.target.value)}
                        className="flex-1 px-3 py-1.5 text-xs rounded-lg bg-[rgb(var(--color-surface-3))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] outline-none focus:border-[rgb(var(--color-accent))]"
                        placeholder="/path/to/your/notes-folder"
                      />
                      <button
                        onClick={async () => {
                          const picked = await window.app.openFolderDialog()
                          if (picked) { setVaultPath(picked); saveVaultPath(picked) }
                        }}
                        title="Browse for vault folder"
                        className="p-1 rounded text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer flex-shrink-0"
                      >
                        <FolderOpen size={14} />
                      </button>
                    </div>
                    {vaultPath && (
                      <p className="text-[10px] text-[rgb(var(--color-text-muted))] mt-1.5">
                        Notes saved under <span className="font-mono">{vaultPath}/berean-notes/</span>
                      </p>
                    )}
                  </div>

                  {vaultSync && vaultPath && (
                    <VaultReconcileButton />
                  )}

                  <div className="px-3 py-2 rounded-lg bg-[rgb(var(--color-surface-3))] border border-[rgb(var(--color-surface-4))]">
                    <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] leading-relaxed">
                      Notes are always stored in Berean's internal database. The vault folder is a sync destination — Berean writes <span className="font-mono">.md</span> files there and watches for external edits. Changing the folder path does not change which notes appear in Berean.
                    </p>
                  </div>
                </>
              )}

              {section === 'workspaces' && (
                <WorkspacesSection />
              )}

              {section === 'youtube' && (
                <>
                  {/* Default YouTube layout */}
                  <div>
                    <p className="text-sm font-medium text-[rgb(var(--color-text-primary))] mb-1">Default layout</p>
                    <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] mb-3">Starting layout when a YouTube tab opens a video</p>
                    <YtLayoutSetting />
                  </div>

                  {/* Auto PiP */}
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-[rgb(var(--color-text-primary))]">Auto Picture-in-Picture</p>
                      <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] mt-0.5">
                        Float the video in PiP automatically when switching away from the YouTube space
                      </p>
                    </div>
                    <button
                      onClick={() => setAutoPiP(!autoPiP)}
                      className={`relative flex-shrink-0 w-10 h-5 rounded-full transition-colors cursor-pointer ${
                        autoPiP ? 'bg-[rgb(var(--color-accent))]' : 'bg-[rgb(var(--color-surface-4))]'
                      }`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${autoPiP ? 'translate-x-5' : ''}`} />
                    </button>
                  </div>

                  {/* Watch History */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-medium text-[rgb(var(--color-text-primary))]">Watch history</p>
                      {watchHistory.length > 0 && (
                        <button
                          onClick={handleClearHistory}
                          className="text-[10px] text-[rgb(var(--color-text-muted))] hover:text-red-400 cursor-pointer transition-colors"
                        >
                          Clear all
                        </button>
                      )}
                    </div>
                    <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] mb-3">
                      Videos you've watched and where you left off.
                    </p>
                    {watchHistory.length === 0 ? (
                      <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] italic">No watch history yet.</p>
                    ) : (() => {
                      // Group by month then day
                      const byMonth: Record<string, Record<string, typeof watchHistory>> = {}
                      for (const entry of watchHistory) {
                        const d = new Date(entry.lastWatched)
                        const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
                        const dayKey = `${monthKey}-${String(d.getDate()).padStart(2, '0')}`
                        if (!byMonth[monthKey]) byMonth[monthKey] = {}
                        if (!byMonth[monthKey][dayKey]) byMonth[monthKey][dayKey] = []
                        byMonth[monthKey][dayKey].push(entry)
                      }
                      const monthKeys = Object.keys(byMonth).sort().reverse()
                      return (
                        <div className="space-y-1">
                          {monthKeys.map((monthKey) => {
                            const [y, m] = monthKey.split('-')
                            const monthLabel = new Date(Number(y), Number(m) - 1, 1).toLocaleString('default', { month: 'long', year: 'numeric' })
                            const monthCollapsed = collapsedMonths.has(monthKey)
                            const toggleMonth = () => setCollapsedMonths((prev) => {
                              const next = new Set(prev)
                              next.has(monthKey) ? next.delete(monthKey) : next.add(monthKey)
                              return next
                            })
                            const dayKeys = Object.keys(byMonth[monthKey]).sort().reverse()
                            return (
                              <div key={monthKey}>
                                <button
                                  onClick={toggleMonth}
                                  className="flex items-center gap-1 w-full text-left py-0.5 text-[11px] font-semibold text-[rgb(var(--color-text-muted))] uppercase tracking-wider hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
                                >
                                  {monthCollapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
                                  {monthLabel}
                                </button>
                                {!monthCollapsed && (
                                  <div className="space-y-1 mt-0.5 ml-1">
                                    {dayKeys.map((dayKey) => {
                                      const [dy, dm, dd] = dayKey.split('-')
                                      const dayLabel = new Date(Number(dy), Number(dm) - 1, Number(dd)).toLocaleDateString('default', { weekday: 'short', month: 'short', day: 'numeric' })
                                      const dayCollapsed = collapsedDays.has(dayKey)
                                      const toggleDay = () => setCollapsedDays((prev) => {
                                        const next = new Set(prev)
                                        next.has(dayKey) ? next.delete(dayKey) : next.add(dayKey)
                                        return next
                                      })
                                      return (
                                        <div key={dayKey}>
                                          <button
                                            onClick={toggleDay}
                                            className="flex items-center gap-1 w-full text-left py-0.5 text-[10px] text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-secondary))] transition-colors cursor-pointer"
                                          >
                                            {dayCollapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
                                            {dayLabel}
                                          </button>
                                          {!dayCollapsed && (
                                            <div className="space-y-1 mt-0.5 ml-1">
                                              {byMonth[monthKey][dayKey].map((entry) => {
                                                const mins = Math.floor(entry.positionSeconds / 60)
                                                const secs = Math.floor(entry.positionSeconds % 60)
                                                const pos = `${mins}:${String(secs).padStart(2, '0')}`
                                                return (
                                                  <div
                                                    key={entry.videoId}
                                                    className="flex items-center gap-2.5 p-2 rounded-lg bg-[rgb(var(--color-surface-3))] border border-[rgb(var(--color-surface-4))]"
                                                  >
                                                    {entry.thumbnailUrl && (
                                                      <img
                                                        src={entry.thumbnailUrl}
                                                        alt=""
                                                        className="w-14 h-9 object-cover rounded flex-shrink-0 bg-[rgb(var(--color-surface-4))]"
                                                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                                                      />
                                                    )}
                                                    <div className="flex-1 min-w-0">
                                                      <p className="text-xs font-medium text-[rgb(var(--color-text-primary))] line-clamp-1">
                                                        {entry.title || entry.videoId}
                                                      </p>
                                                      <p className="text-[10px] text-[rgb(var(--color-text-muted))]">
                                                        {entry.channelName} · Watched to {pos}
                                                      </p>
                                                    </div>
                                                    <button
                                                      onClick={() => handleJumpToVideo(entry.videoId)}
                                                      title="Jump to video"
                                                      className="p-1 rounded text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-accent))] hover:bg-[rgb(var(--color-surface-4))] cursor-pointer transition-colors flex-shrink-0"
                                                    >
                                                      <ExternalLink size={12} />
                                                    </button>
                                                    <button
                                                      onClick={() => handleRemoveFromHistory(entry.videoId)}
                                                      title="Remove from history"
                                                      className="p-1 rounded text-[rgb(var(--color-text-muted))] hover:text-red-400 hover:bg-[rgb(var(--color-surface-4))] cursor-pointer transition-colors flex-shrink-0"
                                                    >
                                                      <Trash2 size={12} />
                                                    </button>
                                                  </div>
                                                )
                                              })}
                                            </div>
                                          )}
                                        </div>
                                      )
                                    })}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )
                    })()}
                  </div>

                  {/* YouTube Account / Sign In */}
                  <div>
                    <p className="text-sm font-medium text-[rgb(var(--color-text-primary))] mb-1">YouTube account</p>
                    <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] mb-3">
                      Sign in to YouTube to sync your subscriptions, history, and watch-later list across sessions.
                      Your login is stored in the app's persistent YouTube session and shared with the YouTube tab.
                    </p>
                    {showYTSignIn ? (
                      <>
                        <div className="rounded-lg overflow-hidden border border-[rgb(var(--color-surface-4))] mb-2" style={{ height: '380px' }}>
                          <webview
                            src="https://accounts.google.com/ServiceLogin?service=youtube"
                            partition="persist:youtube"
                            style={{ width: '100%', height: '100%', display: 'flex' }}
                          />
                        </div>
                        <button
                          onClick={() => setShowYTSignIn(false)}
                          className="s-desc text-xs text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer transition-colors"
                        >
                          Close
                        </button>
                      </>
                    ) : (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => { setShowYTSignIn(true); setYtSignedOut(false) }}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[rgb(var(--color-surface-4))] text-sm text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] cursor-pointer transition-colors"
                        >
                          Sign into YouTube
                        </button>
                        <button
                          onClick={async () => {
                            await window.app.youTubeSignOut?.()
                            setShowYTSignIn(false)
                            setYtSignedOut(true)
                          }}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[rgb(var(--color-surface-4))] text-sm text-red-400 hover:bg-red-400/10 hover:border-red-400/50 cursor-pointer transition-colors"
                        >
                          Sign out
                        </button>
                        {ytSignedOut && (
                          <span className="s-desc text-xs text-[rgb(var(--color-text-muted))]">Session cleared.</span>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}

              {section === 'word-replacer' && (
                <WordReplacerSection
                  enabled={wordReplacerEnabled}
                  rules={wordReplacerRules}
                  onToggleEnabled={setWordReplacerEnabled}
                  onToggleRule={toggleWordReplacerRule}
                />
              )}

              {section === 'shortcuts' && (
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <Keyboard size={14} className="text-[rgb(var(--color-text-muted))]" />
                    <p className="text-sm font-medium text-[rgb(var(--color-text-primary))]">Keyboard shortcuts</p>
                  </div>
                  <div className="space-y-4">
                    {SHORTCUT_GROUPS.map((group) => (
                      <div key={group.label}>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))] mb-1.5">{group.label}</p>
                        <div className="space-y-0.5">
                          {group.shortcuts.map((s) => (
                            <div key={s.key} className="flex items-center justify-between py-1.5 border-b border-[rgb(var(--color-surface-4))/50]">
                              <span className="text-sm text-[rgb(var(--color-text-secondary))]">{s.action}</span>
                              <kbd className="text-xs font-mono bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))] px-2 py-0.5 rounded">{s.key}</kbd>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {section === 'updates' && <UpdatesSection />}

              {section === 'import' && <ImportSection />}

              {section === 'about' && (
                <AboutSection />
              )}

              {section === 'danger' && (
                <DangerSection />
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ── Vault reconcile ───────────────────────────────────────────────────────────

function VaultReconcileButton() {
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [result, setResult] = useState<{ updated: number; skipped: number } | null>(null)

  async function reconcile() {
    setStatus('running')
    try {
      const r = await window.vault.reconcile()
      if (r.success) {
        setResult({ updated: r.updated, skipped: r.skipped })
        setStatus('done')
      } else {
        setStatus('error')
      }
    } catch {
      setStatus('error')
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={reconcile}
        disabled={status === 'running'}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer disabled:opacity-50"
      >
        <RefreshCw size={11} className={status === 'running' ? 'animate-spin' : ''} />
        {status === 'running' ? 'Scanning…' : 'Reconcile now'}
      </button>
      {status === 'done' && result && (
        <p className="s-desc text-xs text-[rgb(var(--color-text-muted))]">
          {result.updated} updated · {result.skipped} unchanged
        </p>
      )}
      {status === 'error' && (
        <p className="text-xs text-red-400">Reconcile failed — check vault path</p>
      )}
    </div>
  )
}

// ── Workspaces ────────────────────────────────────────────────────────────────

function WorkspacesSection() {
  const panelLayout = useAppStore((s) => s.panelLayout)
  const tabs = useAppStore((s) => s.tabs)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const savedWorkspaces = useAppStore((s) => s.savedWorkspaces)
  const setSavedWorkspaces = useAppStore((s) => s.setSavedWorkspaces)
  const updatePanelLayout = useAppStore((s) => s.updatePanelLayout)

  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  useEffect(() => {
    window.workspaces.list().then(setSavedWorkspaces).catch(() => {})
  }, [setSavedWorkspaces])

  async function saveWorkspace() {
    if (!newName.trim()) return
    setSaving(true)
    try {
      const layoutJson = JSON.stringify(panelLayout)
      const stateJson = JSON.stringify({ tabs, activeTabId })
      const ws = await window.workspaces.save(newName.trim(), layoutJson, stateJson)
      setSavedWorkspaces([ws, ...savedWorkspaces])
      setNewName('')
    } finally {
      setSaving(false)
    }
  }

  async function loadWorkspace(id: string) {
    const ws = await window.workspaces.load(id).catch(() => null)
    if (!ws) return
    try {
      const layout = JSON.parse(ws.layout_json)
      updatePanelLayout(layout)
    } catch {}
  }

  async function deleteWorkspace(id: string) {
    await window.workspaces.delete(id).catch(() => {})
    setSavedWorkspaces(savedWorkspaces.filter((w) => w.id !== id))
  }

  async function finishRename(id: string) {
    const name = renameValue.trim()
    if (name) {
      await window.workspaces.rename(id, name).catch(() => {})
      setSavedWorkspaces(savedWorkspaces.map((w) => w.id === id ? { ...w, name } : w))
    }
    setRenamingId(null)
    setRenameValue('')
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-medium text-[rgb(var(--color-text-primary))] mb-1">Saved workspaces</p>
        <p className="s-desc text-xs text-[rgb(var(--color-text-muted))]">
          Save a named snapshot of the current panel layout. Load it later to restore that arrangement. Tab contents are not restored — only the panel split configuration.
        </p>
      </div>

      {/* Save current */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && saveWorkspace()}
          placeholder="Name this workspace…"
          className="flex-1 px-3 py-1.5 text-xs rounded-lg bg-[rgb(var(--color-surface-3))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] outline-none focus:border-[rgb(var(--color-accent))]"
        />
        <button
          onClick={saveWorkspace}
          disabled={!newName.trim() || saving}
          className="px-3 py-1.5 text-xs rounded-lg bg-[rgb(var(--color-accent))] text-white hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
        >
          Save
        </button>
      </div>

      {/* List */}
      {savedWorkspaces.length === 0 ? (
        <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] text-center py-4">No saved workspaces yet</p>
      ) : (
        <div className="space-y-1.5">
          {savedWorkspaces.map((ws) => (
            <div key={ws.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[rgb(var(--color-surface-3))] border border-[rgb(var(--color-surface-4))]">
              {renamingId === ws.id ? (
                <input
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') finishRename(ws.id)
                    if (e.key === 'Escape') { setRenamingId(null); setRenameValue('') }
                  }}
                  onBlur={() => finishRename(ws.id)}
                  autoFocus
                  className="flex-1 bg-transparent text-xs text-[rgb(var(--color-text-primary))] outline-none border-b border-[rgb(var(--color-accent))]"
                />
              ) : (
                <span className="flex-1 text-xs text-[rgb(var(--color-text-primary))] truncate">{ws.name}</span>
              )}
              <span className="text-[10px] text-[rgb(var(--color-text-muted))] flex-shrink-0">
                {new Date(ws.created_at).toLocaleDateString()}
              </span>
              <button
                onClick={() => loadWorkspace(ws.id)}
                title="Load this workspace"
                className="text-[10px] px-2 py-0.5 rounded bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer flex-shrink-0"
              >
                Load
              </button>
              <button
                onClick={() => { setRenamingId(ws.id); setRenameValue(ws.name) }}
                title="Rename"
                className="text-[10px] px-2 py-0.5 rounded bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer flex-shrink-0"
              >
                Rename
              </button>
              <button
                onClick={() => deleteWorkspace(ws.id)}
                title="Delete this workspace"
                className="text-[rgb(var(--color-text-muted))] hover:text-red-400 transition-colors cursor-pointer flex-shrink-0"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

type ImportTab = 'biblegateway' | 'esword'

function ImportSection() {
  const importInitialTab = useAppStore((s) => s.importInitialTab)
  const [activeTab, setActiveTab] = useState<ImportTab>(importInitialTab)

  // Sync to whatever tab was requested when the modal was opened
  useEffect(() => {
    setActiveTab(importInitialTab)
  }, [importInitialTab])

  return (
    <div className="space-y-0 -mx-6 -mt-6">
      {/* Tab bar */}
      <div className="flex border-b border-[rgb(var(--color-surface-4))] px-6 mb-0">
        {([
          ['biblegateway', BookOpen, 'BibleGateway'],
          ['esword',       Sword,    'e-Sword'],
        ] as [ImportTab, typeof BookOpen, string][]).map(([id, Icon, label]) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-1.5 px-3 py-2.5 text-[12px] font-medium border-b-2 transition-colors cursor-pointer -mb-px ${
              activeTab === id
                ? 'border-[rgb(var(--color-accent))] text-[rgb(var(--color-accent))]'
                : 'border-transparent text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-secondary))]'
            }`}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>
      {/* Content */}
      <div className="px-6 pt-5">
        {activeTab === 'biblegateway' && <BibleGatewayImporter />}
        {activeTab === 'esword' && <ESwordImporter />}
      </div>
    </div>
  )
}

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

function AboutSection() {
  const closeSettings = useAppStore((s) => s.closeSettings)
  const openOnboarding = useAppStore((s) => s.openOnboarding)
  const resetTasks = useAppStore((s) => s.resetTasks)
  const [version, setVersion] = useState('')
  const [isDev, setIsDev] = useState(false)
  const [showDevGuide, setShowDevGuide] = useState(false)
  const [recreating, setRecreating] = useState(false)

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
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Danger zone ────────────────────────────────────────────────────────────────

interface DangerAction {
  id: string
  title: string
  description: string
  confirmWord: string
  buttonLabel: string
  onConfirm: () => Promise<void>
}

function DangerCard({ action }: { action: DangerAction }) {
  const [inputValue, setInputValue] = useState('')
  const [status, setStatus] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const isReady = inputValue.trim().toLowerCase() === action.confirmWord.toLowerCase()

  async function handleClick() {
    if (!isReady || status === 'busy') return
    setStatus('busy')
    try {
      await action.onConfirm()
      setStatus('done')
      setInputValue('')
      setTimeout(() => setStatus('idle'), 3000)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'An error occurred')
      setStatus('error')
      setTimeout(() => { setStatus('idle'); setErrorMsg('') }, 4000)
    }
  }

  return (
    <div className="border border-red-500/25 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-red-500/8 border-b border-red-500/20">
        <p className="text-sm font-semibold text-red-400">{action.title}</p>
        <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] mt-0.5">{action.description}</p>
      </div>
      {/* Confirmation input + button */}
      <div className="px-4 py-3 bg-[rgb(var(--color-surface-3))] flex items-center gap-3">
        <div className="flex-1">
          <p className="text-[10px] text-[rgb(var(--color-text-muted))] mb-1">
            Type <span className="font-mono font-semibold text-[rgb(var(--color-text-secondary))]">{action.confirmWord}</span> to confirm
          </p>
          <input
            type="text"
            value={inputValue}
            onChange={(e) => { setInputValue(e.target.value); setStatus('idle') }}
            placeholder={action.confirmWord}
            className="w-full text-sm px-3 py-1.5 rounded-md bg-[rgb(var(--color-surface-4))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] placeholder:text-[rgb(var(--color-text-muted))] outline-none focus:border-red-500/50 transition-colors"
          />
        </div>
        <button
          onClick={handleClick}
          disabled={!isReady || status === 'busy'}
          className={`flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:cursor-not-allowed ${
            status === 'done'
              ? 'bg-green-600/20 text-green-400 border border-green-600/30'
              : status === 'error'
              ? 'bg-red-600/20 text-red-400 border border-red-600/30'
              : isReady
              ? 'bg-red-600 hover:bg-red-700 text-white border border-red-600'
              : 'bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] border border-[rgb(var(--color-surface-4))] opacity-50'
          }`}
        >
          {status === 'busy' ? 'Working…' : status === 'done' ? 'Done' : status === 'error' ? (errorMsg || 'Error') : action.buttonLabel}
        </button>
      </div>
    </div>
  )
}

function DangerSection() {
  const clearHistory = useAppStore((s) => s.clearHistory)
  const bumpNoteToken = useAppStore((s) => s.bumpNoteToken)

  const actions: DangerAction[] = [
    {
      id: 'clear-history',
      title: 'Clear browsing history',
      description: 'Removes the entire navigation history log (scripture chapters, notes, lexicon entries, searches). Your notes and highlights are not affected.',
      confirmWord: 'history',
      buttonLabel: 'Clear history',
      onConfirm: async () => {
        clearHistory()
      },
    },
    {
      id: 'delete-bg-notes',
      title: 'Delete all BibleGateway notes',
      description: 'Permanently deletes every note imported from BibleGateway (tagged "biblegateway"). Other notes are not affected.',
      confirmWord: 'biblegateway',
      buttonLabel: 'Delete BibleGateway notes',
      onConfirm: async () => {
        await window.notes.deleteByTag('biblegateway')
        bumpNoteToken()
      },
    },
    {
      id: 'delete-esword-notes',
      title: 'Delete all e-Sword notes',
      description: 'Permanently deletes every note imported from e-Sword (tagged "esword"). Other notes are not affected.',
      confirmWord: 'esword',
      buttonLabel: 'Delete e-Sword notes',
      onConfirm: async () => {
        await window.notes.deleteByTag('esword')
        bumpNoteToken()
      },
    },
    {
      id: 'delete-all-notes',
      title: 'Delete all notes',
      description: 'Permanently deletes every note — verse notes, general notes, YouTube timestamp notes, and daily notes. This cannot be undone.',
      confirmWord: 'notes',
      buttonLabel: 'Delete all notes',
      onConfirm: async () => {
        await window.notes.deleteAllNotes()
        bumpNoteToken()
      },
    },
  ]

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-semibold text-red-400 mb-0.5">Danger zone</p>
        <p className="s-desc text-xs text-[rgb(var(--color-text-muted))]">
          These actions are permanent and cannot be undone. Each action requires you to type a confirmation word before the button activates.
        </p>
      </div>
      <div className="space-y-4">
        {actions.map((a) => (
          <DangerCard key={a.id} action={a} />
        ))}
      </div>
    </div>
  )
}
