import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  BookOpen, Search, BookMarked, Highlighter, FileText,
  StickyNote, LayoutTemplate, Settings2, History, ChevronDown,
  X, CheckCircle2, Sparkles, ArrowRight, ChevronRight,
  Languages, AlignLeft, Circle, Youtube, ExternalLink,
  Layers, PanelRight, Table2,
} from 'lucide-react'
import { useAppStore } from '@/store'
import type { AppState } from '@/store'
import type { BibleTabState } from '@/types'
import ShortcutKeys from './ShortcutKeys'

// ── Types ─────────────────────────────────────────────────────────────────────

interface StepDef {
  id: string
  text: string
  hint?: string
  detect?: (s: AppState) => boolean
}

interface TaskDef {
  id: string
  icon: React.ElementType
  title: string
  subtitle: string
  steps: StepDef[]
  shortcut?: string
  actionLabel?: string
  action?: () => void
}

interface SectionDef {
  id: string
  label: string
  tasks: TaskDef[]
}

// ── Common detectors ──────────────────────────────────────────────────────────

function hasBibleTab(s: AppState) {
  return Object.values(s.tabs).flat().some(t => t.type === 'bible')
}
function hasStrongsEnabled(s: AppState) {
  return Object.values(s.tabs).flat().some(
    t => t.type === 'bible' && (t.state as BibleTabState | undefined)?.showStrongs === true
  )
}

// ── Section & task definitions ────────────────────────────────────────────────

const SECTIONS: SectionDef[] = [

  // ─────────────────────────────────────────────────────────────────────────
  // FIRST STEPS
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'first-steps',
    label: 'First Steps',
    tasks: [
      {
        id: 'open-welcome-note',
        icon: FileText,
        title: 'Read the Getting Started guide',
        subtitle: 'Open the Welcome note Berean created for you on first launch.',
        shortcut: '⌘2',
        steps: [
          {
            id: 'space',
            text: 'Click the Notes icon in the left sidebar',
            hint: 'It looks like a document stack. Or press ⌘2 to jump there directly.',
            detect: (s) => s.activeSpace === 'notes',
          },
          {
            id: 'open',
            text: 'Click "Welcome to Berean — Getting Started" in the notes list',
            hint: 'It opens as a full tab with an overview of every feature.',
            detect: (s) => Object.values(s.tabs).flat().some(
              t => t.type === 'note' && t.title.toLowerCase().includes('welcome to berean')
            ),
          },
        ],
        actionLabel: 'Go to Notes',
        action: () => useAppStore.getState().setActiveSpace('notes'),
      },
      {
        id: 'open-passage',
        icon: BookOpen,
        title: 'Open a Bible passage',
        subtitle: 'Navigate to any book, chapter, or verse using the quick-search bar.',
        shortcut: '⌘T',
        steps: [
          {
            id: 'search',
            text: 'Press ⌘T to open the floating search bar',
            hint: 'A centered overlay appears — search references, Strong\'s numbers, keywords, and notes from here.',
            detect: (s) => s.searchOpen,
          },
          {
            id: 'navigate',
            text: 'Type a reference like "Genesis 1" or "Rev 22" and press Enter',
            hint: 'The passage opens in a new Scripture tab. Try chapter ranges too: "Exodus 20:1-17".',
            detect: (s) => s.history.some(h => h.type === 'bible'),
          },
        ],
        actionLabel: 'Open search bar',
        action: () => useAppStore.getState().openSearch('new'),
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // READING SCRIPTURE
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'reading',
    label: 'Reading Scripture',
    tasks: [
      {
        id: 'change-translation',
        icon: Languages,
        title: 'Switch to a different translation',
        subtitle: 'Try Brenton LXX, 1 Enoch, or Jubilees alongside the KJV.',
        steps: [
          {
            id: 'bible',
            text: 'Open a Bible passage first (press ⌘T, type "Genesis 1")',
            hint: 'Any reference works.',
            detect: hasBibleTab,
          },
          {
            id: 'switch',
            text: 'Click the translation pill in the Bible panel header (e.g. "KJVA")',
            hint: 'A dropdown appears with all enabled texts. Select Brenton LXX, 1 Enoch, Jubilees, or any other — the panel reloads at the same reference.',
            detect: (s) => Object.values(s.tabs).flat().some(
              t => t.type === 'bible' &&
                !!(t.state as BibleTabState | undefined)?.translation &&
                (t.state as BibleTabState).translation !== 'KJVA'
            ),
          },
        ],
      },
      {
        id: 'enable-strongs',
        icon: BookMarked,
        title: "Show Strong's numbers",
        subtitle: 'Display Hebrew/Greek word codes inline with every verse.',
        shortcut: '⌘G',
        steps: [
          {
            id: 'bible',
            text: 'Open a Bible passage in KJVA or Brenton LXX',
            hint: 'Strong\'s numbers are linked to these two texts.',
            detect: hasBibleTab,
          },
          {
            id: 'toggle',
            text: 'Press ⌘G — or click the # icon in the Bible panel toolbar',
            hint: 'Numbered chips (like H7225) appear after each word. Every chip is clickable and hoverable.',
            detect: hasStrongsEnabled,
          },
        ],
        actionLabel: "Toggle Strong's",
        action: () => window.dispatchEvent(new CustomEvent('berean:toggleStrongs')),
      },
      {
        id: 'navigate-history',
        icon: History,
        title: 'Navigate with reading history',
        subtitle: 'Jump back and forward through every passage you\'ve visited.',
        shortcut: '⌘H',
        steps: [
          {
            id: 'passages',
            text: 'Visit at least 3 different Bible chapters',
            hint: 'Press ⌘T and open Genesis 1, Exodus 20, Revelation 22 — or any three you like.',
            detect: (s) => s.history.filter(h => h.type === 'bible').length >= 3,
          },
          {
            id: 'history',
            text: 'Press ⌘H to open the History panel',
            hint: 'See your complete reading trail — click any entry to jump back. Use ⌘[ / ⌘] to step back and forward one at a time.',
            detect: (s) => s.historyOpen,
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // STUDY TOOLS
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'study-tools',
    label: 'Study Tools',
    tasks: [
      {
        id: 'strongs-hover',
        icon: BookMarked,
        title: "Hover a Strong's chip",
        subtitle: 'See the original word, transliteration, and definition instantly.',
        shortcut: '⌘G',
        steps: [
          {
            id: 'enable',
            text: 'Enable Strong\'s numbers on an open Bible passage (press ⌘G)',
            hint: 'You need KJVA or Brenton LXX open.',
            detect: hasStrongsEnabled,
          },
          {
            id: 'hover',
            text: 'Move your mouse over any numbered chip without clicking',
            hint: 'A tooltip pops up: the Hebrew/Greek word, transliteration, and a one-line gloss. No click needed — just hover.',
            detect: (s) => s.strongsHoverToken > 0,
          },
        ],
        actionLabel: "Enable Strong's",
        action: () => window.dispatchEvent(new CustomEvent('berean:toggleStrongs')),
      },
      {
        id: 'open-lexicon',
        icon: BookMarked,
        title: 'Open a full lexicon entry',
        subtitle: 'Dive into the complete BDB (Hebrew) or Greek dictionary definition.',
        steps: [
          {
            id: 'strongs',
            text: 'Enable Strong\'s numbers (press ⌘G)',
            hint: 'The chips need to be visible before you can click one.',
            detect: hasStrongsEnabled,
          },
          {
            id: 'click',
            text: 'Click any Strong\'s chip — e.g. H7225 after "beginning" in Gen 1:1',
            hint: 'A Lexicon tab opens with the full entry: original word, transliteration, complete definition, and every verse where the word appears.',
            detect: (s) => Object.values(s.tabs).flat().some(t => t.type === 'lexicon'),
          },
        ],
      },
      {
        id: 'compare-verse',
        icon: LayoutTemplate,
        title: 'Compare a verse across translations',
        subtitle: 'View KJV, LXX, Enoch, and more side-by-side in one panel.',
        steps: [
          {
            id: 'bible',
            text: 'Open a Bible passage',
            hint: 'Any chapter works. Gen 1 is a great one for comparing creation accounts.',
            detect: hasBibleTab,
          },
          {
            id: 'compare',
            text: 'Right-click any verse number → "Compare this verse" — or click ⇌ in the toolbar',
            hint: 'A multi-column panel opens. Navigate with the reference bar at the top — all columns move together.',
            detect: (s) => Object.values(s.tabs).flat().some(
              t => t.type === 'bible' && (t.state as BibleTabState | undefined)?.compareMode === true
            ),
          },
        ],
        actionLabel: 'Enter compare mode',
        action: () => window.dispatchEvent(new CustomEvent('berean:compareVerse')),
      },
      {
        id: 'search-text',
        icon: Search,
        title: 'Search across all texts',
        subtitle: 'Full-text keyword search across KJV, LXX, Enoch, Jubilees simultaneously.',
        shortcut: '⌘⇧F',
        steps: [
          {
            id: 'open',
            text: 'Press ⌘⇧F to open the full-text search tab',
            hint: 'A dedicated Search tab opens in the Search space.',
            detect: (s) => Object.values(s.tabs).flat().some(t => t.type === 'search'),
          },
          {
            id: 'query',
            text: 'Type a word or phrase and press Enter — e.g. "sabbath" or "covenant"',
            hint: 'Results come from every enabled text at once, grouped by book. Click any result to jump to that verse.',
            detect: (s) => s.history.some(h => h.type === 'search' && (h.query?.length ?? 0) > 0),
          },
        ],
        actionLabel: 'Open search',
        action: () => useAppStore.getState().openSearchTab(''),
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // ANNOTATION
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'annotation',
    label: 'Annotation',
    tasks: [
      {
        id: 'highlight-verse',
        icon: Highlighter,
        title: 'Highlight words or phrases',
        subtitle: 'Color-code passages you want to revisit or cross-reference.',
        steps: [
          {
            id: 'bible',
            text: 'Open a Bible passage (press ⌘T)',
            detect: hasBibleTab,
          },
          {
            id: 'color',
            text: 'Click and drag to select text, then pick a color from the toolbar that appears',
            hint: 'Select any word, phrase, or full verse. The highlight saves immediately and persists across restarts. A small color dot appears on the verse number badge.',
            detect: (s) => s.highlightChangeToken > 0,
          },
        ],
      },
      {
        id: 'verse-note',
        icon: StickyNote,
        title: 'Attach a note to a verse',
        subtitle: 'Write a study note anchored to a specific verse — it shows as a colored dot.',
        steps: [
          {
            id: 'bible',
            text: 'Open a Bible passage and find a verse to annotate',
            detect: hasBibleTab,
          },
          {
            id: 'dot',
            text: 'Click the verse number badge — a popover appears with note and action options',
            hint: 'Look for the number badge at the left of each verse. Clicking it opens the verse action menu.',
            detect: (s) => s.versePopoverToken > 0,
          },
          {
            id: 'create',
            text: 'Press "+ New note for [verse]" and write your observation',
            hint: 'The note opens in the right panel, pre-tagged with the verse reference. Use Markdown freely.',
            detect: (s) => s.verseNoteToken > 0,
          },
        ],
      },
      {
        id: 'general-note',
        icon: AlignLeft,
        title: 'Create a freeform study note',
        subtitle: 'Write in full Markdown — headings, tables, callouts, verse links, and more.',
        shortcut: '⌘⇧N',
        steps: [
          {
            id: 'create',
            text: 'Press ⌘⇧N to create a new general note',
            hint: 'A blank note tab opens in the Notes space, ready to edit.',
            detect: (s) => Object.values(s.tabs).flat().some(
              t => t.type === 'note' && !t.title.toLowerCase().includes('welcome to berean')
            ),
          },
          {
            id: 'write',
            text: 'Write something — try **bold**, # Heading, or > Blockquote',
            hint: 'Keep typing until you have more than a line. Press ⌘⇧M to toggle between raw Markdown and rendered preview. Type [[Gen 1:1]] to insert a clickable verse link.',
            detect: (s) => s.noteEditToken > 0,
          },
          {
            id: 'table',
            text: 'Click the table icon (⊞) in the toolbar to insert a comparison table',
            hint: 'Tables are great for comparing Strong\'s entries, translations, or study outlines. Click the ? button to open the full Markdown reference.',
            detect: (s) => s.tableInsertToken > 0,
          },
        ],
        actionLabel: 'New note',
        action: () => {
          useAppStore.getState().setActiveSpace('notes')
          window.dispatchEvent(new CustomEvent('berean:newNote'))
        },
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // YOUTUBE
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'youtube',
    label: 'YouTube',
    tasks: [
      {
        id: 'youtube-open',
        icon: Youtube,
        title: 'Open a YouTube video',
        subtitle: 'Watch study content without leaving Berean.',
        shortcut: '⌘5',
        steps: [
          {
            id: 'space',
            text: 'Click the YouTube icon in the sidebar (or press ⌘5)',
            detect: (s) => s.activeSpace === 'youtube',
          },
          {
            id: 'url',
            text: 'Click any video on YouTube to start watching',
            hint: 'Browse YouTube normally — search, open channels, use playlists. The embedded browser is fully logged in. Just click a video thumbnail to play.',
            detect: (s) => s.youtubeIsPlaying,
          },
        ],
        actionLabel: 'Go to YouTube',
        action: () => useAppStore.getState().setActiveSpace('youtube'),
      },
      {
        id: 'youtube-pip',
        icon: Youtube,
        title: 'Use Picture-in-Picture',
        subtitle: 'Keep a video playing while you study Scripture or take notes.',
        shortcut: '⌘⇧P',
        steps: [
          {
            id: 'play',
            text: 'Start playing a YouTube video in the YouTube space',
            hint: 'Open a video and press play — the tab shows a green dot while playing.',
            detect: (s) => s.youtubeIsPlaying,
          },
          {
            id: 'pip',
            text: 'Switch to the Scripture space (press ⌘1) — the video enters PiP automatically',
            hint: 'The floating PiP window appears over the app. You can also press ⌘⇧P to toggle PiP manually at any time. Return to the YouTube tab to dismiss it.',
            detect: (s) => s.youtubePipToken > 0,
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // LAYOUT & ORGANIZATION
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'layout',
    label: 'Layout & Organization',
    tasks: [
      {
        id: 'right-panel',
        icon: PanelRight,
        title: 'Open the Bible right panel',
        subtitle: 'View notes, cross-references, and lexicon entries alongside your passage.',
        steps: [
          {
            id: 'bible',
            text: 'Open a Bible passage',
            detect: hasBibleTab,
          },
          {
            id: 'panel',
            text: 'Click the panel icon (▷) in the Bible panel toolbar to open the right panel',
            hint: 'A side panel slides open with three tabs: Notes (passage notes), Lexicon (Strong\'s definitions), and Cross-refs. You can drag the divider to resize it.',
            detect: (s) => Object.values(s.tabs).flat().some(
              t => t.type === 'bible' && (t.state as BibleTabState | undefined)?.rightPanelOpen === true
            ),
          },
        ],
      },
      {
        id: 'floating-tab',
        icon: ExternalLink,
        title: 'Open a tab in a floating window',
        subtitle: 'Detach any tab into a separate window — great for dual monitors.',
        steps: [
          {
            id: 'open',
            text: 'Open any tab (Bible, Note, or Lexicon) so it appears in the sidebar',
            hint: 'Press ⌘T and open any passage to create a tab.',
            detect: (s) => Object.values(s.tabs).flat().length > 0,
          },
          {
            id: 'float',
            text: 'Right-click the tab in the sidebar → "Open in floating tab"',
            hint: 'A detached window appears. It stays on top of the main app and can be moved to another monitor independently.',
            detect: (s) => s.floatingTabToken > 0,
          },
        ],
      },
      {
        id: 'session',
        icon: Layers,
        title: 'Create a study session',
        subtitle: 'Organize separate tab groups — one for each topic or series.',
        steps: [
          {
            id: 'create',
            text: 'Press ⌘⇧0 to create a new session',
            hint: 'Each session has its own independent tab groups for Scripture, Notes, Lexicon, YouTube, and Search. Switch between sessions at the top of the sidebar.',
            detect: (s) => s.sessions.length > 1,
          },
          {
            id: 'switch',
            text: 'Click the session name at the top of the sidebar to switch between sessions',
            hint: 'Each session remembers which tabs were open, which was active, and your panel layout. Name your sessions by study topic — "Torah Portions", "Revelation Series", etc.',
            detect: (s) => s.sessions.length > 1 && s.currentSessionId !== s.sessions[0]?.id,
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // PERSONALIZE
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'personalize',
    label: 'Personalize',
    tasks: [
      {
        id: 'open-settings',
        icon: Settings2,
        title: 'Explore settings',
        subtitle: 'Customize fonts, themes, enabled texts, and vault sync.',
        shortcut: '⌘,',
        steps: [
          {
            id: 'settings',
            text: 'Press ⌘, to open the Settings panel',
            hint: 'Or click the gear icon at the bottom of the sidebar.',
            detect: (s) => s.settingsOpen,
          },
          {
            id: 'nav',
            text: 'Click through the sections — Display, Texts, Notes, and Shortcuts',
            hint: 'Under Texts you can enable Brenton LXX, 1 Enoch, Jubilees, and the Apocrypha. Under Notes you can connect your Octarine/Obsidian vault for automatic sync.',
            detect: (s) => s.settingsNavToken > 0,
          },
        ],
        actionLabel: 'Open settings',
        action: () => useAppStore.getState().openSettings(),
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // ADVANCED
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'advanced',
    label: 'Advanced',
    tasks: [
      {
        id: 'adv-strongs-search',
        icon: Search,
        title: 'Search by Strong\'s number',
        subtitle: 'Find every occurrence of a Hebrew or Greek root across all texts.',
        steps: [
          {
            id: 'open',
            text: 'Press ⌘T to open the quick-search bar',
            hint: 'The floating search bar accepts both references and Strong\'s numbers.',
            detect: (s) => s.searchOpen,
          },
          {
            id: 'query',
            text: 'Type a Strong\'s number directly — e.g. H7225 or G3056 — and press Enter',
            hint: 'A Lexicon tab opens with the full entry AND every occurrence listed. Click any occurrence to jump to that verse.',
            detect: (s) => s.history.some(h => h.type === 'lexicon'),
          },
        ],
        actionLabel: 'Open search bar',
        action: () => useAppStore.getState().openSearch('new'),
      },
      {
        id: 'adv-cross-ref',
        icon: Table2,
        title: 'Browse cross-references in the right panel',
        subtitle: 'See every note that mentions the current verse across your whole vault.',
        steps: [
          {
            id: 'bible',
            text: 'Open a Bible passage and open the right panel (click ▷ in the toolbar)',
            hint: 'Make sure you have a passage with at least one note attached.',
            detect: (s) => Object.values(s.tabs).flat().some(
              t => t.type === 'bible' && (t.state as BibleTabState | undefined)?.rightPanelOpen === true
            ),
          },
          {
            id: 'crossrefs',
            text: 'Click the "Cross-refs" tab in the right panel',
            hint: 'This tab scans all your notes for verse references matching the current chapter. Useful for building cross-reference chains across your study library.',
            detect: (s) => Object.values(s.tabs).flat().some(
              t => t.type === 'bible' &&
                (t.state as BibleTabState | undefined)?.rightPanelOpen === true &&
                (t.state as BibleTabState | undefined)?.rightPanelTab === 'crossrefs'
            ),
          },
        ],
      },
      {
        id: 'adv-verse-compare-notes',
        icon: LayoutTemplate,
        title: 'Compare a verse and take notes side-by-side',
        subtitle: 'Use the right panel inside a compare tab to annotate while comparing.',
        steps: [
          {
            id: 'compare',
            text: 'Enter compare mode for any verse (right-click verse → Compare, or click ⇌)',
            detect: (s) => Object.values(s.tabs).flat().some(
              t => t.type === 'bible' && (t.state as BibleTabState | undefined)?.compareMode === true
            ),
          },
          {
            id: 'note',
            text: 'Open the right panel (click ▷) and switch to the Notes tab',
            hint: 'You can read the verse in multiple translations on the left and type notes on the right simultaneously. This is the core study workflow Berean was built around.',
            detect: (s) => Object.values(s.tabs).flat().some(
              t => t.type === 'bible' &&
                (t.state as BibleTabState | undefined)?.compareMode === true &&
                (t.state as BibleTabState | undefined)?.rightPanelOpen === true &&
                (t.state as BibleTabState | undefined)?.rightPanelTab === 'notes'
            ),
          },
        ],
        actionLabel: 'Enter compare mode',
        action: () => window.dispatchEvent(new CustomEvent('berean:compareVerse')),
      },
      {
        id: 'adv-vault-sync',
        icon: FileText,
        title: 'Connect your Octarine / Obsidian vault',
        subtitle: 'Automatically sync all Berean notes to your Markdown vault folder.',
        steps: [
          {
            id: 'settings',
            text: 'Open Settings (⌘,) and go to the Notes section',
            hint: 'The Notes section has vault sync configuration at the top.',
            detect: (s) => s.settingsOpen,
          },
          {
            id: 'vault',
            text: 'Enable "Vault sync" and pick your vault folder',
            hint: 'Default path is your Octarine iCloud workspace. Berean writes each note as a .md file with YAML frontmatter compatible with Obsidian and Octarine. Two-way sync is automatic — edits made in either app appear in the other.',
            detect: (s) => s.vaultSyncToken > 0,
          },
        ],
        actionLabel: 'Open settings',
        action: () => {
          useAppStore.getState().openSettings()
        },
      },
      {
        id: 'adv-session-move-tab',
        icon: Layers,
        title: 'Move a tab between sessions',
        subtitle: 'Reorganize your study by dragging tabs into different sessions.',
        steps: [
          {
            id: 'sessions',
            text: 'Make sure you have at least 2 sessions (press ⌘⇧0 to create another)',
            hint: 'Sessions let you keep different study topics cleanly separated.',
            detect: (s) => s.sessions.length > 1,
          },
          {
            id: 'move',
            text: 'Right-click any tab in the sidebar → "Move to session" → pick a session',
            hint: 'The tab moves to the target session\'s equivalent space. Switch sessions to find it there. You can also drag tabs between sessions.',
            detect: (s) => {
              // At least 2 sessions and at least one non-default session has tabs
              if (s.sessions.length < 2) return false
              const nonDefault = s.sessions.filter(sess => sess.id !== s.sessions[0]?.id)
              return nonDefault.some(sess => Object.values(sess.tabs).flat().length > 0)
            },
          },
        ],
      },
    ],
  },
]

const ALL_TASKS = SECTIONS.flatMap(s => s.tasks)
const TOTAL     = ALL_TASKS.length

// ── Derived helpers ───────────────────────────────────────────────────────────

function detectableSteps(task: TaskDef) {
  return task.steps.filter(s => s.detect)
}

function isTaskDone(task: TaskDef, completedStepIds: string[]) {
  const det = detectableSteps(task)
  if (det.length === 0) return false
  return det.every(s => completedStepIds.includes(`${task.id}:${s.id}`))
}

function taskStepProgress(task: TaskDef, completedStepIds: string[]) {
  const det  = detectableSteps(task)
  const done = det.filter(s => completedStepIds.includes(`${task.id}:${s.id}`)).length
  return { done, total: det.length }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function TasksPanel() {
  const tasksVisible     = useAppStore((s) => s.tasksVisible)
  const tasksMinimized   = useAppStore((s) => s.tasksMinimized)
  const completedStepIds = useAppStore((s) => s.completedStepIds)
  const closeTasks       = useAppStore((s) => s.closeTasks)
  const minimizeTasks    = useAppStore((s) => s.minimizeTasks)
  const unminimizeTasks  = useAppStore((s) => s.unminimizeTasks)
  const completeStep     = useAppStore((s) => s.completeStep)

  const [expandedId, setExpandedId] = useState<string | null>(null)

  // When a BibleGateway import toast is showing (bottom-right, z-200), lift the
  // Getting Started panel above it so getting started stays visible on top.
  const bgImportActive = useAppStore((s) => s.bgImportPhase !== 'idle')
  const liftBottom = bgImportActive ? 168 : 20  // px; clears the BG progress toast

  // ── Auto-detect subscription ───────────────────────────────────────────────
  useEffect(() => {
    if (!tasksVisible) return
    const unsub = useAppStore.subscribe((state) => {
      for (const section of SECTIONS) {
        for (const task of section.tasks) {
          for (const step of task.steps) {
            if (!step.detect) continue
            const key = `${task.id}:${step.id}`
            if (!state.completedStepIds.includes(key) && step.detect(state)) {
              state.completeStep(task.id, step.id)
            }
          }
        }
      }
    })
    return unsub
  }, [tasksVisible])

  // Auto-expand the first incomplete task
  useEffect(() => {
    if (!tasksVisible || tasksMinimized || expandedId !== null) return
    const first = ALL_TASKS.find(t => !isTaskDone(t, completedStepIds))
    if (first) setExpandedId(first.id)
  }, [tasksVisible, tasksMinimized]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!tasksVisible) return null

  const doneCount = ALL_TASKS.filter(t => isTaskDone(t, completedStepIds)).length
  const allDone   = doneCount === TOTAL

  // ── Minimized chip ─────────────────────────────────────────────────────────
  if (tasksMinimized) {
    return createPortal(
      <div className="fixed right-5 z-[9999]" style={{ pointerEvents: 'auto', bottom: liftBottom, transition: 'bottom 0.2s ease' }}>
        <button
          onClick={unminimizeTasks}
          className="flex items-center gap-2 px-3 py-2 rounded-full bg-[rgb(var(--color-surface-2))] border border-[rgb(var(--color-surface-4))] shadow-lg hover:bg-[rgb(var(--color-surface-3))] transition-colors cursor-pointer"
        >
          {allDone
            ? <Sparkles size={13} className="text-[rgb(var(--color-accent))]" />
            : <CheckCircle2 size={13} className="text-[rgb(var(--color-accent))]" />
          }
          <span className="text-xs font-medium text-[rgb(var(--color-text-primary))]">
            {allDone ? 'Getting Started — all done!' : `Getting Started · ${doneCount}/${TOTAL}`}
          </span>
          <ChevronRight size={12} className="text-[rgb(var(--color-text-muted))] -rotate-90" />
        </button>
      </div>,
      document.body,
    )
  }

  // ── Expanded panel ─────────────────────────────────────────────────────────
  return createPortal(
    <div
      className="fixed right-5 z-[9999] w-[360px] flex flex-col rounded-xl bg-[rgb(var(--color-surface-2))] border border-[rgb(var(--color-surface-4))] shadow-2xl overflow-hidden"
      style={{ pointerEvents: 'auto', bottom: liftBottom, transition: 'bottom 0.2s ease' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[rgb(var(--color-surface-4))] flex-shrink-0">
        <div className="flex items-center gap-2">
          {allDone
            ? <Sparkles size={14} className="text-[rgb(var(--color-accent))]" />
            : <CheckCircle2 size={14} className="text-[rgb(var(--color-accent))]" />
          }
          <span className="text-sm font-semibold text-[rgb(var(--color-text-primary))]">Getting Started</span>
          <span className="text-xs text-[rgb(var(--color-text-muted))]">{doneCount}/{TOTAL}</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={minimizeTasks} title="Minimize"
            className="p-1 rounded hover:bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer">
            <ChevronDown size={13} />
          </button>
          <button onClick={closeTasks} title="Dismiss"
            className="p-1 rounded hover:bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer">
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Global progress bar */}
      <div className="h-0.5 bg-[rgb(var(--color-surface-4))] flex-shrink-0">
        <div className="h-full bg-[rgb(var(--color-accent))] transition-all duration-500"
          style={{ width: `${(doneCount / TOTAL) * 100}%` }} />
      </div>

      {/* All-done banner */}
      {allDone && (
        <div className="px-4 py-3 bg-[rgb(var(--color-accent))/8] border-b border-[rgb(var(--color-surface-4))] flex-shrink-0">
          <p className="text-xs text-[rgb(var(--color-accent))] font-medium">
            You've explored every feature — you know Berean well!
          </p>
          <p className="text-[10px] text-[rgb(var(--color-text-muted))] mt-0.5">
            Reset anytime via Settings → About → Replay walkthrough.
          </p>
        </div>
      )}

      {/* Scrollable body — stopPropagation on wheel prevents Radix Dialog from swallowing scroll events */}
      <div
        className="overflow-y-scroll"
        style={{ maxHeight: '480px', transform: 'translateZ(0)', contain: 'paint' }}
        onWheel={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {SECTIONS.map((section, sIdx) => {
          const sectionDone    = section.tasks.filter(t => isTaskDone(t, completedStepIds)).length
          const sectionTotal   = section.tasks.length
          const allSectionDone = sectionDone === sectionTotal

          return (
            <div key={section.id} className={sIdx > 0 ? 'border-t border-[rgb(var(--color-surface-4))]' : ''}>
              {/* Section header */}
              <div className="px-4 pt-3 pb-2">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] font-bold uppercase tracking-widest text-[rgb(var(--color-text-muted))]">
                      {section.label}
                    </span>
                    {allSectionDone && (
                      <CheckCircle2 size={10} className="text-[rgb(var(--color-accent))] opacity-80" />
                    )}
                  </div>
                  <span className="text-[9px] text-[rgb(var(--color-text-muted))]">{sectionDone}/{sectionTotal}</span>
                </div>
                <div className="h-0.5 rounded-full bg-[rgb(var(--color-surface-4))] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${(sectionDone / sectionTotal) * 100}%`,
                      background: allSectionDone ? 'rgb(var(--color-accent))' : 'rgba(var(--color-accent), 0.6)',
                    }}
                  />
                </div>
              </div>

              {/* Tasks */}
              <div className="px-2 pb-2 space-y-0.5">
                {section.tasks.map((task) => {
                  const done       = isTaskDone(task, completedStepIds)
                  const { done: stepsDone, total: stepsTotal } = taskStepProgress(task, completedStepIds)
                  const Icon       = task.icon
                  const isExpanded = expandedId === task.id

                  return (
                    <div key={task.id} className="rounded-lg overflow-hidden">
                      {/* Task row */}
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : task.id)}
                        className={`w-full flex items-start gap-2.5 px-3 py-2 text-left rounded-lg transition-colors ${
                          done
                            ? 'opacity-40 cursor-pointer'
                            : isExpanded
                            ? 'bg-[rgb(var(--color-surface-3))] cursor-pointer'
                            : 'hover:bg-[rgb(var(--color-surface-3))] cursor-pointer'
                        }`}
                      >
                        <div className={`mt-px flex-shrink-0 ${done || isExpanded ? 'text-[rgb(var(--color-accent))]' : 'text-[rgb(var(--color-text-muted))]'}`}>
                          {done ? <CheckCircle2 size={13} /> : <Icon size={13} />}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`text-xs font-medium leading-snug ${done ? 'line-through text-[rgb(var(--color-text-muted))]' : 'text-[rgb(var(--color-text-primary))]'}`}>
                              {task.title}
                            </span>
                            {task.shortcut && !done && (
                              <ShortcutKeys keys={task.shortcut} className="flex-shrink-0" />
                            )}
                          </div>
                          {!done && (
                            <div className="flex items-center gap-2 mt-0.5">
                              <p className="text-[10px] text-[rgb(var(--color-text-muted))] leading-relaxed flex-1">
                                {task.subtitle}
                              </p>
                              {stepsTotal > 0 && (
                                <span className={`flex-shrink-0 text-[9px] font-medium px-1.5 py-0.5 rounded-full ${
                                  stepsDone === stepsTotal
                                    ? 'bg-[rgb(var(--color-accent))/15] text-[rgb(var(--color-accent))]'
                                    : stepsDone > 0
                                    ? 'bg-[rgb(var(--color-accent))/10] text-[rgb(var(--color-accent))]'
                                    : 'bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))]'
                                }`}>
                                  {stepsDone}/{stepsTotal}
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        <ChevronRight size={11} className={`flex-shrink-0 mt-0.5 text-[rgb(var(--color-text-muted))] transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                      </button>

                      {/* Expanded checklist */}
                      {isExpanded && (
                        <div className="mx-1 mb-1 px-3 py-3 rounded-lg bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))]">
                          <ol className="space-y-3 mb-3">
                            {task.steps.map((step, i) => {
                              const key      = `${task.id}:${step.id}`
                              const stepDone = step.detect ? completedStepIds.includes(key) : false
                              const isDetectable = !!step.detect

                              const firstPending = task.steps.findIndex(
                                s => s.detect && !completedStepIds.includes(`${task.id}:${s.id}`)
                              )
                              const isNext = isDetectable && task.steps.indexOf(step) === firstPending && !done

                              return (
                                <li key={step.id} className="flex gap-2.5">
                                  <div className="flex-shrink-0 mt-0.5">
                                    {isDetectable ? (
                                      stepDone
                                        ? <CheckCircle2 size={13} className="text-[rgb(var(--color-accent))]" />
                                        : <Circle size={13} className={isNext ? 'text-[rgb(var(--color-accent))] opacity-70' : 'text-[rgb(var(--color-text-muted))] opacity-40'} />
                                    ) : (
                                      <span className="w-[13px] flex items-center justify-center mt-px">
                                        <span className="w-1 h-1 rounded-full bg-[rgb(var(--color-text-muted))] opacity-40 inline-block" />
                                      </span>
                                    )}
                                  </div>

                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-baseline gap-1.5">
                                      <span className="text-[9px] text-[rgb(var(--color-text-muted))] font-mono flex-shrink-0 opacity-60">{i + 1}.</span>
                                      <span className={`text-[11px] leading-snug ${
                                        stepDone
                                          ? 'line-through text-[rgb(var(--color-text-muted))]'
                                          : isNext
                                          ? 'text-[rgb(var(--color-text-primary))] font-medium'
                                          : 'text-[rgb(var(--color-text-secondary))]'
                                      }`}>
                                        {step.text}
                                      </span>
                                    </div>
                                    {step.hint && !stepDone && (
                                      <p className="text-[10px] text-[rgb(var(--color-text-muted))] mt-1 leading-relaxed pl-4">
                                        {step.hint}
                                      </p>
                                    )}
                                  </div>
                                </li>
                              )
                            })}
                          </ol>

                          {task.action && task.actionLabel && !done && (
                            <div className="flex items-center gap-2 pt-2 border-t border-[rgb(var(--color-surface-4))]">
                              <button
                                onClick={() => { task.action!(); setExpandedId(null) }}
                                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold bg-[rgb(var(--color-accent))] text-white hover:opacity-90 transition-opacity cursor-pointer"
                              >
                                {task.actionLabel}
                                <ArrowRight size={10} />
                              </button>
                              <p className="text-[9px] text-[rgb(var(--color-text-muted))] italic leading-snug flex-1">
                                Steps complete automatically as you do them.
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
        <div className="h-1" />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-2.5 border-t border-[rgb(var(--color-surface-4))] flex-shrink-0">
        <p className="text-[10px] text-[rgb(var(--color-text-muted))]">Replay via Settings → About</p>
        <button
          onClick={closeTasks}
          className="text-[10px] text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
        >
          Dismiss
        </button>
      </div>
    </div>,
    document.body,
  )
}
