import { useState, useEffect } from 'react'
import { BookOpen, FolderOpen, Keyboard, CheckCircle, ChevronRight, X, Layers, Download } from 'lucide-react'
import { useAppStore } from '@/store'
import BibleGatewayImporter from '@/components/settings/BibleGatewayImporter'
import ESwordImporter from '@/components/settings/ESwordImporter'

// ── Step definitions ──────────────────────────────────────────────────────────

const STEPS = [
  { id: 'welcome',      label: 'Welcome',      icon: BookOpen   },
  { id: 'translation',  label: 'Texts',        icon: Layers     },
  { id: 'vault',        label: 'Vault',        icon: FolderOpen },
  { id: 'import',       label: 'Import',       icon: Download   },
  { id: 'shortcuts',    label: 'Shortcuts',    icon: Keyboard   },
  { id: 'done',         label: 'Done',         icon: CheckCircle },
] as const

type StepId = (typeof STEPS)[number]['id']

// ── Onboarding note content created on completion ─────────────────────────────

const WELCOME_NOTE_CONTENT = `# Welcome to Berean

Berean is a local-first Bible study app built for serious study of Yehovah's word. Here is a reference guide for getting started.

---

## 1. Reading Scripture

Open the **Scripture** space with **⌘1**. Type any reference into the bar at the top of the Bible panel:

> \`Gen 1\` · \`Exodus 20:1-17\` · \`Rev 22\` · \`Psalm 119\`

**Navigation:**
- **⌘T** — Open a new reference or search
- **⌘K** — Command bar (search current space)
- \`⌘[\` / \`⌘]\` — Navigate back / forward through reading history
- **⌘G** — Toggle Strong's numbers inline

---

## 2. Texts Available

The following texts are available in the translation selector inside each Bible panel:

| Text | Abbreviation |
|------|-------------|
| King James + Apocrypha | KJVA |
| Brenton LXX (Septuagint) | LXX |
| 1 Enoch (R.H. Charles) | Enoch |
| Jubilees (R.H. Charles) | Jubilees |
| And more... | See Settings → Display |

Change your **default translation** in **Settings → Display**.

---

## 3. Notes

Press **⌘⇧N** to create a general note, or click the dot next to any verse number to attach a verse note.

- Write in **Markdown** — headings, bold, italic, lists, tables all work
- Press **⌘⇧M** to toggle between raw Markdown and rendered view
- Type \`[[Gen 1:1]]\` to create a clickable verse link
- Use **⌘B**, **⌘I**, **⌘U** for bold / italic / underline

---

## 4. Strong's Lexicon

When Strong's numbers are visible (toggle with **⌘G**):

- **Hover** over any Strong's chip to see a quick gloss
- **Click** to open the full lexicon entry with the Hebrew or Greek word, transliteration, full definition, and every occurrence in Scripture

---

## 5. Highlighting

Select any text in a verse — a color toolbar appears above the selection. Choose a color and the highlight is saved permanently.

Colors and their suggested uses:
- 🟡 **Yellow** — general study
- 🔴 **Red** — warning, rebuke, sin
- 🟢 **Green** — Torah connection
- 🔵 **Blue** — cross-reference
- 🟣 **Purple** — prophecy

---

## 6. Search

Press **⌘⇧F** or go to the **Search** space (**⌘5**).

- Phrase: \`in the beginning\`
- Any word: \`sabbath holy rest\`
- Strong's: \`H7676\`
- All texts searched simultaneously — filter by OT / NT / Apocrypha

---

## 7. Vault Sync (Optional)

To sync your notes as Markdown files to a local folder (compatible with Obsidian, Logseq, or any Markdown app), go to **Settings → Vault Sync** and choose a folder.

---

## 8. Key Shortcuts

| Shortcut | Action |
|----------|--------|
| ⌘1–5 | Switch between spaces |
| ⌘T | Open reference / new tab |
| ⌘K | Command bar |
| ⌘W | Close current tab |
| ⌘F | Find in current view |
| ⌘⇧F | Full text search |
| ⌘⇧N | New note |
| ⌘⇧M | Toggle Markdown preview |
| ⌘G | Toggle Strong's numbers |
| ⌘[ / ⌘] | Navigate back / forward |
| ⌘, | Open Settings |
| ⌘H | Open history |
| Ctrl+Tab | Switch tabs (MRU order) |

---

*This note was created automatically on first launch. You can edit or delete it at any time.*
`

// ── Helper: create welcome note ────────────────────────────────────────────────

async function createWelcomeNote() {
  try {
    await window.notes.createNote({
      type: 'general',
      title: 'Welcome to Berean — Getting Started',
      content: WELCOME_NOTE_CONTENT,
      color: 'blue',
      tags: ['berean', 'guide'],
    })
  } catch {
    // non-fatal
  }
}

// ── Sub-components for each step ──────────────────────────────────────────────

function StepWelcome() {
  return (
    <div className="flex flex-col items-center text-center gap-6">
      <div className="w-16 h-16 rounded-2xl bg-[rgb(var(--color-accent))/15] flex items-center justify-center">
        <BookOpen size={32} className="text-[rgb(var(--color-accent))]" />
      </div>
      <div>
        <h2 className="text-2xl font-bold text-[rgb(var(--color-text-primary))] mb-2">Welcome to Berean</h2>
        <p className="text-[rgb(var(--color-text-secondary))] text-sm leading-relaxed max-w-sm">
          A local-first Bible study app for Yehovah's servants. Read, compare, annotate,
          and search across KJV+A, LXX, 1 Enoch, Jubilees, and more — all offline.
        </p>
      </div>
      <div className="w-full max-w-sm space-y-2 text-left">
        {[
          'Verse notes with color indicators',
          'Strong\'s lexicon with full definitions',
          'Highlight words and phrases',
          'Search across all texts simultaneously',
          'Sync notes to any Markdown folder',
        ].map((feat) => (
          <div key={feat} className="flex items-center gap-2 text-sm text-[rgb(var(--color-text-secondary))]">
            <CheckCircle size={13} className="text-[rgb(var(--color-accent))] flex-shrink-0" />
            {feat}
          </div>
        ))}
      </div>
    </div>
  )
}

function StepTranslation() {
  const defaultBibleTranslation = useAppStore((s) => s.defaultBibleTranslation)
  const setDefaultBibleTranslation = useAppStore((s) => s.setDefaultBibleTranslation)

  const texts = [
    { id: 'kjva',     name: 'KJV + Apocrypha',     desc: 'King James Version with deuterocanonical books' },
    { id: 'lxx',      name: 'Brenton LXX',          desc: 'English Septuagint — the Bible of the apostles' },
    { id: 'enoch',    name: '1 Enoch',              desc: 'R.H. Charles translation — quoted in Jude & NT' },
    { id: 'jubilees', name: 'Jubilees',             desc: 'R.H. Charles translation — calendar & Torah detail' },
  ]

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl font-bold text-[rgb(var(--color-text-primary))] mb-1">Choose your default text</h2>
        <p className="text-sm text-[rgb(var(--color-text-secondary))]">
          This is what opens when you start a new Bible tab. You can always switch per-tab.
        </p>
      </div>
      <div className="space-y-2">
        {texts.map((t) => (
          <button
            key={t.id}
            onClick={() => setDefaultBibleTranslation(t.id)}
            className={`w-full text-left px-4 py-3 rounded-xl border transition-all cursor-pointer ${
              defaultBibleTranslation === t.id
                ? 'border-[rgb(var(--color-accent))] bg-[rgb(var(--color-accent))/10]'
                : 'border-[rgb(var(--color-surface-4))] hover:border-[rgb(var(--color-text-muted))] bg-[rgb(var(--color-surface-3))]'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className={`text-sm font-medium ${
                defaultBibleTranslation === t.id
                  ? 'text-[rgb(var(--color-accent))]'
                  : 'text-[rgb(var(--color-text-primary))]'
              }`}>{t.name}</span>
              {defaultBibleTranslation === t.id && (
                <CheckCircle size={14} className="text-[rgb(var(--color-accent))]" />
              )}
            </div>
            <p className="text-xs text-[rgb(var(--color-text-muted))] mt-0.5">{t.desc}</p>
          </button>
        ))}
      </div>
      <p className="text-xs text-[rgb(var(--color-text-muted))]">
        More texts and all settings available in <strong>Settings → Display</strong>.
      </p>
    </div>
  )
}

function StepVault() {
  const [vaultPath, setVaultPath] = useState('')
  const [vaultSync, setVaultSync] = useState(false)
  const [picking, setPicking] = useState(false)

  useEffect(() => {
    window.settings?.get('vaultPath').then((p) => {
      if (typeof p === 'string' && p) setVaultPath(p)
    }).catch(() => {})
    window.settings?.get('vaultSync').then((v) => {
      setVaultSync(Boolean(v))
    }).catch(() => {})
  }, [])

  async function pickFolder() {
    setPicking(true)
    try {
      const p = await window.app.openFolderDialog()
      if (p) {
        setVaultPath(p)
        await window.settings?.set('vaultPath', p)
      }
    } finally {
      setPicking(false)
    }
  }

  async function toggleSync(enabled: boolean) {
    setVaultSync(enabled)
    await window.settings?.set('vaultSync', enabled)
    if (enabled && vaultPath) window.vault?.watchVault().catch(() => {})
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl font-bold text-[rgb(var(--color-text-primary))] mb-1">Vault sync <span className="text-sm font-normal text-[rgb(var(--color-text-muted))]">— optional</span></h2>
        <p className="text-sm text-[rgb(var(--color-text-secondary))] leading-relaxed">
          Sync your notes as plain Markdown files to any local folder — works with Obsidian, Logseq, iA Writer, or any Markdown app.
          If you skip this step, notes are stored only inside Berean.
        </p>
      </div>

      {/* Enable toggle */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-[rgb(var(--color-text-primary))]">Enable vault sync</span>
        <button
          onClick={() => toggleSync(!vaultSync)}
          className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${
            vaultSync ? 'bg-[rgb(var(--color-accent))]' : 'bg-[rgb(var(--color-surface-4))]'
          }`}
        >
          <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${vaultSync ? 'translate-x-5' : ''}`} />
        </button>
      </div>

      {/* Folder picker */}
      {vaultSync && (
        <div className="space-y-2">
          <p className="text-xs text-[rgb(var(--color-text-muted))]">Vault folder</p>
          <div className="flex gap-2">
            <div className="flex-1 px-3 py-2 rounded-lg bg-[rgb(var(--color-surface-3))] border border-[rgb(var(--color-surface-4))] text-xs text-[rgb(var(--color-text-secondary))] truncate">
              {vaultPath || <span className="text-[rgb(var(--color-text-muted))]">No folder selected</span>}
            </div>
            <button
              onClick={pickFolder}
              disabled={picking}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[rgb(var(--color-surface-4))] text-xs text-[rgb(var(--color-text-primary))] hover:opacity-80 transition-opacity cursor-pointer disabled:opacity-50"
            >
              <FolderOpen size={13} />
              Choose…
            </button>
          </div>
          <p className="text-[10px] text-[rgb(var(--color-text-muted))]">
            Berean will write notes into a <code>berean-notes/</code> subfolder inside this directory.
          </p>
        </div>
      )}

      {!vaultSync && (
        <div className="px-4 py-3 rounded-xl bg-[rgb(var(--color-surface-3))] border border-[rgb(var(--color-surface-4))]">
          <p className="text-xs text-[rgb(var(--color-text-muted))] leading-relaxed">
            You can enable vault sync later in <strong>Settings → Vault Sync</strong>.
          </p>
        </div>
      )}
    </div>
  )
}

function StepImport() {
  const [tab, setTab] = useState<'bg' | 'esword' | null>(null)

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-bold text-[rgb(var(--color-text-primary))] mb-1">
          Import notes <span className="text-sm font-normal text-[rgb(var(--color-text-muted))]">— optional</span>
        </h2>
        <p className="text-sm text-[rgb(var(--color-text-secondary))] leading-relaxed">
          Import existing notes from BibleGateway or e-Sword. You can also do this later from <strong>Settings → Import</strong>.
        </p>
      </div>

      {/* Source picker */}
      {tab === null && (
        <div className="space-y-3">
          <button
            onClick={() => setTab('bg')}
            className="w-full text-left px-4 py-3 rounded-xl border border-[rgb(var(--color-surface-4))] hover:border-[rgb(var(--color-accent))/50] bg-[rgb(var(--color-surface-3))] hover:bg-[rgb(var(--color-surface-4))] transition-all cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <Download size={16} className="text-[rgb(var(--color-accent))] flex-shrink-0" />
              <div>
                <div className="text-sm font-medium text-[rgb(var(--color-text-primary))]">Import from BibleGateway</div>
                <div className="text-xs text-[rgb(var(--color-text-muted))] mt-0.5">Sync highlights and notes from your BibleGateway account</div>
              </div>
            </div>
          </button>
          <button
            onClick={() => setTab('esword')}
            className="w-full text-left px-4 py-3 rounded-xl border border-[rgb(var(--color-surface-4))] hover:border-[rgb(var(--color-accent))/50] bg-[rgb(var(--color-surface-3))] hover:bg-[rgb(var(--color-surface-4))] transition-all cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <Download size={16} className="text-[rgb(var(--color-accent))] flex-shrink-0" />
              <div>
                <div className="text-sm font-medium text-[rgb(var(--color-text-primary))]">Import from e-Sword</div>
                <div className="text-xs text-[rgb(var(--color-text-muted))] mt-0.5">Import study notes and journal entries from e-Sword</div>
              </div>
            </div>
          </button>
          <p className="text-xs text-[rgb(var(--color-text-muted))] text-center pt-1">
            Press <strong>Next</strong> to skip — always available under Settings → Import
          </p>
        </div>
      )}

      {/* Embedded importers */}
      {tab === 'bg' && (
        <div className="flex flex-col gap-3">
          <button
            onClick={() => setTab(null)}
            className="self-start flex items-center gap-1.5 text-xs text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer"
          >
            ← Back to import options
          </button>
          <div className="overflow-y-auto max-h-[420px] pr-1">
            <BibleGatewayImporter />
          </div>
        </div>
      )}
      {tab === 'esword' && (
        <div className="flex flex-col gap-3">
          <button
            onClick={() => setTab(null)}
            className="self-start flex items-center gap-1.5 text-xs text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer"
          >
            ← Back to import options
          </button>
          <div className="overflow-y-auto max-h-[420px] pr-1">
            <ESwordImporter />
          </div>
        </div>
      )}
    </div>
  )
}

function StepShortcuts() {
  const shortcuts = [
    { key: '⌘T',     action: 'Open reference or search'     },
    { key: '⌘K',     action: 'Command bar'                  },
    { key: '⌘1–5',   action: 'Switch between spaces'        },
    { key: '⌘W',     action: 'Close current tab'            },
    { key: '⌘F',     action: 'Find in current view'         },
    { key: '⌘⇧F',    action: 'Full text search'             },
    { key: '⌘⇧N',    action: 'New note'                     },
    { key: '⌘G',     action: 'Toggle Strong\'s numbers'     },
    { key: '⌘[ / ]', action: 'Navigate back / forward'      },
    { key: '⌘,',     action: 'Settings'                     },
  ]

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl font-bold text-[rgb(var(--color-text-primary))] mb-1">Key shortcuts</h2>
        <p className="text-sm text-[rgb(var(--color-text-secondary))]">
          Berean is keyboard-driven. Here are the most useful ones.
        </p>
      </div>
      <div className="space-y-1.5">
        {shortcuts.map(({ key, action }) => (
          <div key={key} className="flex items-center gap-3">
            <kbd className="min-w-[72px] text-center px-2 py-1 rounded-md bg-[rgb(var(--color-surface-4))] text-[10px] font-mono text-[rgb(var(--color-text-primary))] border border-[rgb(var(--color-surface-4))] flex-shrink-0">
              {key}
            </kbd>
            <span className="text-sm text-[rgb(var(--color-text-secondary))]">{action}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-[rgb(var(--color-text-muted))]">
        Full list available in <strong>Settings → Shortcuts</strong>.
      </p>
    </div>
  )
}

function StepDone() {
  return (
    <div className="flex flex-col items-center text-center gap-6">
      <div className="w-16 h-16 rounded-2xl bg-[rgb(var(--color-accent))/15] flex items-center justify-center">
        <CheckCircle size={32} className="text-[rgb(var(--color-accent))]" />
      </div>
      <div>
        <h2 className="text-2xl font-bold text-[rgb(var(--color-text-primary))] mb-2">You're all set</h2>
        <p className="text-sm text-[rgb(var(--color-text-secondary))] leading-relaxed max-w-sm">
          A <strong>Getting Started</strong> note has been added to your Notes space with a full reference guide.
          You can replay this walkthrough anytime from <strong>Settings → About</strong>.
        </p>
      </div>
      <div className="px-4 py-3 rounded-xl bg-[rgb(var(--color-surface-3))] border border-[rgb(var(--color-surface-4))] text-left w-full max-w-sm">
        <p className="text-xs text-[rgb(var(--color-text-muted))] leading-relaxed">
          Press <kbd className="px-1 py-0.5 rounded bg-[rgb(var(--color-surface-4))] font-mono text-[10px]">⌘1</kbd> to open Scripture,{' '}
          <kbd className="px-1 py-0.5 rounded bg-[rgb(var(--color-surface-4))] font-mono text-[10px]">⌘T</kbd> to open a passage,{' '}
          and <kbd className="px-1 py-0.5 rounded bg-[rgb(var(--color-surface-4))] font-mono text-[10px]">⌘,</kbd> for settings.
        </p>
      </div>
    </div>
  )
}

// ── Main Onboarding component ─────────────────────────────────────────────────

export default function Onboarding() {
  const onboardingOpen = useAppStore((s) => s.onboardingOpen)
  const closeOnboarding = useAppStore((s) => s.closeOnboarding)
  const completeOnboarding = useAppStore((s) => s.completeOnboarding)

  const [stepIdx, setStepIdx] = useState(0)
  const [completing, setCompleting] = useState(false)

  // Reset to first step when opened
  useEffect(() => {
    if (onboardingOpen) setStepIdx(0)
  }, [onboardingOpen])

  if (!onboardingOpen) return null

  const currentStep = STEPS[stepIdx]
  const isLast = stepIdx === STEPS.length - 1
  const isFirst = stepIdx === 0

  async function handleNext() {
    if (isLast) {
      setCompleting(true)
      await createWelcomeNote()
      completeOnboarding()
      setCompleting(false)
    } else {
      setStepIdx((i) => i + 1)
    }
  }

  function handleSkip() {
    completeOnboarding()
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60">
      <div className="relative w-full max-w-lg mx-4 bg-[rgb(var(--color-surface-2))] border border-[rgb(var(--color-surface-4))] rounded-2xl shadow-2xl overflow-hidden flex flex-col" style={{ maxHeight: '90vh' }}>

        {/* Close / Skip button (top right) */}
        <button
          onClick={handleSkip}
          title="Skip onboarding"
          className="absolute top-4 right-4 p-1.5 rounded-lg text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer z-10"
        >
          <X size={16} />
        </button>

        {/* Step progress bar */}
        <div className="flex gap-1.5 px-6 pt-6 pb-0">
          {STEPS.map((step, i) => (
            <div
              key={step.id}
              className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                i <= stepIdx
                  ? 'bg-[rgb(var(--color-accent))]'
                  : 'bg-[rgb(var(--color-surface-4))]'
              }`}
            />
          ))}
        </div>

        {/* Step label */}
        <div className="px-6 pt-3 pb-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))]">
            Step {stepIdx + 1} of {STEPS.length} — {currentStep.label}
          </p>
        </div>

        {/* Step content */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {currentStep.id === 'welcome'     && <StepWelcome />}
          {currentStep.id === 'translation' && <StepTranslation />}
          {currentStep.id === 'vault'       && <StepVault />}
          {currentStep.id === 'import'      && <StepImport />}
          {currentStep.id === 'shortcuts'   && <StepShortcuts />}
          {currentStep.id === 'done'        && <StepDone />}
        </div>

        {/* Footer buttons */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[rgb(var(--color-surface-4))] flex-shrink-0">
          {/* Back or skip */}
          <div>
            {!isFirst && (
              <button
                onClick={() => setStepIdx((i) => i - 1)}
                className="px-3 py-1.5 text-sm text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
              >
                Back
              </button>
            )}
            {isFirst && (
              <button
                onClick={handleSkip}
                className="px-3 py-1.5 text-sm text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
              >
                Skip all
              </button>
            )}
          </div>

          {/* Next / Finish */}
          <button
            onClick={handleNext}
            disabled={completing}
            className="flex items-center gap-2 px-5 py-2 rounded-xl bg-[rgb(var(--color-accent))] text-white text-sm font-medium hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-60"
          >
            {completing ? 'Setting up…' : isLast ? 'Start studying' : 'Next'}
            {!completing && !isLast && <ChevronRight size={15} />}
          </button>
        </div>
      </div>
    </div>
  )
}
