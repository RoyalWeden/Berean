# Berean — Claude Code Project Brief

> This file is the single source of truth for the Berean desktop Bible study application.
> Claude Code should read this file at the start of every session and before making any
> architectural decisions. Do not deviate from the specs here without explicit user instruction.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Project Path & Repository](#2-project-path--repository)
3. [Technology Stack](#3-technology-stack)
4. [Folder Structure](#4-folder-structure)
5. [UI Shell & Navigation](#5-ui-shell--navigation)
6. [Bible Reader](#6-bible-reader)
7. [Texts & Scripture Sources](#7-texts--scripture-sources)
8. [Strong's & Lexicon System](#8-strongs--lexicon-system)
9. [Notes System](#9-notes-system)
10. [Highlighting System](#10-highlighting-system)
11. [Verse Compare Feature](#11-verse-compare-feature)
12. [YouTube Integration](#12-youtube-integration)
13. [Search System](#13-search-system)
14. [Keyboard Shortcuts](#14-keyboard-shortcuts)
15. [Settings & Preferences](#15-settings--preferences)
16. [Onboarding & Hints](#16-onboarding--hints)
17. [Data Storage](#17-data-storage)
18. [Obsidian / Octarine Vault Sync](#18-obsidian--octarine-vault-sync)
19. [Distribution & Packaging](#19-distribution--packaging)
20. [Deferred / Future Features](#20-deferred--future-features)
21. [Theology & Naming Conventions](#21-theology--naming-conventions)
22. [Build & Dev Commands](#22-build--dev-commands)

---

## 1. Project Overview

**Berean** is a macOS-first desktop Bible study application built for Torah-observant believers.
It combines the multi-panel layout of e-Sword, the tab/sidebar UX of Arc Browser, and deep
integration with a local Obsidian/Octarine markdown vault for note-taking.

**Core goals:**
- Fast, offline-first access to KJV, Brenton LXX, Enoch, Jubilees, and Apocrypha
- Verse-level and general notes in a unified markdown editor, synced to a local vault
- Strong's numbers inline with hover tooltips and on-demand lexicon tabs
- YouTube video study with auto Picture-in-Picture and timestamp note linking
- Easy distribution to non-technical users (no CLI setup required)

**Primary user:** Michael (developer/owner) + a small circle of Torah-observant family/ministry friends.

---

## 2. Project Path & Repository

```
Root path:        /Users/roywe/Berean
Main branch:      main
Package manager:  npm
```

All development work happens inside `/Users/roywe/Berean`.
**Never work directly on `main`.** Always use a Git worktree for feature work:

```bash
git worktree add ../Berean-feature-name -b feature/feature-name
```

---

## 3. Technology Stack

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Electron (latest stable) | Chromium-based, supports YouTube webview and file system |
| Frontend framework | React 18 + TypeScript | |
| Build tool | Vite | Fast HMR in dev |
| Styling | Tailwind CSS | Arc-inspired dark/light theme |
| Panel layout | react-mosaic | Resizable, draggable panels |
| Notes editor | ProseMirror | Markdown with toggle rendering |
| Database | better-sqlite3 | Bible texts, notes index, highlights, settings |
| Packaging | electron-builder | `.dmg` for Mac, `.exe` for Windows later |
| Icons | Lucide React | Consistent icon set |

---

## 4. Folder Structure

```
/Users/roywe/Berean/
├── CLAUDE.md                    ← This file (always read first)
├── package.json
├── vite.config.ts
├── electron/
│   ├── main.ts                  ← Electron main process
│   ├── preload.ts               ← Context bridge (IPC)
│   └── ipc/
│       ├── notes.ts             ← IPC handlers for notes
│       ├── bible.ts             ← IPC handlers for Bible queries
│       ├── vault.ts             ← IPC handlers for vault file sync
│       └── settings.ts          ← IPC handlers for settings
├── src/
│   ├── main.tsx                 ← React entry point
│   ├── App.tsx                  ← Root layout: sidebar + panel area
│   ├── components/
│   │   ├── shell/
│   │   │   ├── Sidebar.tsx      ← Arc-style left sidebar
│   │   │   ├── TabBar.tsx       ← Tabs within a space
│   │   │   ├── FloatingSearch.tsx ← Cmd+K / Cmd+T floating search
│   │   │   └── PanelLayout.tsx  ← react-mosaic wrapper
│   │   ├── bible/
│   │   │   ├── BiblePanel.tsx   ← Main reading panel
│   │   │   ├── ChapterView.tsx  ← Renders a chapter with verses
│   │   │   ├── VerseRow.tsx     ← Single verse with inline Strong's
│   │   │   ├── StrongsInline.tsx ← Inline Strong's number chip
│   │   │   ├── StrongsTooltip.tsx ← Hover tooltip for Strong's
│   │   │   ├── VerseIndicator.tsx ← Dot/badge on verse number
│   │   │   └── CompareView.tsx  ← Multi-version compare layout
│   │   ├── notes/
│   │   │   ├── NotesPanel.tsx   ← Notes panel wrapper
│   │   │   ├── NoteEditorPM.tsx ← ProseMirror markdown editor
│   │   │   ├── NotesList.tsx    ← List of general notes
│   │   │   ├── VerseNotesList.tsx ← All notes for a verse (popover)
│   │   │   └── NoteTab.tsx      ← Note opened as a full tab
│   │   ├── lexicon/
│   │   │   ├── LexiconTab.tsx   ← Full lexicon entry view
│   │   │   └── LexiconPanel.tsx ← Lexicon as a panel
│   │   ├── youtube/
│   │   │   ├── YouTubeTab.tsx   ← Embedded YouTube webview
│   │   │   └── PiPController.tsx ← Auto PiP logic
│   │   ├── search/
│   │   │   ├── SearchTab.tsx    ← Search results view
│   │   │   └── SearchBar.tsx    ← Reference + keyword search input
│   │   └── settings/
│   │       ├── SettingsModal.tsx
│   │       └── sections/        ← One file per settings section
├── data/
│   ├── kjv.db                   ← KJV SQLite database
│   ├── lxx_brenton.db           ← Brenton LXX SQLite database
│   ├── strongs_hebrew.db        ← Hebrew Strong's lexicon
│   ├── strongs_greek.db         ← Greek Strong's lexicon
│   ├── apocrypha.db             ← Deuterocanonical books
│   ├── enoch.db                 ← 1 Enoch
│   └── jubilees.db              ← Jubilees
├── assets/
│   ├── icon.icns                ← Mac app icon
│   └── fonts/                   ← Any custom fonts
└── dist/                        ← Built app output (gitignored)
```

---

## 5. UI Shell & Navigation

### Overall Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  [Sidebar]   │  [Panel Area — react-mosaic]                      │
│              │                                                   │
│  Spaces:     │  ┌─────────────────┬───────────────────┐         │
│  • Scripture │  │  Bible Panel    │   Notes Panel     │         │
│  • Notes     │  │                 │                   │         │
│  • Lexicon   │  │  (resizable)    │   (resizable)     │         │
│  • YouTube   │  │                 │                   │         │
│  • Search    │  └─────────────────┴───────────────────┘         │
│              │                                                   │
│  [Tabs list] │                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### Sidebar (Arc-style)

- Collapsible (toggle with `Cmd+Shift+S` or clicking the rail)
- Contains **Spaces** (Scripture, Notes, Lexicon, YouTube, Search)
- Each Space has its own list of open **Tabs** beneath it
- Tabs are listed vertically inside their space (Arc-style, not horizontal browser tabs)
- Clicking a tab in the sidebar brings it to focus in the main panel area
- Drag tabs between spaces to reorganize
- Right-click a tab for: Close, Duplicate, Move to Panel, Open in New Window

### Floating Search Bar (Arc-style)

- Triggered by `Cmd+T` or `Cmd+K`
- Appears as a centered floating modal overlay
- Searches across:
  - Bible references (e.g. `Gen 1:1`, `Exodus 20`, `Rev 22:1-5`)
  - Strong's numbers (e.g. `H7225`, `G3056`)
  - Keywords (full-text search across all enabled texts)
  - Note titles and note content
  - YouTube channel names (opens that channel's tab)
- Results grouped by category, shown with icons
- Pressing Enter or clicking a result opens it in a new tab or focuses existing tab

### Panel Area

- Powered by `react-mosaic` — panels are resizable by dragging dividers
- Each panel slot can hold: a Bible chapter, a note, lexicon, YouTube, search results
- Default layout: **Bible left / Notes right**
- Layouts can be saved as named **Workspaces** (e.g. "Compare Mode", "Study Mode", "Reading Mode")
- Available layout presets:
  - Bible left / Notes right (default)
  - Two Bible panels side by side
  - Three Bible columns
  - Four-square compare
  - Bible top / Notes bottom
  - Single panel (full width)
- Panel layout is persisted per Workspace in settings

---

## 6. Bible Reader

### Chapter Navigation

- Reference bar at the top of each Bible panel: type `Genesis 1` or `Gen 1` or `Ge 1`
- Previous/next chapter arrows
- Book and chapter dropdown pickers
- Verse numbers are clickable — clicking opens a verse action popover:
  - Add verse note
  - Highlight verse / selection
  - Copy verse text
  - Compare this verse
  - Open in new tab

### Verse Display

Each verse renders as:

```
[verse number badge]  [verse text with optional Strong's numbers inline]  [note indicator dot(s)]
```

- Verse number is a clickable badge
- Strong's numbers appear inline after each word (toggleable)
- Note indicator dots appear to the right of the verse (or in the margin)
- Multiple note dots stack as a count badge (e.g. `●3`)

### Text Rendering

- Default font: system serif (can be changed in settings)
- Line height: generous for readability
- Verse text wraps naturally
- Highlighted text shows colored background tint (see Highlighting System)
- Strong's number chips styled subtly (smaller, muted color, not distracting)

---

## 7. Texts & Scripture Sources

### Launch Texts

| Text | Language | Strong's | Notes |
|---|---|---|---|
| KJV | English | Hebrew + Greek Strong's | Primary text |
| Brenton LXX | English (from Greek) | Greek Strong's | Septuagint |
| Apocrypha (KJV/Brenton) | English | Optional | Deuterocanonical |
| 1 Enoch | English | None initially | |
| Jubilees | English | None initially | |

### Later Texts (deferred)

- Testament of the Twelve Patriarchs
- Additional pseudepigrapha (2 Baruch, 4 Ezra, etc.)
- Hebrew interlinear (Leningrad Codex / MT)
- Greek interlinear (GNT)

### Data Format

- All texts stored as SQLite databases in `/data/`
- Schema per text DB:

```sql
CREATE TABLE verses (
  id          INTEGER PRIMARY KEY,
  book        TEXT NOT NULL,       -- e.g. "Genesis"
  book_abbr   TEXT NOT NULL,       -- e.g. "Gen"
  book_num    INTEGER NOT NULL,    -- e.g. 1
  chapter     INTEGER NOT NULL,
  verse       INTEGER NOT NULL,
  text        TEXT NOT NULL,       -- plain verse text
  text_tagged TEXT                 -- verse text with Strong's tags embedded
);

CREATE TABLE books (
  book_num    INTEGER PRIMARY KEY,
  book_name   TEXT NOT NULL,
  book_abbr   TEXT NOT NULL,
  testament   TEXT,                -- "OT", "NT", "Apocrypha", "Pseudepigrapha"
  chapter_count INTEGER NOT NULL
);
```

- Strong's tags embedded in `text_tagged` as: `word{H7225}` or `word{G3056}`
- At render time, parse `text_tagged` to display word + Strong's chip

### Text Sourcing Notes

- KJV with Strong's tagging: available from public domain sources (eBible.org, OpenScriptures)
- Brenton LXX: public domain, available as XML/JSON
- Apocrypha: KJV Apocrypha is public domain
- 1 Enoch, Jubilees: R.H. Charles translations are public domain
- All texts must be converted to the SQLite schema above during setup

---

## 8. Strong's & Lexicon System

### Three Display Modes (each independently toggleable in Settings)

1. **Inline numbers** — Strong's numbers shown after each word in verse text
   - Toggle: Settings → Display → Show inline Strong's numbers
   - Also toggleable via toolbar button in the Bible panel header

2. **Hover tooltip** — hovering a Strong's number/chip shows a quick gloss popup
   - Shows: original word, transliteration, short definition (1–2 lines)
   - Toggle: Settings → Display → Show Strong's hover tooltips

3. **On-demand tab** — clicking a Strong's number opens a full lexicon entry in a new tab
   - Tab type: Lexicon
   - Shows: full BDB (Hebrew) or BDAG-style (Greek) entry where data is available
   - Falls back to Strong's definition if extended lexicon data is unavailable
   - Toggle: Settings → Display → Click Strong's opens lexicon tab

### Lexicon Tab Content

```
┌─────────────────────────────────────────────────────┐
│  H7225  בְּרֵאשִׁית  (bĕrêʼshîyth)                    │
│  Strong's: "in the beginning, chief"                │
│  ─────────────────────────────────────────────────  │
│  BDB Definition:                                    │
│  [full entry text]                                  │
│  ─────────────────────────────────────────────────  │
│  Occurrences: 51 times                              │
│  [list of references — clickable]                   │
└─────────────────────────────────────────────────────┘
```

### Lexicon Data Storage

```sql
-- strongs_hebrew.db
CREATE TABLE entries (
  strongs_id    TEXT PRIMARY KEY,   -- e.g. "H7225"
  word          TEXT,               -- Hebrew/Greek original
  transliteration TEXT,
  short_def     TEXT,               -- 1-line definition
  full_def      TEXT,               -- Full BDB/BDAG entry
  occurrences   INTEGER
);

CREATE TABLE occurrences (
  strongs_id    TEXT,
  book_num      INTEGER,
  chapter       INTEGER,
  verse         INTEGER
);
```

---

## 9. Notes System

### Two Note Types — One Editor

All notes use the same ProseMirror markdown editor. The distinction is in metadata and attachment.

#### Verse Notes
- Attached to a specific verse reference (book + chapter + verse)
- Frontmatter auto-populated on creation:
  ```markdown
  ---
  type: verse-note
  ref: Gen 1:1
  created: 2025-01-15
  tags: []
  color: blue
  ---
  ```
- Multiple verse notes per verse are supported
- Each verse note gets its own file if vault sync is enabled (see §18)
- Displayed as colored dot/badge indicator on the verse number in the Bible reader

#### General Notes
- Freeform documents not anchored to a verse
- Frontmatter:
  ```markdown
  ---
  type: general-note
  title: "My Note Title"
  created: 2025-01-15
  tags: []
  ---
  ```
- Live in the Notes sidebar space
- Can embed verse references that auto-link to the Bible panel

### Note Editor Features

- **ProseMirror** with markdown syntax highlighting
- **Toggle markdown notation** (`Cmd+Shift+M` or toolbar button):
  - **OFF (rendered mode):** `# Heading` shows as a heading, `**bold**` shows as bold — Typora-style
  - **ON (raw mode):** all markdown syntax visible for editing
- Auto-complete for verse references (type `Gen ` and get book/chapter/verse suggestions)
- Verse references auto-link: clicking `Gen 1:1` in a note navigates the active Bible panel to that verse
- YouTube timestamp insertion button (when a YouTube tab is active): inserts `[Video Title — 12:34](url)`
- Standard markdown supported: headings, bold, italic, lists, blockquotes, code blocks, tables, horizontal rules
- Images: paste from clipboard, drag-and-drop a file, or the toolbar/`/image` slash command (native file picker); drag-resizable via a handle on the selected image. Stored inline as base64 while vault sync is off; extracted to real files under `{vault}/attachments/` (Obsidian's own convention) on vault export

### Opening Notes

Notes can be opened in any of these ways:
- **New tab:** opens as a full-width tab in the main area
- **Right panel:** opens in the panel slot to the right of the Bible panel
- **Bottom panel:** opens in a panel below the Bible panel
- **Floating window:** detached from the main window (future)

### Verse Note Indicators

- Small colored dot rendered to the right of the verse number (or in left margin — settable)
- Color is user-assignable per note (default: blue)
- If multiple notes exist for a verse: stacked dots or a count badge (e.g. `●3`)
- Clicking the indicator opens a **Verse Notes Popover**:
  ```
  ┌──────────────────────────────────────────────┐
  │  Notes for Gen 1:1                           │
  │  ──────────────────────────────────────────  │
  │  ● [blue]  "Creation beginning note"   [→]  │
  │  ● [red]   "Rebuke context"            [→]  │
  │  ● [green] "LXX comparison note"       [→]  │
  │  ──────────────────────────────────────────  │
  │  [+ New note for Gen 1:1]                    │
  └──────────────────────────────────────────────┘
  ```
- `[→]` button opens that note in a new tab or panel (user's default setting)
- Note colors suggested use cases (not enforced — user decides):
  - Blue: general study
  - Red: sin/rebuke/warning
  - Green: Torah connection
  - Yellow: prophecy
  - Purple: cross-reference

### Note File Naming (vault sync)

When vault sync is enabled:
- Verse notes: `Gen_1_1_note1.md`, `Gen_1_1_note2.md` (or a single `Gen_1_1.md` with H2 sections — settable)
- General notes: `{slugified-title}.md`
- All notes stored in a `berean-notes/` subfolder inside the vault root (configurable)

---

## 10. Highlighting System

### How It Works

- Select any word(s) or phrase in a verse → a **highlight toolbar** appears:
  ```
  [ 🟡 Yellow ] [ 🔴 Red ] [ 🟢 Green ] [ 🔵 Blue ] [ 🟣 Purple ] [ Remove ] [ + Note ]
  ```
- Choosing a color applies a background highlight tint to that selection
- Highlights are persistent (stored in app DB, survive restarts)
- `+ Note` button creates a verse note pre-filled with the highlighted text as a blockquote

### Highlight Scope

- Highlights can be applied to:
  - A single word
  - A phrase within a verse
  - An entire verse (select all text in the verse row)
- Multiple overlapping highlights on the same verse are supported
- Each highlight can optionally have a label/tag (stored in DB)

### Highlight Storage

```sql
CREATE TABLE highlights (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  text_id     TEXT NOT NULL,       -- which Bible text (e.g. "kjv")
  book_num    INTEGER NOT NULL,
  chapter     INTEGER NOT NULL,
  verse       INTEGER NOT NULL,
  start_word  INTEGER,             -- word index within verse
  end_word    INTEGER,             -- word index within verse
  color       TEXT NOT NULL,       -- "yellow", "red", "green", "blue", "purple"
  label       TEXT,
  created_at  TEXT NOT NULL
);
```

### Visual Treatment

- Highlighted verses also show a faint full-row background tint in chapter view (subtle, not distracting)
- Verse number badge gains a small color indicator dot if any highlights exist on that verse
- Highlights are text-specific (KJV highlights don't appear in LXX view, and vice versa — settable)

---

## 11. Verse Compare Feature

### Opening a Compare View

- Right-click any verse → "Compare this verse"
- Or click the compare icon in the Bible panel toolbar
- Or open a dedicated Compare tab via floating search

### Compare Layouts

Select 2–4 texts and a layout:

| Layout | Description |
|---|---|
| Two columns | Two texts side by side |
| Three columns | Three texts |
| Four-square | 2×2 grid |
| Stacked | Texts stacked vertically |

### Compare Panel Content

Each cell shows:
- Text name header (e.g. "KJV", "Brenton LXX")
- The verse text for that reference
- Optional: Strong's inline (independent toggle per cell)

### Navigating in Compare Mode

- Reference bar at the top navigates all cells simultaneously
- Previous/next verse arrows advance all cells together
- Individual cells can be "unlocked" to navigate independently

---

## 12. YouTube Integration

### Embedding

- YouTube loads inside an **Electron `<webview>`** tag (not an iframe)
- Full Chromium rendering — supports YouTube login, playlists, channel browsing
- Lives in its own sidebar Space: **YouTube**
- Each video or channel opens as a named tab in the YouTube space

### Allowed Channels

- User maintains an **allowlist** of YouTube channels in Settings → YouTube → Allowed Channels
- Only channels on the allowlist can be opened as tabs
- Attempting to navigate to an unlisted channel shows a prompt: "Add [Channel Name] to your allowlist?"
- This is a soft guard (for focus), not a security restriction

### Picture-in-Picture (Auto PiP)

- When a YouTube tab is playing and the user switches to a different space/tab:
  - The video automatically enters **Picture-in-Picture** mode
  - PiP window floats over the app (native macOS PiP via Electron's `webContents`)
- When the user returns to the YouTube tab: PiP dismisses, video returns to the tab
- PiP can be manually triggered/dismissed with `Cmd+Shift+P`

### Timestamp Note Linking

- While a YouTube video is playing, a **"📎 Insert Timestamp"** button is visible in the YouTube tab toolbar
- Clicking it inserts a markdown link into the currently active note:
  ```markdown
  [Channel Name — Video Title — 12:34](https://youtu.be/VIDEO_ID?t=754)
  ```
- The timestamp is the current playback position at the moment of clicking
- If no note is open, it prompts: "Open a note to insert the timestamp"

### YouTube Account Login

- User logs into YouTube inside the embedded webview (no special handling needed — Chromium session)
- Session is persisted across app restarts via Electron session storage
- No OAuth or API keys required

---

## 13. Search System

### Search Types

| Type | Example Query | Result |
|---|---|---|
| Exact reference | `Gen 1:1` | Opens that verse |
| Chapter | `Exodus 20` | Opens that chapter |
| Range | `Rev 22:1-5` | Opens that range highlighted |
| Strong's number | `H7225` or `G3056` | Opens lexicon entry |
| Keyword | `in the beginning` | Full-text search results |
| Note search | `note:creation` | Searches note content |

### Keyword Search

- Full-text search across all enabled texts (SQLite FTS5)
- Results grouped by book
- Each result shows: reference + verse snippet with keyword highlighted
- Clicking a result opens that chapter with the verse in view
- Filter by: text (KJV, LXX, etc.), testament (OT, NT, Apocrypha), book range

### Search Results Tab

- Opens in a new tab labeled "Search: [query]"
- Results list with reference + snippet
- Paginated if many results
- "Open all in Compare" button (for small result sets)

---

## 14. Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+T` | New tab (opens floating search) |
| `Cmd+K` | Floating command/search bar |
| `Cmd+W` | Close current tab |
| `Cmd+Shift+M` | Toggle markdown notation in notes editor |
| `Cmd+[` | Navigate back in tab history |
| `Cmd+]` | Navigate forward in tab history |
| `Cmd+1` through `Cmd+5` | Jump to sidebar Space by number |
| `Cmd+L` | Focus Bible reference bar |
| `Cmd+F` | Search within current panel |
| `Cmd+Shift+N` | New general note |
| `Cmd+Shift+D` | Open today's daily note (creates it if it doesn't exist yet) |
| `Cmd+Shift+V` | New verse note (for currently focused verse) |
| `Cmd+Shift+L` | Insert YouTube timestamp into active note |
| `Cmd+Shift+P` | Toggle YouTube Picture-in-Picture |
| `Cmd+Shift+S` | Toggle sidebar visibility |
| `Cmd+Shift+F` | Full-text search across all texts |
| `Cmd+,` | Open Settings |
| `Cmd+Z` / `Cmd+Shift+Z` | Undo / Redo (in notes editor) |
| `Escape` | Close floating search / dismiss popover |

All shortcuts are listed in Settings → Shortcuts with ability to view (editing shortcuts is a future feature).

---

## 15. Settings & Preferences

### Settings Sections

#### Display
- Default Bible text (KJV, LXX, etc.)
- Font family and size for Bible text
- Font family and size for notes editor
- Line height (comfortable / compact / spacious)
- Theme: Light / Dark / System
- Show inline Strong's numbers (toggle)
- Show Strong's hover tooltips (toggle)
- Click Strong's opens lexicon tab (toggle)
- Verse indicator dot position: right of verse number / left margin
- Cross-text highlight sync (highlights in KJV also show in LXX)

#### Texts
- Enable/disable each available text
- Reorder texts (affects compare view order)
- Text display names (editable)

#### Layout
- Default panel layout (select from preset list)
- Saved workspaces (list, rename, delete)
- Default note-open behavior: new tab / right panel / bottom panel

#### Notes
- Vault sync: off / on
- Vault folder path (file picker): default `/Users/roywe/Library/Mobile Documents/com~apple~CloudDocs/Octarine/workspaces/bible`
- Notes subfolder name inside vault (default: `berean-notes`)
- Verse note file naming: individual files / single chapter file with sections
- Default note color

#### YouTube
- Allowed channels list (add/remove YouTube channel URLs or handles)
- Auto Picture-in-Picture: on / off
- Default timestamp link format

#### Shortcuts
- Read-only list of all keyboard shortcuts (editing deferred to future version)

#### About
- App version
- Open source licenses
- Reset all settings to defaults
- Reset onboarding / hints

---

## 16. Onboarding & Hints

### First Launch Wizard

Step-by-step wizard shown only on first launch:

1. **Welcome** — brief intro to Berean, what it does
2. **Choose vault folder** — file picker, pre-filled with default Octarine path, or choose "Use app-internal storage"
3. **Select default texts** — checkboxes for all available texts, KJV pre-checked
4. **Choose default layout** — visual preview of layout presets, Bible left/Notes right pre-selected
5. **Done** — "Start studying" button

### Hints System

- Subtle tooltip hints appear on first use of each major feature
- Each hint has a **Dismiss** button and a **Don't show again** checkbox
- Hints appear for:
  - First Strong's number hover (explains tooltip)
  - First verse number click (explains verse action popover)
  - First note creation (explains markdown toggle)
  - First YouTube tab open (explains PiP)
  - First `Cmd+T` (explains floating search)
  - First highlight selection
  - First compare view open
- All hints can be reset in Settings → About → Reset hints

---

## 17. Data Storage

### App-Internal Storage

Primary database at: `{app userData}/berean.db`

**Tables:**

```sql
-- Notes
CREATE TABLE notes (
  id          TEXT PRIMARY KEY,      -- UUID
  type        TEXT NOT NULL,         -- "verse" or "general"
  title       TEXT,
  content     TEXT NOT NULL,         -- raw markdown
  book_num    INTEGER,               -- null for general notes
  chapter     INTEGER,
  verse       INTEGER,
  color       TEXT DEFAULT 'blue',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  tags        TEXT                   -- JSON array
);

-- Highlights
CREATE TABLE highlights (
  id          TEXT PRIMARY KEY,
  text_id     TEXT NOT NULL,
  book_num    INTEGER NOT NULL,
  chapter     INTEGER NOT NULL,
  verse       INTEGER NOT NULL,
  start_word  INTEGER,
  end_word    INTEGER,
  color       TEXT NOT NULL,
  label       TEXT,
  created_at  TEXT NOT NULL
);

-- Settings
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL          -- JSON-encoded values
);

-- Tab state (persists open tabs across restarts)
CREATE TABLE tabs (
  id          TEXT PRIMARY KEY,
  space       TEXT NOT NULL,
  type        TEXT NOT NULL,         -- "bible", "note", "lexicon", "youtube", "search"
  title       TEXT NOT NULL,
  state       TEXT NOT NULL,         -- JSON (e.g. {book, chapter, verse})
  position    INTEGER NOT NULL,
  active      INTEGER DEFAULT 0
);

-- Workspaces (saved layouts)
CREATE TABLE workspaces (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  layout_json TEXT NOT NULL,         -- react-mosaic layout serialized
  created_at  TEXT NOT NULL
);
```

### Bible Text Databases

Separate `.db` files per text in `/data/` (shipped with the app).
Schema described in §7.

---

## 18. Obsidian / Octarine Vault Sync

### Default Vault Path

```
/Users/roywe/Library/Mobile Documents/com~apple~CloudDocs/Octarine/workspaces/bible
```

This is an iCloud-synced path. The app uses Node.js `fs` module (via Electron main process IPC) to read/write directly to this folder.

### How Sync Works

- Sync is **one-directional by default**: Berean writes to vault, Octarine reads from it
- When a note is saved in Berean → the corresponding `.md` file is written to the vault folder immediately
- When the app starts → it reads all `.md` files in `berean-notes/` and reconciles with the internal DB (last-write-wins by `updated_at`)
- Two-way sync (detecting edits made in Octarine) is done by file watcher (`chokidar`) watching the vault folder for changes

### File Structure in Vault

```
{vault-root}/
└── berean-notes/
    ├── verse-notes/
    │   ├── Gen_1_1_note1.md
    │   ├── Gen_1_1_note2.md
    │   └── Exod_20_1_note1.md
    └── general-notes/
        ├── creation-study.md
        └── torah-observance-overview.md
```

### Markdown File Format

All note files use YAML frontmatter compatible with Obsidian and Octarine:

```markdown
---
type: verse-note
ref: Gen 1:1
created: 2025-01-15T10:30:00
updated: 2025-01-15T14:22:00
tags: [creation, beginnings]
color: blue
berean_id: abc123-uuid
---

# Gen 1:1 — Creation Note

In the beginning Yehovah created the heavens and the earth...

[[Exod 20:11]] — cross-reference to Sabbath commandment
```

- `berean_id` is used to reconcile with the internal DB without relying on filenames
- `[[wikilink]]` style verse references are supported and auto-link in Berean
- Standard `[[Note Title]]` wikilinks to other notes are also supported

---

## 19. Distribution & Packaging

### Mac (Primary)

- Built with `electron-builder` → outputs `.dmg` installer
- Code-signed for macOS Gatekeeper (requires Apple Developer certificate)
- User downloads `.dmg`, drags to Applications — no CLI, no Node, no setup
- Auto-updater (`electron-updater`) to push updates to existing installs
- Bible text `.db` files are bundled inside the app package (inside `Resources/`)

### Windows (Deferred)

- Same codebase, add Windows build target to `electron-builder` config later
- Will output `.exe` NSIS installer

### Sharing with Others

- Distribute via a simple download page or direct link (GitHub Releases or similar)
- No account required to install
- On first launch, onboarding wizard handles all setup

---

## 20. Deferred / Future Features

These are explicitly out of scope for initial build. Do not implement until instructed:

- **Mobile companion** — iOS/Android app or PWA
- **Windows build** — add after Mac version is stable
- **BibleGateway notes sync** — requires login session scraping, deferred
- **Testament of the Twelve Patriarchs** and additional pseudepigrapha — add as separate `.db` files later
- **Hebrew interlinear** (Leningrad Codex / MT) — complex rendering, deferred
- **Greek interlinear** (GNT) — deferred
- **Shortcut editing UI** — Settings shows shortcuts read-only for now
- **Floating/detached note windows** — panel and tab modes are sufficient for now
- **Collaborative notes** — single user only for now
- **Cross-device sync** beyond iCloud vault path — deferred

---

## 21. Theology & Naming Conventions

The app is built for Torah-observant Hebrew Roots believers. The following naming conventions
must be used consistently throughout the app UI, notes templates, and any default content:

| Avoid | Use instead |
|---|---|
| Jesus | Yeshua |

- KJV Bible text is displayed verbatim (do not alter the text)
- App UI strings (tooltips, hints, labels, placeholder text) should use the names above
- Default note templates (if any are provided) should use Yehovah and Yeshua
- The Strong's lexicon data is displayed as-is (third-party data, not modified)

---

## 22. Build & Dev Commands

```bash
# Install dependencies
npm install

# Run in development (Electron + Vite HMR)
npm run dev

# Build for production (Mac .dmg)
npm run build:mac

# Build for Windows (deferred)
npm run build:win

# Run tests
npm test

# Lint
npm run lint

# Type-check
npm run typecheck
```

### Git Workflow

```bash
# Always create a worktree for new features — never work directly on main
git worktree add ../Berean-feature-name -b feature/feature-name

# Example
git worktree add ../Berean-sidebar -b feature/sidebar
cd ../Berean-sidebar
# ... work ...
git add . && git commit -m "feat: implement Arc-style sidebar"
git push origin feature/sidebar
# Open PR into main
```

### Claude Code Session Conventions

- **Always state the worktree path when telling the user they can test something.**
  Whenever a message tells Michael he can try/test a change, explicitly include
  the worktree folder path and the `npm run dev` command, e.g.:
  "You can test this by running `npm run dev` in `/Users/roywe/Berean-feature-name`."
  Do not assume he remembers which worktree is active.
- **Offer the `cleanup-merge` skill after finishing requested work.** When a
  round of requested changes is done (not mid-task, not after every small
  edit — only once the user's ask for that session/turn is actually complete),
  ask whether he wants to merge the current worktree's branch into `main`,
  push, and delete the worktree. Use the `cleanup-merge` skill
  (`.claude/skills/cleanup-merge/SKILL.md`) to do this — don't improvise the
  merge/push/cleanup steps ad hoc.

---

*End of CLAUDE.md — last updated May 2026*
