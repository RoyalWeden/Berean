import { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { motion } from 'framer-motion'
import { BookOpen, FolderOpen, Folder, NotepadText, Keyboard, CheckCircle, ChevronRight, X, Layers, Download, List, FolderTree } from 'lucide-react'
import { useAppStore } from '@/store'
import BibleGatewayImporter from '@/components/settings/BibleGatewayImporter'
import ESwordImporter from '@/components/settings/ESwordImporter'
import ShortcutKeys from './ShortcutKeys'

// ── Step definitions ──────────────────────────────────────────────────────────

const STEPS = [
  { id: 'welcome',      label: 'Welcome',      icon: BookOpen   },
  { id: 'translation',  label: 'Texts',        icon: Layers     },
  { id: 'vault',        label: 'Vault',        icon: FolderOpen },
  { id: 'import',       label: 'Import',       icon: Download   },
  { id: 'notesView',    label: 'Notes view',   icon: List       },
  { id: 'shortcuts',    label: 'Shortcuts',    icon: Keyboard   },
  { id: 'done',         label: 'Done',         icon: CheckCircle },
] as const

type StepId = (typeof STEPS)[number]['id']

// ── Getting Started note suite created on completion ──────────────────────────

interface GettingStartedNote {
  title: string
  content: string
}

const GETTING_STARTED_FOLDER = 'Getting Started'

const GETTING_STARTED_NOTES: GettingStartedNote[] = [
  {
    title: 'Welcome',
    content: `# Welcome to Berean

Berean is a local-first desktop Bible study app for Yehovah's servants. All your Scripture, notes, lexicon, and study resources are stored on your device — no accounts, no cloud, no tracking.

This folder contains a complete guide to every feature in the app.

---

## Pages in This Guide

- [[Bible Reader]] — Navigate passages, switch translations, verse actions
- [[Notes & Editor]] — Verse notes, general notes, markdown editor
- [[Strong's & Lexicon]] — Inline numbers, hover tooltips, full lexicon entries
- [[Highlighting]] — Color-code words, phrases, and entire verses
- [[Search]] — Full-text search, reference lookup, word replacer
- [[YouTube]] — Embedded video study with Picture-in-Picture
- [[Keyboard Shortcuts]] — Complete shortcut reference
- [[Settings]] — Display, texts, notes, vault, and more
- [[Vault Sync]] — Sync notes to Obsidian, Logseq, or any Markdown app

---

## Quick Start

1. Press **⌘1** to open the Scripture space
2. Press **⌘T** and type a reference — \`Gen 1\`, \`Exodus 20\`, \`Rev 22:1-5\`
3. Press **⌘⇧N** to create a note
4. Press **⌘G** to toggle Strong's numbers
5. Press **⌘,** to open Settings

---

> You can replay the setup walkthrough anytime from **Settings → About**.
`,
  },
  {
    title: 'Bible Reader',
    content: `# Bible Reader

← Back to [[Welcome]]

The Bible panel is the heart of Berean. It supports multiple simultaneous panels, every translation in your library, and deep integration with notes and lexicon.

---

## Opening a Passage

Press **⌘T** to open the floating search bar, then type any reference:

| You type | Opens |
|---|---|
| \`Gen 1\` | Genesis chapter 1 |
| \`Exodus 20:1-17\` | Exodus 20, verses 1–17 highlighted |
| \`Rev 22\` | Revelation chapter 22 |
| \`Psalm 119\` | Psalm 119 |
| \`1 Enoch 1\` | 1 Enoch chapter 1 |

You can also use the **reference bar** at the top of any Bible panel — click it or press **⌘L**.

---

## Navigating

- \`⌘[\` / \`⌘]\` — Navigate back and forward through reading history
- **Previous / Next** arrows — Move one chapter at a time
- **Book dropdown** — Click the book name to jump to any book
- **Chapter dropdown** — Click the chapter number to jump within a book

---

## Switching Translations

Each Bible panel has its own translation selector. Click the translation abbreviation (e.g. **KJVA**) in the panel header to switch. Available texts:

| Label | Text |
|---|---|
| KJVA | King James Version with Apocrypha |
| LXX | Brenton Septuagint (English) |
| 1 Enoch | R.H. Charles translation |
| Jubilees | R.H. Charles translation |
| Apoc. Elijah | Apocalypse of Elijah |
| Recog. Clement | Recognitions of Clement |
| Hermas | Shepherd of Hermas |
| Asc. Isaiah | Ascension of Isaiah — R.H. Charles |
| Ep. Barnabas | Epistle of Barnabas — Samuel Sharpe |
| T12 Patriarchs | Testaments of the Twelve Patriarchs — R.H. Charles |
| Gad the Seer | Words of Gad the Seer — trans. Beir Bar-Ilan |
| T. Job | Testament of Job — trans. M.R. James |
| 1 Clement | First Epistle of Clement — J.B. Lightfoot |
| Apoc. Abraham | Apocalypse of Abraham — G.H. Box |

Enable or disable individual texts and reorder them in **Settings → Texts**.

---

## Verse Actions

Click any **verse number** to open the verse action popover:

- **Add verse note** — creates a note attached to this verse
- **Highlight verse** — applies a color to the entire verse
- **Copy verse text** — copies to clipboard
- **Compare this verse** — opens a compare tab with multiple translations

---

## Verse Display Options

Toggle these from the Bible panel toolbar:

- **Strong's numbers** (⌘G) — show inline Strong's tags after each word
- **Verse numbers** — show/hide verse number badges
- **Red letter text** — Yeshua's words highlighted in red (where tagged)

---

## Multiple Panels

Berean supports a resizable split-panel layout powered by react-mosaic:

- Drag the divider between panels to resize
- Open **two Bible panels** to compare chapters side by side
- Open a **notes panel** alongside Scripture for simultaneous reading and writing
- Panels can be rearranged from the layout menu in the toolbar

---

## Compare Mode

Right-click any verse → **Compare this verse**, or use the compare icon in the toolbar. Select 2–4 translations and a layout (columns, stacked, 2×2 grid). All cells navigate together — or unlock individual cells to scroll independently.

---

> See also: [[Strong's & Lexicon]], [[Highlighting]], [[Notes & Editor]]
`,
  },
  {
    title: 'Notes & Editor',
    content: `# Notes & Editor

← Back to [[Welcome]]

Berean has two note types, both using the same full-featured markdown editor.

---

## Verse Notes

A verse note is attached to a specific verse. It appears as a colored dot next to the verse number in the Bible reader.

**Creating a verse note:**
- Click the dot indicator next to a verse number → **+ New note for this verse**
- Right-click a verse → **Add verse note**
- Press **⌘⇧V** when a verse is focused

**Verse note indicators:**
- A colored colon appears to the right of the verse number
- Multiple notes stack as a count badge (e.g. :3)
- Click the dot to open the verse notes popover — see all notes for that verse

---

## General Notes

General notes are freeform documents not attached to a verse. They live in the Notes space (**⌘2**).

**Creating a general note:**
- Press **⌘⇧N**
- Click the **+** button in the Notes toolbar

**Daily notes:**
- Press the calendar icon in the Notes toolbar to open or create today's dated note
- Each day gets one note — clicking again opens the existing note, never creates a duplicate

---

## The Markdown Editor

Both note types use the same CodeMirror 6 editor with live markdown rendering (WYSIWYG-style).

### Formatting shortcuts

| Shortcut | Format |
|---|---|
| **⌘B** | **Bold** |
| **⌘I** | *Italic* |
| **⌘U** | Underline |
| **⌘⇧M** | Toggle raw markdown / rendered view |
| **Tab** / **⇧Tab** | Indent / outdent list item |

### Headings

Type \`# Heading 1\` through \`###### Heading 6\`. The active heading level is highlighted in the markdown toolbar.

- Click the **▸** arrow beside any heading to **collapse** all content under it
- A subtle horizontal rule separates headings from body text (toggle in Settings → Notes)

### Lists

- \`- item\` or \`* item\` — unordered list
- \`1. item\` — ordered list
- \`- [ ] task\` — task checkbox
- Each indent level (4 spaces or Tab) gets its own bullet symbol
- Choose your bullet style in **Settings → Notes → Bullet list style**

### Other markdown

- \`> blockquote\` — indented callout block
- \`> [!NOTE]\` — named callout (Note, Warning, Tip, Info, etc.)
- \`---\` — horizontal divider
- \`\`\`code\`\`\` — code block
- \`| col | col |\` — table
- \`==highlighted text==\` — text highlight (15 colors available)
- \`[[Gen 1:1]]\` — clickable verse link (navigates the active Bible panel)

---

## Note Colors

Each note has an assignable color shown as its indicator dot:

| Color | Suggested use |
|---|---|
| Blue | General study (default) |
| Red | Warning, rebuke, sin |
| Green | Torah connection |
| Yellow | General study / prophecy |
| Purple | Prophetic theme |

---

## Opening Notes

Notes can open in:
- **New tab** — full-width in the main panel area
- **Side panel** — alongside the Bible panel
- **Bottom panel** — below the Bible panel

Configure the default in **Settings → Notes → Default note opening**.

---

## Organizing Notes

In the Notes space (**⌘2**), switch between **List view** and **Folder view** using the folder icon in the toolbar.

- **List view** — all notes sorted by last modified
- **Folder view** — organize notes into user-created folders; drag notes to move them
- Create a folder with the **New Folder** button in the toolbar
- Right-click a note for rename, move, duplicate, or delete

---

> See also: [[Vault Sync]], [[Highlighting]]
`,
  },
  {
    title: "Strong's & Lexicon",
    content: `# Strong's & Lexicon

← Back to [[Welcome]]

Every word in the KJV and Brenton LXX has a Strong's number tag that links it to the original Hebrew or Greek. Berean gives you three ways to access this data.

---

## Enabling Inline Strong's Numbers

Press **⌘G** or click the **S** button in the Bible panel toolbar to toggle Strong's numbers. When enabled, each word is followed by a small chip:

\`\`\`
In{H0}  the{H0}  beginning{H7225}  Elohim{H430}  created{H1254}…
\`\`\`

Hebrew numbers start with **H**, Greek with **G**.

---

## Hover Tooltip

Hover over any Strong's chip to see a quick popup:

- **Original word** (Hebrew or Greek)
- **Transliteration** (phonetic rendering)
- **Short definition** (1–2 lines)

This lets you check words at a glance without leaving the reading flow.

Toggle in **Settings → Display → Show Strong's hover tooltips**.

---

## Full Lexicon Entry

Click any Strong's chip to open a full lexicon tab:

\`\`\`
H7225  בְּרֵאשִׁית  (bĕrêʼshîyth)
Strong's: "in the beginning, chief"
────────────────────────────────
BDB Definition:
[full entry text]
────────────────────────────────
Occurrences: 51 times
[list of references — all clickable]
\`\`\`

The occurrence list lets you jump to any verse where this word appears across the entire corpus.

Toggle click-to-open in **Settings → Display → Click Strong's opens lexicon tab**.

---

## Searching by Strong's Number

In the floating search bar (**⌘T**), type a Strong's number directly:

- \`H7225\` → opens the lexicon entry for H7225 (בְּרֵאשִׁית)
- \`G3056\` → opens the lexicon entry for G3056 (λόγος, *logos*)

---

## Display Settings

All three modes are independently toggleable in **Settings → Display**:

1. Show inline Strong's numbers
2. Show Strong's hover tooltips
3. Click Strong's opens lexicon tab

---

> See also: [[Bible Reader]], [[Search]]
`,
  },
  {
    title: 'Highlighting',
    content: `# Highlighting

← Back to [[Welcome]]

Highlights are persistent color annotations applied to any word, phrase, or full verse. They survive app restarts and sync to vault files.

---

## Applying a Highlight

1. Select any text inside a verse (click and drag, or double-click a word)
2. A color toolbar appears above the selection
3. Click a color to apply the highlight

Available colors:

| Color | Suggested use |
|---|---|
| 🟡 Yellow | General study |
| 🔴 Red | Warning, rebuke, sin |
| 🟢 Green | Torah connection |
| 🔵 Blue | Cross-reference |
| 🟣 Purple | Prophecy |

---

## Scope

Highlights can cover:
- A **single word** — double-click to select it
- A **phrase** — click and drag across multiple words
- An **entire verse** — triple-click or select all text in the verse row

Multiple overlapping highlights on the same verse are supported.

---

## Visual Indicators

- Highlighted words show a **colored background tint** in the verse text
- The entire verse row gains a **subtle background tint** in chapter view
- The verse number badge gains a **small color dot** when any highlight exists on that verse

---

## Creating a Note from a Highlight

After selecting text, the color toolbar also shows a **+ Note** button. Clicking it creates a verse note pre-filled with your selected text as a blockquote — useful for annotating specific phrases.

---

## Managing Highlights

Highlights are text-specific (KJV highlights don't show in LXX by default). Toggle **cross-text highlight sync** in **Settings → Display** to share highlights across translations.

To remove a highlight, select the highlighted text again → choose **Remove** in the color toolbar.

---

## Copy on Highlight

Enable **Settings → Display → Copy verse text on highlight** to automatically copy the verse text to your clipboard whenever you apply a highlight.

---

> See also: [[Bible Reader]], [[Notes & Editor]]
`,
  },
  {
    title: 'Search',
    content: `# Search

← Back to [[Welcome]]

Berean has a unified search system across all Scripture texts and your notes. Press **⌘5** to open the Search space, or **⌘⇧F** from anywhere.

---

## Search Types

| Query | What it does |
|---|---|
| \`Gen 1:1\` | Opens Genesis 1:1 directly |
| \`Exodus 20\` | Opens Exodus chapter 20 |
| \`Rev 22:1-5\` | Opens Revelation 22:1–5 |
| \`H7676\` | Opens Strong's entry for H7676 (sabbath) |
| \`G26\` | Opens Strong's entry for G26 (agape) |
| \`in the beginning\` | Full-text keyword search |
| \`sabbath holy rest\` | All verses containing any of these words |
| \`note:creation\` | Searches your note content |

---

## Keyword Search

Full-text search uses SQLite FTS5 for fast results across all enabled texts simultaneously.

- Results are grouped by book
- Each result shows: **reference + verse snippet** with the keyword highlighted
- Click any result to open that chapter with the verse in view

**Filters:**
- Limit by text: KJVA, LXX, Enoch, Jubilees
- Limit by testament: OT, NT, Apocrypha, Pseudepigrapha
- Limit by book range

---

## Word Replacer

The word replacer substitutes display names throughout the app — including search. If you search for **Yeshua**, Berean automatically also searches the underlying text for **Jesus**, so you always find the right results.

Configure replacements in **Settings → Word Replacer**.

---

## Search Results Tab

Search results open in a new tab labeled **Search: [query]**. From the results tab:

- Scroll through all matches
- Results are paginated for large result sets
- Click **Open all in Compare** (for small result sets) to see every matching verse side by side

---

## Floating Search Bar

Press **⌘T** or **⌘K** to open the floating search bar from anywhere in the app. It searches across:

- Bible references and chapters
- Strong's numbers
- Keywords (full-text)
- Note titles and content
- YouTube channel names

Results are grouped by category and shown with icons. Press Enter or click to open in a new tab.

---

> See also: [[Bible Reader]], [[Strong's & Lexicon]]
`,
  },
  {
    title: 'YouTube',
    content: `# YouTube

← Back to [[Welcome]]

Berean embeds a full YouTube browser inside the app — useful for watching Torah teachings, Hebrew studies, and Scripture lectures alongside your notes.

---

## Opening YouTube

Press **⌘4** or click the **YouTube** space in the sidebar. Each video or channel opens as its own named tab.

The embedded player runs in a full Chromium webview — you can log in to your YouTube account normally, access your subscriptions, playlists, and history.

---

## Picture-in-Picture (Auto PiP)

When a YouTube tab is playing and you switch to a different space or tab:
- The video automatically enters **Picture-in-Picture** mode
- The PiP window floats over the app

When you return to the YouTube tab: PiP dismisses, video returns to the tab.

**Manual toggle:** **⌘⇧P** — toggle PiP at any time.

Toggle auto-PiP in **Settings → YouTube → Auto Picture-in-Picture**.

---

## Timestamp Note Linking

While a video is playing, a **📎 Insert Timestamp** button appears in the YouTube tab toolbar.

Clicking it inserts a markdown link into your currently active note:

\`\`\`markdown
[Channel Name — Video Title — 12:34](https://youtu.be/VIDEO_ID?t=754)
\`\`\`

The timestamp captures the exact playback position at the moment you click.

**Keyboard shortcut:** **⌘⇧L** — insert timestamp from anywhere in the app (if a YouTube tab is active).

If no note is open when you click, Berean prompts you to open one first.

---

> See also: [[Notes & Editor]], [[Keyboard Shortcuts]]
`,
  },
  {
    title: 'Keyboard Shortcuts',
    content: `# Keyboard Shortcuts

← Back to [[Welcome]]

Berean is keyboard-driven. All major actions are reachable without touching the mouse.

---

## Navigation

| Shortcut | Action |
|---|---|
| **⌘1** | Scripture space |
| **⌘2** | Notes space |
| **⌘3** | Lexicon space |
| **⌘4** | YouTube space |
| **⌘5** | Search space |
| **⌘T** | Open floating search / new reference |
| **⌘K** | Floating command bar |
| **⌘W** | Close current tab |
| **⌘[** | Navigate back in tab history |
| **⌘]** | Navigate forward in tab history |
| **⌘L** | Focus Bible reference bar |
| **⌘H** | Open reading history modal |
| **Ctrl+Tab** | Switch tabs (most-recently-used order) |
| **⌘⇧S** | Toggle sidebar visibility |

---

## Bible Reader

| Shortcut | Action |
|---|---|
| **⌘G** | Toggle Strong's numbers inline |
| **⌘F** | Find in current panel |

---

## Notes

| Shortcut | Action |
|---|---|
| **⌘⇧N** | New general note |
| **⌘⇧V** | New verse note (for focused verse) |
| **⌘⇧M** | Toggle markdown notation (raw ↔ rendered) |
| **⌘B** | Bold |
| **⌘I** | Italic |
| **⌘U** | Underline |
| **Tab** | Indent list item |
| **⇧Tab** | Outdent list item |
| **⌘Z** | Undo |
| **⌘⇧Z** | Redo |

---

## YouTube

| Shortcut | Action |
|---|---|
| **⌘⇧L** | Insert YouTube timestamp into active note |
| **⌘⇧P** | Toggle Picture-in-Picture |

---

## Search

| Shortcut | Action |
|---|---|
| **⌘⇧F** | Full-text search across all texts |

---

## Global

| Shortcut | Action |
|---|---|
| **⌘,** | Open Settings |
| **Escape** | Close floating search / dismiss popovers |

---

> The full shortcut list is also in **Settings → Shortcuts**.
`,
  },
  {
    title: 'Settings',
    content: `# Settings

← Back to [[Welcome]]

Open Settings with **⌘,**. Use the compact/expanded toggle in the top bar to show or hide setting descriptions.

---

## Display

- **Default Bible text** — which translation opens in new Bible tabs
- **Font family and size** — for Bible text and notes editor separately
- **Line height** — comfortable / compact / spacious
- **Theme** — Light / Dark / System
- **Show inline Strong's numbers** — display H/G tags after each word
- **Show Strong's hover tooltips** — popup on Strong's chip hover
- **Click Strong's opens lexicon tab** — open full entry on click
- **Verse indicator position** — dot to the right of the verse number or in the left margin
- **Cross-text highlight sync** — share highlights across KJV and LXX

---

## Texts

- Enable or disable each available text
- Reorder texts (affects compare view order)
- Customize display names per text

---

## Notes

- **Default editor mode** — start new notes in edit mode or view mode
- **Heading divider lines** — subtle rule below each heading
- **Bullet list style** — choose from 5 bullet symbol sets with preview
- **Confirm before deleting notes** — safety prompt on delete
- **Spell check** — enable system spell check in the editor
- **Default note color**
- **Default note opening** — new tab, right panel, or bottom panel
- **Copy verse text on highlight** — auto-copy when you highlight

---

## Vault Sync

Configure sync of your notes to a local Markdown folder. See [[Vault Sync]] for full details.

---

## YouTube

- **Auto Picture-in-Picture** — toggle auto-PiP on tab switch
- **Timestamp link format** — customize the inserted link format

---

## Word Replacer

Define word substitutions applied across the entire app UI, search, and notes. Example: display "Yehovah" wherever the underlying texts say "LORD".

Replacements also expand search queries — searching "Yeshua" finds "Jesus" occurrences automatically.

---

## Shortcuts

Read-only list of all keyboard shortcuts. See [[Keyboard Shortcuts]] for the full table.

---

## Import

Import notes from BibleGateway or e-Sword. Also available during the onboarding walkthrough.

---

## Updates

Check for new app versions, enable auto-check on startup, and toggle the beta update channel to receive pre-release builds. The **download page** link opens the Berean website with release notes.

---

## About

- App version
- Replay the getting started walkthrough
- Recreate Getting Started notes
- Open source licenses

---

> See also: [[Vault Sync]], [[Keyboard Shortcuts]]
`,
  },
  {
    title: 'Vault Sync',
    content: `# Vault Sync

← Back to [[Welcome]]

Vault sync writes your Berean notes as plain Markdown files to any local folder on your machine. This makes them accessible in Obsidian, Logseq, iA Writer, Octarine, or any Markdown-compatible app.

---

## Setting Up

1. Open **Settings → Vault Sync**
2. Toggle **Enable vault sync** ON
3. Click **Choose folder** and select a directory (e.g. your Obsidian vault root or iCloud folder)
4. Berean writes all notes into a \`berean-notes/\` subfolder inside that directory

**Default path for Octarine users:**
\`\`\`
~/Library/Mobile Documents/com~apple~CloudDocs/Octarine/workspaces/bible
\`\`\`

---

## File Structure

\`\`\`
{vault-root}/
└── berean-notes/
    ├── verse-notes/
    │   ├── Gen_1_1_note1.md
    │   └── Exod_20_1_note1.md
    └── general-notes/
        ├── creation-study.md
        └── torah-observance-overview.md
\`\`\`

---

## File Format

Every note file uses YAML frontmatter compatible with Obsidian, Logseq, and Octarine:

\`\`\`markdown
---
type: verse-note
ref: Gen 1:1
created: 2025-01-15T10:30:00
updated: 2025-01-15T14:22:00
tags: [creation, beginnings]
color: blue
berean_id: abc123-uuid
---

# Gen 1:1 — My Note

In the beginning Yehovah created...

[[Exod 20:11]] — cross-reference to Sabbath
\`\`\`

The \`berean_id\` field is used to reconcile notes between Berean and your vault editor without relying on filenames.

---

## Two-Way Sync

- **Berean → vault:** notes saved in Berean are immediately written to disk
- **Vault → Berean:** Berean watches the vault folder for changes (via \`chokidar\`) and imports edits made in other apps
- **Conflict resolution:** last-write-wins by \`updated_at\` timestamp

---

## Wikilinks

Berean supports both verse reference wikilinks and note-to-note wikilinks:

- \`[[Gen 1:1]]\` — navigates the active Bible panel to Genesis 1:1
- \`[[My Note Title]]\` — links to another note by title
- \`[[Gen 1:1|custom label]]\` — wikilink with display text

These links render as clickable in Berean's note viewer and are preserved in vault files for Obsidian/Octarine compatibility.

---

## iCloud and Mobile Access

If your vault is in iCloud Drive, notes synced by Berean are automatically available on your iPhone in Octarine or any other iCloud-aware Markdown app — no additional setup required.

---

> See also: [[Notes & Editor]], [[Settings]]
`,
  },
]

// ── Helper: create Getting Started folder + notes ─────────────────────────────

export async function createGettingStartedNotes() {
  try {
    // Find or create the "Getting Started" folder
    const folders = await window.notes.getFolders()
    let folderId: string | null = null
    const existing = folders.find((f) => f.name === GETTING_STARTED_FOLDER)
    if (existing) {
      folderId = existing.id
    } else {
      const res = await window.notes.createFolder(GETTING_STARTED_FOLDER, null)
      if (res.success) folderId = res.id
    }

    // Get all existing note titles to avoid duplicates
    const existingNotes = await window.notes.getNotes(500, 0)
    const existingTitles = new Set(existingNotes.map((n) => n.title?.toLowerCase()))

    for (const noteSpec of GETTING_STARTED_NOTES) {
      if (existingTitles.has(noteSpec.title.toLowerCase())) continue
      const res = await window.notes.createNote({
        type: 'general',
        title: noteSpec.title,
        content: noteSpec.content,
        color: 'blue',
        tags: ['getting-started'],
      })
      if (res.success && res.note && folderId) {
        await window.notes.setNoteFolder(res.note.id, folderId)
      }
    }
  } catch {
    // non-fatal
  }
}

// ── Sub-components for each step ──────────────────────────────────────────────

function StepWelcome() {
  return (
    <div className="flex flex-col items-center text-center gap-6">
      <div className="w-16 h-16 rounded-shell-lg bg-[rgb(var(--color-accent))/15] flex items-center justify-center">
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
            className={`w-full text-left px-4 py-3 rounded-shell border transition-all cursor-pointer ${
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
    // Fixed safety-net export interval, not user-configurable — see
    // AUTO_EXPORT_INTERVAL_MINUTES in electron/ipc/vault.ts.
    await window.vault?.setAutoExport(enabled ? 5 : 0)
    if (enabled && vaultPath) window.vault?.watchVault().catch(() => {})
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl font-bold text-[rgb(var(--color-text-primary))] mb-1">Vault sync <span className="text-sm font-normal text-[rgb(var(--color-text-muted))]">— optional</span></h2>
        <p className="text-sm text-[rgb(var(--color-text-secondary))] leading-relaxed">
          Sync your notes as plain Markdown files to any local folder, automatically — works with Obsidian, Octarine, Logseq, iA Writer, or any Markdown app.
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
            <div className="flex-1 px-3 py-2 rounded-shell bg-[rgb(var(--color-surface-3))] border border-[rgb(var(--color-surface-4))] text-xs text-[rgb(var(--color-text-secondary))] truncate">
              {vaultPath || <span className="text-[rgb(var(--color-text-muted))]">No folder selected</span>}
            </div>
            <button
              onClick={pickFolder}
              disabled={picking}
              className="flex items-center gap-1.5 px-3 py-2 rounded-shell bg-[rgb(var(--color-surface-4))] text-xs text-[rgb(var(--color-text-primary))] hover:opacity-80 transition-opacity cursor-pointer disabled:opacity-50"
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
        <div className="px-4 py-3 rounded-shell bg-[rgb(var(--color-surface-3))] border border-[rgb(var(--color-surface-4))]">
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
            className="w-full text-left px-4 py-3 rounded-shell border border-[rgb(var(--color-surface-4))] hover:border-[rgb(var(--color-accent))/50] bg-[rgb(var(--color-surface-3))] hover:bg-[rgb(var(--color-surface-4))] transition-all cursor-pointer"
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
            className="w-full text-left px-4 py-3 rounded-shell border border-[rgb(var(--color-surface-4))] hover:border-[rgb(var(--color-accent))/50] bg-[rgb(var(--color-surface-3))] hover:bg-[rgb(var(--color-surface-4))] transition-all cursor-pointer"
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
            <span className="min-w-[72px] flex-shrink-0">
              <ShortcutKeys keys={key} />
            </span>
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
      <div className="w-16 h-16 rounded-shell-lg bg-[rgb(var(--color-accent))/15] flex items-center justify-center">
        <CheckCircle size={32} className="text-[rgb(var(--color-accent))]" />
      </div>
      <div>
        <h2 className="text-2xl font-bold text-[rgb(var(--color-text-primary))] mb-2">You're all set</h2>
        <p className="text-sm text-[rgb(var(--color-text-secondary))] leading-relaxed max-w-sm">
          A <strong>Getting Started</strong> folder has been added to your Notes space with 10 linked guide pages covering every feature in the app.
          You can replay this walkthrough anytime from <strong>Settings → About</strong>.
        </p>
      </div>
      <div className="px-4 py-3 rounded-shell bg-[rgb(var(--color-surface-3))] border border-[rgb(var(--color-surface-4))] text-left w-full max-w-sm">
        <p className="text-xs text-[rgb(var(--color-text-muted))] leading-relaxed">
          Press <ShortcutKeys keys="⌘1" /> to open Scripture,{' '}
          <ShortcutKeys keys="⌘T" /> to open a passage,{' '}
          and <ShortcutKeys keys="⌘," /> for settings.
        </p>
      </div>
    </div>
  )
}

// ── StepNotesView ──────────────────────────────────────────────────────────────

function StepNotesView({ choice, onChoose }: { choice: 'list' | 'folder'; onChoose: (v: 'list' | 'folder') => void }) {
  return (
    <div>
      <h2 className="text-xl font-bold text-[rgb(var(--color-text-primary))] mb-1">Notes view</h2>
      <p className="text-sm text-[rgb(var(--color-text-muted))] mb-5">
        How would you like your notes organised? You can always switch later using the folder-tree icon in the notes toolbar.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {/* List view option */}
        <button
          onClick={() => onChoose('list')}
          className={`rounded-shell border-2 p-3 text-left transition-all cursor-pointer ${
            choice === 'list'
              ? 'border-[rgb(var(--color-accent))] bg-[rgb(var(--color-accent))/8]'
              : 'border-[rgb(var(--color-surface-4))] hover:border-[rgb(var(--color-accent))/40]'
          }`}
        >
          <div className="flex items-center gap-2 mb-2">
            <List size={15} className={choice === 'list' ? 'text-[rgb(var(--color-accent))]' : 'text-[rgb(var(--color-text-muted))]'} />
            <span className={`text-sm font-semibold ${choice === 'list' ? 'text-[rgb(var(--color-accent))]' : 'text-[rgb(var(--color-text-primary))]'}`}>List view</span>
          </div>
          {/* Preview */}
          <div className="rounded-shell overflow-hidden border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-3))] text-[10px]">
            {['Genesis 1:1 note', 'Torah study', 'Daily — 2025-01-01', 'Creation notes'].map((t) => (
              <div key={t} className="flex items-center gap-1.5 px-2 py-1.5 border-b border-[rgb(var(--color-surface-4))] last:border-0">
                <div className="w-1.5 h-1.5 rounded-full bg-[rgb(var(--color-accent))/40] flex-shrink-0" />
                <span className="truncate text-[rgb(var(--color-text-secondary))]">{t}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-[rgb(var(--color-text-muted))] mt-2 leading-snug">Simple flat list sorted by last modified. Quick to scan.</p>
        </button>

        {/* Folder view option */}
        <button
          onClick={() => onChoose('folder')}
          className={`rounded-shell border-2 p-3 text-left transition-all cursor-pointer ${
            choice === 'folder'
              ? 'border-[rgb(var(--color-accent))] bg-[rgb(var(--color-accent))/8]'
              : 'border-[rgb(var(--color-surface-4))] hover:border-[rgb(var(--color-accent))/40]'
          }`}
        >
          <div className="flex items-center gap-2 mb-2">
            <FolderTree size={15} className={choice === 'folder' ? 'text-[rgb(var(--color-accent))]' : 'text-[rgb(var(--color-text-muted))]'} />
            <span className={`text-sm font-semibold ${choice === 'folder' ? 'text-[rgb(var(--color-accent))]' : 'text-[rgb(var(--color-text-primary))]'}`}>Folder view</span>
          </div>
          {/* Preview */}
          <div className="rounded-shell overflow-hidden border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-3))] text-[10px]">
            {[
              { open: false, label: 'Daily Notes',             indent: 0, muted: true,  isFile: false },
              { open: false, label: 'Verse Notes',             indent: 0, muted: true,  isFile: false },
              { open: true,  label: 'Covenants of promise',    indent: 0, muted: false, isFile: false },
              { open: false, label: 'Holy covenant notes',     indent: 1, muted: false, isFile: true  },
              { open: false, label: 'Rainbow covenant notes',  indent: 1, muted: false, isFile: true  },
            ].map((row) => (
              <div key={row.label} className="flex items-center gap-1.5 py-1 border-b border-[rgb(var(--color-surface-4))] last:border-0"
                style={{ paddingLeft: 8 + row.indent * 12 }}>
                {row.isFile
                  ? <NotepadText size={9} className="flex-shrink-0 text-[rgb(var(--color-text-muted))]" />
                  : row.open
                    ? <FolderOpen size={9} className="flex-shrink-0 text-[rgb(var(--color-accent))]" />
                    : <Folder size={9} className="flex-shrink-0 text-[rgb(var(--color-text-muted))]" />
                }
                <span className={`truncate ${row.muted ? 'text-[rgb(var(--color-text-muted))]' : 'text-[rgb(var(--color-text-secondary))]'}`}>{row.label}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-[rgb(var(--color-text-muted))] mt-2 leading-snug">Organised into folders. Drag notes to move them.</p>
        </button>
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
  const [notesViewChoice, setNotesViewChoice] = useState<'list' | 'folder'>('list')

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
      // Persist notes view choice before creating the welcome note
      try {
        await window.settings.set('notesFolderView', notesViewChoice === 'folder')
      } catch { /* ignore */ }
      await createGettingStartedNotes()
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
    <Dialog.Root open={onboardingOpen} onOpenChange={(open) => !open && handleSkip()}>
      <Dialog.Portal>
        <Dialog.Overlay asChild>
          <motion.div
            className="fixed inset-0 z-[260] bg-black/60"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          />
        </Dialog.Overlay>
        <Dialog.Content asChild aria-describedby={undefined}>
          <motion.div
            className="glass-panel fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[260] w-full max-w-lg mx-4 rounded-shell-lg overflow-hidden flex flex-col"
            style={{ maxHeight: '90vh' }}
            initial={{ opacity: 0, scale: 0.96, x: '-50%', y: 'calc(-50% + 8px)' }}
            animate={{ opacity: 1, scale: 1, x: '-50%', y: '-50%' }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
          >
        <Dialog.Title className="sr-only">Berean setup</Dialog.Title>

        {/* Close / Skip button (top right) */}
        <button
          onClick={handleSkip}
          title="Skip onboarding"
          className="absolute top-4 right-4 p-1.5 rounded-shell text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer z-10"
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
        <div className="flex-1 overflow-y-auto px-6 py-6" style={{ transform: 'translateZ(0)', contain: 'paint' }}>
          {currentStep.id === 'welcome'     && <StepWelcome />}
          {currentStep.id === 'translation' && <StepTranslation />}
          {currentStep.id === 'vault'       && <StepVault />}
          {currentStep.id === 'import'      && <StepImport />}
          {currentStep.id === 'notesView'   && <StepNotesView choice={notesViewChoice} onChoose={setNotesViewChoice} />}
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
            className="flex items-center gap-2 px-5 py-2 rounded-shell bg-[rgb(var(--color-accent))] text-white text-sm font-medium hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-60"
          >
            {completing ? 'Setting up…' : isLast ? 'Start studying' : 'Next'}
            {!completing && !isLast && <ChevronRight size={15} />}
          </button>
        </div>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
