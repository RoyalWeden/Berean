import { useState, useMemo } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, ArrowLeft, Search, Copy, Check } from 'lucide-react'
import { useAppStore } from '@/store'

// ── Book data for the "All supported books" sub-view ────────────────────────

interface BookEntry {
  id: string
  name: string
  abbr: string
  exampleChapter: number
  exampleVerse: number
}

const BOOK_GROUPS: Array<{ group: string; books: BookEntry[] }> = [
  {
    group: 'Torah',
    books: [
      { id: 'GEN', name: 'Genesis',       abbr: 'Gen',   exampleChapter: 1,  exampleVerse: 1 },
      { id: 'EXO', name: 'Exodus',        abbr: 'Exod',  exampleChapter: 20, exampleVerse: 1 },
      { id: 'LEV', name: 'Leviticus',     abbr: 'Lev',   exampleChapter: 23, exampleVerse: 1 },
      { id: 'NUM', name: 'Numbers',       abbr: 'Num',   exampleChapter: 6,  exampleVerse: 24 },
      { id: 'DEU', name: 'Deuteronomy',   abbr: 'Deut',  exampleChapter: 6,  exampleVerse: 4 },
    ],
  },
  {
    group: 'Historical Books',
    books: [
      { id: 'JOS', name: 'Joshua',        abbr: 'Josh',  exampleChapter: 1,  exampleVerse: 1 },
      { id: 'JDG', name: 'Judges',        abbr: 'Judg',  exampleChapter: 2,  exampleVerse: 1 },
      { id: 'RUT', name: 'Ruth',          abbr: 'Ruth',  exampleChapter: 1,  exampleVerse: 1 },
      { id: '1SA', name: '1 Samuel',      abbr: '1 Sam', exampleChapter: 1,  exampleVerse: 1 },
      { id: '2SA', name: '2 Samuel',      abbr: '2 Sam', exampleChapter: 7,  exampleVerse: 12 },
      { id: '1KI', name: '1 Kings',       abbr: '1 Ki',  exampleChapter: 8,  exampleVerse: 1 },
      { id: '2KI', name: '2 Kings',       abbr: '2 Ki',  exampleChapter: 17, exampleVerse: 6 },
      { id: '1CH', name: '1 Chronicles',  abbr: '1 Chr', exampleChapter: 1,  exampleVerse: 1 },
      { id: '2CH', name: '2 Chronicles',  abbr: '2 Chr', exampleChapter: 7,  exampleVerse: 14 },
      { id: 'EZR', name: 'Ezra',          abbr: 'Ezra',  exampleChapter: 1,  exampleVerse: 1 },
      { id: 'NEH', name: 'Nehemiah',      abbr: 'Neh',   exampleChapter: 8,  exampleVerse: 1 },
    ],
  },
  {
    group: 'Wisdom & Poetry',
    books: [
      { id: 'JOB', name: 'Job',           abbr: 'Job',   exampleChapter: 1,  exampleVerse: 1 },
      { id: 'PSA', name: 'Psalms',        abbr: 'Ps',    exampleChapter: 119, exampleVerse: 105 },
      { id: 'PRO', name: 'Proverbs',      abbr: 'Prov',  exampleChapter: 3,  exampleVerse: 5 },
      { id: 'ECC', name: 'Ecclesiastes',  abbr: 'Eccl',  exampleChapter: 12, exampleVerse: 13 },
      { id: 'SNG', name: 'Song of Solomon', abbr: 'Song', exampleChapter: 1,  exampleVerse: 1 },
    ],
  },
  {
    group: 'Major Prophets',
    books: [
      { id: 'ISA', name: 'Isaiah',        abbr: 'Isa',   exampleChapter: 7,  exampleVerse: 14 },
      { id: 'JER', name: 'Jeremiah',      abbr: 'Jer',   exampleChapter: 31, exampleVerse: 31 },
      { id: 'LAM', name: 'Lamentations',  abbr: 'Lam',   exampleChapter: 3,  exampleVerse: 22 },
      { id: 'EZK', name: 'Ezekiel',       abbr: 'Ezek',  exampleChapter: 37, exampleVerse: 1 },
      { id: 'DAN', name: 'Daniel',        abbr: 'Dan',   exampleChapter: 7,  exampleVerse: 13 },
    ],
  },
  {
    group: 'Minor Prophets',
    books: [
      { id: 'HOS', name: 'Hosea',         abbr: 'Hos',   exampleChapter: 6,  exampleVerse: 6 },
      { id: 'JOL', name: 'Joel',          abbr: 'Joel',  exampleChapter: 2,  exampleVerse: 28 },
      { id: 'AMO', name: 'Amos',          abbr: 'Amos',  exampleChapter: 9,  exampleVerse: 11 },
      { id: 'OBA', name: 'Obadiah',       abbr: 'Obad',  exampleChapter: 1,  exampleVerse: 1 },
      { id: 'JON', name: 'Jonah',         abbr: 'Jonah', exampleChapter: 1,  exampleVerse: 1 },
      { id: 'MIC', name: 'Micah',         abbr: 'Mic',   exampleChapter: 6,  exampleVerse: 8 },
      { id: 'NAM', name: 'Nahum',         abbr: 'Nah',   exampleChapter: 1,  exampleVerse: 1 },
      { id: 'HAB', name: 'Habakkuk',      abbr: 'Hab',   exampleChapter: 2,  exampleVerse: 4 },
      { id: 'ZEP', name: 'Zephaniah',     abbr: 'Zeph',  exampleChapter: 1,  exampleVerse: 1 },
      { id: 'HAG', name: 'Haggai',        abbr: 'Hag',   exampleChapter: 2,  exampleVerse: 9 },
      { id: 'ZEC', name: 'Zechariah',     abbr: 'Zech',  exampleChapter: 14, exampleVerse: 9 },
      { id: 'MAL', name: 'Malachi',       abbr: 'Mal',   exampleChapter: 4,  exampleVerse: 5 },
    ],
  },
  {
    group: 'NT — Gospels & Acts',
    books: [
      { id: 'MAT', name: 'Matthew',       abbr: 'Matt',  exampleChapter: 5,  exampleVerse: 17 },
      { id: 'MRK', name: 'Mark',          abbr: 'Mark',  exampleChapter: 1,  exampleVerse: 1 },
      { id: 'LUK', name: 'Luke',          abbr: 'Luke',  exampleChapter: 1,  exampleVerse: 1 },
      { id: 'JHN', name: 'John',          abbr: 'John',  exampleChapter: 1,  exampleVerse: 1 },
      { id: 'ACT', name: 'Acts',          abbr: 'Acts',  exampleChapter: 2,  exampleVerse: 1 },
    ],
  },
  {
    group: 'NT — Epistles',
    books: [
      { id: 'ROM', name: 'Romans',           abbr: 'Rom',    exampleChapter: 8,  exampleVerse: 1 },
      { id: '1CO', name: '1 Corinthians',    abbr: '1 Cor',  exampleChapter: 13, exampleVerse: 1 },
      { id: '2CO', name: '2 Corinthians',    abbr: '2 Cor',  exampleChapter: 3,  exampleVerse: 6 },
      { id: 'GAL', name: 'Galatians',        abbr: 'Gal',    exampleChapter: 3,  exampleVerse: 28 },
      { id: 'EPH', name: 'Ephesians',        abbr: 'Eph',    exampleChapter: 2,  exampleVerse: 8 },
      { id: 'PHP', name: 'Philippians',      abbr: 'Phil',   exampleChapter: 4,  exampleVerse: 13 },
      { id: 'COL', name: 'Colossians',       abbr: 'Col',    exampleChapter: 2,  exampleVerse: 16 },
      { id: '1TH', name: '1 Thessalonians',  abbr: '1 Thess', exampleChapter: 4, exampleVerse: 16 },
      { id: '2TH', name: '2 Thessalonians',  abbr: '2 Thess', exampleChapter: 2, exampleVerse: 1 },
      { id: '1TI', name: '1 Timothy',        abbr: '1 Tim',  exampleChapter: 6,  exampleVerse: 10 },
      { id: '2TI', name: '2 Timothy',        abbr: '2 Tim',  exampleChapter: 3,  exampleVerse: 16 },
      { id: 'TIT', name: 'Titus',            abbr: 'Tit',    exampleChapter: 2,  exampleVerse: 11 },
      { id: 'PHM', name: 'Philemon',         abbr: 'Phlm',   exampleChapter: 1,  exampleVerse: 1 },
      { id: 'HEB', name: 'Hebrews',          abbr: 'Heb',    exampleChapter: 4,  exampleVerse: 9 },
      { id: 'JAS', name: 'James',            abbr: 'Jas',    exampleChapter: 2,  exampleVerse: 17 },
      { id: '1PE', name: '1 Peter',          abbr: '1 Pet',  exampleChapter: 2,  exampleVerse: 9 },
      { id: '2PE', name: '2 Peter',          abbr: '2 Pet',  exampleChapter: 1,  exampleVerse: 19 },
      { id: '1JN', name: '1 John',           abbr: '1 John', exampleChapter: 5,  exampleVerse: 3 },
      { id: '2JN', name: '2 John',           abbr: '2 John', exampleChapter: 1,  exampleVerse: 6 },
      { id: '3JN', name: '3 John',           abbr: '3 John', exampleChapter: 1,  exampleVerse: 11 },
      { id: 'JUD', name: 'Jude',             abbr: 'Jude',   exampleChapter: 1,  exampleVerse: 3 },
      { id: 'REV', name: 'Revelation',       abbr: 'Rev',    exampleChapter: 22, exampleVerse: 14 },
    ],
  },
  {
    group: 'Apocrypha',
    books: [
      { id: 'TOB', name: 'Tobit',              abbr: 'Tob',        exampleChapter: 1, exampleVerse: 1 },
      { id: 'JDT', name: 'Judith',             abbr: 'Jdt',        exampleChapter: 8, exampleVerse: 1 },
      { id: 'WIS', name: 'Wisdom of Solomon',  abbr: 'Wis',        exampleChapter: 1, exampleVerse: 1 },
      { id: 'SIR', name: 'Sirach',             abbr: 'Sir',        exampleChapter: 1, exampleVerse: 1 },
      { id: 'BAR', name: 'Baruch',             abbr: 'Bar',        exampleChapter: 1, exampleVerse: 1 },
      { id: '1MA', name: '1 Maccabees',        abbr: '1 Macc',     exampleChapter: 1, exampleVerse: 1 },
      { id: '2MA', name: '2 Maccabees',        abbr: '2 Macc',     exampleChapter: 7, exampleVerse: 1 },
      { id: '1ES', name: '1 Esdras',           abbr: '1 Esd',      exampleChapter: 1, exampleVerse: 1 },
      { id: '2ES', name: '2 Esdras',           abbr: '2 Esd',      exampleChapter: 1, exampleVerse: 1 },
    ],
  },
  {
    group: 'Pseudepigrapha',
    books: [
      { id: 'ENO',  name: '1 Enoch',              abbr: 'Enoch',        exampleChapter: 1, exampleVerse: 1 },
      { id: 'JUB',  name: 'Jubilees',              abbr: 'Jub',          exampleChapter: 6, exampleVerse: 32 },
      { id: 'GAD',  name: 'Gad the Seer',          abbr: 'Gad',          exampleChapter: 1, exampleVerse: 1 },
      { id: 'TJOB', name: 'Testament of Job',       abbr: 'TJob',         exampleChapter: 1, exampleVerse: 1 },
      { id: '1CL',  name: '1 Clement',              abbr: '1Cl',          exampleChapter: 1, exampleVerse: 1 },
      { id: 'AEL',  name: 'Apocalypse of Elijah',  abbr: 'Apoc. Elijah', exampleChapter: 1, exampleVerse: 1 },
      { id: 'AIS',  name: 'Ascension of Isaiah',   abbr: 'Asc. Isaiah',  exampleChapter: 3, exampleVerse: 13 },
      { id: 'EPB',  name: 'Epistle of Barnabas',   abbr: 'Ep. Barnabas', exampleChapter: 2, exampleVerse: 1 },
    ],
  },
  {
    group: 'Testaments of the Twelve Patriarchs',
    books: [
      { id: 'TREU', name: 'Testament of Reuben',    abbr: 'T. Reuben',   exampleChapter: 1, exampleVerse: 1 },
      { id: 'TSIM', name: 'Testament of Simeon',    abbr: 'T. Simeon',   exampleChapter: 2, exampleVerse: 1 },
      { id: 'TLEV', name: 'Testament of Levi',      abbr: 'T. Levi',     exampleChapter: 3, exampleVerse: 1 },
      { id: 'TJUD', name: 'Testament of Judah',     abbr: 'T. Judah',    exampleChapter: 1, exampleVerse: 1 },
      { id: 'TISS', name: 'Testament of Issachar',  abbr: 'T. Issachar', exampleChapter: 1, exampleVerse: 1 },
      { id: 'TZEB', name: 'Testament of Zebulun',   abbr: 'T. Zebulun',  exampleChapter: 1, exampleVerse: 1 },
      { id: 'TDAN', name: 'Testament of Dan',       abbr: 'T. Dan',      exampleChapter: 1, exampleVerse: 1 },
      { id: 'TNAP', name: 'Testament of Naphtali',  abbr: 'T. Naphtali', exampleChapter: 1, exampleVerse: 1 },
      { id: 'TGAD', name: 'Testament of Gad',       abbr: 'T. Gad',      exampleChapter: 1, exampleVerse: 1 },
      { id: 'TASH', name: 'Testament of Asher',     abbr: 'T. Asher',    exampleChapter: 1, exampleVerse: 1 },
      { id: 'TJOS', name: 'Testament of Joseph',    abbr: 'T. Joseph',   exampleChapter: 1, exampleVerse: 1 },
      { id: 'TBEN', name: 'Testament of Benjamin',  abbr: 'T. Benjamin', exampleChapter: 1, exampleVerse: 1 },
    ],
  },
  {
    group: 'Recognitions of Clement',
    books: [
      // Full "Recognitions of Clement" spelled out here (not just "Recognitions - Book N") —
      // this list's own <select> renders `name` as a flat, ungrouped dropdown with no group
      // heading visible, so each entry needs to be unambiguous entirely on its own.
      { id: 'RCL1',  name: 'Recognitions of Clement, Book 1',  abbr: 'Rcl 1',  exampleChapter: 1, exampleVerse: 1 },
      { id: 'RCL2',  name: 'Recognitions of Clement, Book 2',  abbr: 'Rcl 2',  exampleChapter: 1, exampleVerse: 1 },
      { id: 'RCL3',  name: 'Recognitions of Clement, Book 3',  abbr: 'Rcl 3',  exampleChapter: 1, exampleVerse: 1 },
      { id: 'RCL4',  name: 'Recognitions of Clement, Book 4',  abbr: 'Rcl 4',  exampleChapter: 1, exampleVerse: 1 },
      { id: 'RCL5',  name: 'Recognitions of Clement, Book 5',  abbr: 'Rcl 5',  exampleChapter: 1, exampleVerse: 1 },
      { id: 'RCL6',  name: 'Recognitions of Clement, Book 6',  abbr: 'Rcl 6',  exampleChapter: 1, exampleVerse: 1 },
      { id: 'RCL7',  name: 'Recognitions of Clement, Book 7',  abbr: 'Rcl 7',  exampleChapter: 1, exampleVerse: 1 },
      { id: 'RCL8',  name: 'Recognitions of Clement, Book 8',  abbr: 'Rcl 8',  exampleChapter: 1, exampleVerse: 1 },
      { id: 'RCL9',  name: 'Recognitions of Clement, Book 9',  abbr: 'Rcl 9',  exampleChapter: 1, exampleVerse: 1 },
      { id: 'RCL10', name: 'Recognitions of Clement, Book 10', abbr: 'Rcl 10', exampleChapter: 1, exampleVerse: 1 },
    ],
  },
  {
    group: 'Shepherd of Hermas',
    books: [
      { id: 'HER_VIS', name: 'Hermas - Visions',     abbr: 'Hermas: Visions',     exampleChapter: 1, exampleVerse: 1 },
      { id: 'HER_MAN', name: 'Hermas - Mandates',    abbr: 'Hermas: Mandates',    exampleChapter: 1, exampleVerse: 1 },
      { id: 'HER_SIM', name: 'Hermas - Similitudes', abbr: 'Hermas: Similitudes', exampleChapter: 1, exampleVerse: 1 },
    ],
  },
]

// Flat list for search
const ALL_BOOKS: (BookEntry & { group: string })[] = BOOK_GROUPS.flatMap((g) =>
  g.books.map((b) => ({ ...b, group: g.group }))
)

// ── Reference item data ───────────────────────────────────────────────────────

interface RefItem {
  id: string
  syntax: string
  label: string
  description: string
  why: string
  examples: { input: string; output: string }[]
  notes?: string
  hasAllBooksPanel?: boolean
}

const REFERENCE_ITEMS: RefItem[] = [
  {
    id: 'headings',
    syntax: '# Heading',
    label: 'Headings',
    description: 'Create section headings with 1–6 # symbols. More # symbols = smaller heading.',
    why: 'Organise long study notes into sections you can scan at a glance.',
    examples: [
      { input: '# Major theme', output: 'Large bold heading (H1)' },
      { input: '## Sub-topic', output: 'Medium heading (H2)' },
      { input: '### Detail', output: 'Small heading (H3)' },
    ],
  },
  {
    id: 'bold',
    syntax: '**bold**',
    label: 'Bold  (⌘B)',
    description: 'Wrap text in double asterisks to make it bold.',
    why: 'Emphasise key words, names, or conclusions in your notes.',
    examples: [
      { input: '**Yehovah** said', output: 'Yehovah said (Yehovah is bold)' },
      { input: '**key insight**', output: 'key insight (bold)' },
    ],
  },
  {
    id: 'italic',
    syntax: '*italic*',
    label: 'Italic  (⌘I)',
    description: 'Wrap text in single asterisks (or underscores) to italicise it.',
    why: 'Highlight titles, foreign words, or soft emphasis.',
    examples: [
      { input: '*torah*', output: 'torah (italic)' },
      { input: '_selah_', output: 'selah (italic)' },
    ],
  },
  {
    id: 'underline',
    syntax: '<u>underline</u>',
    label: 'Underline  (⌘U)',
    description: 'Wrap text in <u></u> HTML tags to underline it.',
    why: 'Mark definitions or terms you want to look up later.',
    examples: [
      { input: '<u>hesed</u>', output: 'hesed (underlined)' },
    ],
  },
  {
    id: 'strike',
    syntax: '~~strike~~',
    label: 'Strikethrough',
    description: 'Wrap text in double tildes to draw a line through it.',
    why: 'Cross out ideas you\'ve reconsidered or notes that are superseded.',
    examples: [
      { input: '~~old interpretation~~', output: 'old interpretation (struck through)' },
    ],
  },
  {
    id: 'highlight',
    syntax: '==highlight==',
    label: 'Highlight  (⌘⇧H)',
    description: 'Wrap text in double equals signs to apply a yellow highlight background.',
    why: 'Mark key words or phrases that you want to stand out at a glance.',
    examples: [
      { input: '==key term==',    output: 'key term (yellow highlight)' },
      { input: '==Yehovah==',     output: 'Yehovah (highlighted)' },
      { input: 'The ==light== of the world', output: 'only "light" is highlighted' },
    ],
  },
  {
    id: 'inline-code',
    syntax: '`code`',
    label: 'Inline code',
    description: 'Wrap text in backticks for monospace inline code.',
    why: 'Display Strong\'s numbers, Hebrew/Greek words, or exact terms distinctly.',
    examples: [
      { input: 'Strong\'s `H7225`', output: 'Strong\'s H7225 (monospace)' },
      { input: 'The word `בְּרֵאשִׁית`', output: 'The word בְּרֵאשִׁית (monospace)' },
    ],
  },
  {
    id: 'code-block',
    syntax: '```\nblock\n```',
    label: 'Code block',
    description: 'Wrap multiple lines in triple backticks for a monospace block.',
    why: 'Display structured content like Hebrew paradigms or word lists.',
    examples: [
      { input: '```\nH7225 — rêʼshîyth\nfirst, beginning\n```', output: 'Monospace block with two lines' },
    ],
  },
  {
    id: 'bullet',
    syntax: '* bullet',
    label: 'Bullet list',
    description: 'Start lines with *, -, or + for unordered lists.',
    why: 'List observations, cross-references, or study points without implying order.',
    examples: [
      { input: '* First observation\n* Second observation', output: '• First observation\n• Second observation' },
      { input: '- Day one\n- Day two', output: '• Day one\n• Day two' },
    ],
  },
  {
    id: 'numbered',
    syntax: '1. numbered',
    label: 'Numbered list',
    description: 'Start lines with a number and period for ordered lists.',
    why: 'Use for step-by-step interpretations or ranked points.',
    examples: [
      { input: '1. Creation begins\n2. Light appears', output: '1. Creation begins\n2. Light appears' },
    ],
  },
  {
    id: 'blockquote',
    syntax: '> blockquote',
    label: 'Blockquote',
    description: 'Start a line with > to format it as an indented blockquote.',
    why: 'Set apart a verse, a paraphrase, or a quoted source.',
    examples: [
      { input: '> In the beginning Yehovah created…', output: 'Indented quote block' },
    ],
  },
  {
    id: 'callout',
    syntax: '> [!NOTE]\n> body text',
    label: 'Callout box',
    description: 'Start a blockquote with > [!TYPE] on the first line to create a styled callout. Supported types: NOTE, TIP, WARNING, IMPORTANT, CAUTION. Add an optional custom title after the type tag.',
    why: 'Highlight key insights, cautions, or study tips so they stand out at a glance.',
    examples: [
      { input: '> [!NOTE]\n> Sabbath begins at sundown.',          output: 'Blue note callout' },
      { input: '> [!WARNING] Do not overlook\n> This passage has rabbinic additions.', output: 'Orange warning callout with custom title' },
      { input: '> [!TIP]\n> Cross-reference with LXX Ps 113.',     output: 'Green tip callout' },
      { input: '> [!IMPORTANT]\n> Torah perpetuity — Deut 12:32.', output: 'Purple important callout' },
      { input: '> [!CAUTION]\n> Disputed manuscript variant here.', output: 'Red caution callout' },
    ],
  },
  {
    id: 'table',
    syntax: '| Header | Header | Header |\n| --- | --- | --- |\n| Cell | Cell | Cell |',
    label: 'Table',
    description: 'Create a table with pipes (|) to separate columns and dashes (---) to mark the header row. Add as many columns and rows as you like. Use the Table button (⊞) in the toolbar to insert a starter template.',
    why: 'Compare passages, translations, Strong\'s entries, or outline arguments in a structured grid.',
    examples: [
      { input: '| Word | Strong\'s | Meaning |\n| --- | --- | --- |\n| בְּרֵאשִׁית | H7225 | beginning |\n| אֱלֹהִים | H430 | Elohim |', output: 'Three-column table with two data rows' },
      { input: '| Reference | KJV | LXX |\n| --- | --- | --- |\n| Gen 1:1 | In the beginning | En archē |', output: 'Translation comparison table' },
      { input: '| Feast | Month | Day |\n| --- | --- | --- |\n| Passover | 1 | 14 |\n| Unleavened Bread | 1 | 15–21 |', output: 'Feast calendar table' },
    ],
    notes: 'Column widths adjust automatically to content. Columns can be left-aligned (default), right-aligned (| ---: |), or centered (| :---: |).',
  },
  {
    id: 'task-list',
    syntax: '- [ ] task',
    label: 'Task list',
    description: 'Start a line with - [ ] for an unchecked task or - [x] for a checked task.',
    why: 'Track study to-dos, prayer items, or passages you plan to revisit.',
    examples: [
      { input: '- [ ] Study Leviticus 23',      output: '☐ Study Leviticus 23 (unchecked)' },
      { input: '- [x] Compare Gen 1 with LXX',  output: '☑ Compare Gen 1 with LXX (checked)' },
    ],
  },
  {
    id: 'lettered-list',
    syntax: 'a. item',
    label: 'Lettered list',
    description: 'Start lines with a lowercase letter (a., b., c.) or uppercase (A., B., C.) followed by a period and space.',
    why: 'Use when you want sub-points labeled alphabetically rather than numerically.',
    examples: [
      { input: 'a. First point\nb. Second point',  output: 'a. First point\nb. Second point' },
      { input: 'A. Major point\nB. Another point', output: 'A. Major point\nB. Another point' },
    ],
  },
  {
    id: 'roman-list',
    syntax: 'i. item',
    label: 'Roman numeral list',
    description: 'Start lines with a lowercase roman numeral (i., ii., iii.) or uppercase (I., II., III.) followed by a period and space.',
    why: 'Classical outline format — useful for structured theological arguments or sermon notes.',
    examples: [
      { input: 'i. Introduction\nii. Body\niii. Conclusion',    output: 'i. Introduction  (lowercase)' },
      { input: 'I. Torah\nII. Prophets\nIII. Writings',         output: 'I. Torah  (uppercase)' },
    ],
  },
  {
    id: 'alignment',
    syntax: '<div align="center">…</div>',
    label: 'Alignment',
    description: 'Wrap a line in an HTML div with align="left", "center", "right", or "justify". The toolbar alignment buttons insert this automatically — the raw HTML is hidden in the editor.',
    why: 'Centre a heading, right-align a citation, or justify paragraph text.',
    examples: [
      { input: '<div align="center">In the beginning</div>',  output: 'Centred text' },
      { input: '<div align="right">— Genesis 1:1</div>',      output: 'Right-aligned citation' },
      { input: '<div align="justify">Long passage…</div>',    output: 'Justified paragraph' },
    ],
    notes: 'Click anywhere on an aligned line to reveal the raw HTML for editing.',
  },
  {
    id: 'divider',
    syntax: '---',
    label: 'Divider',
    description: 'Three or more dashes on their own line create a horizontal rule.',
    why: 'Separate major sections in a long note.',
    examples: [
      { input: 'Section one\n\n---\n\nSection two', output: 'Horizontal line between sections' },
    ],
  },
  {
    id: 'link',
    syntax: '[text](url)',
    label: 'External link',
    description: 'Standard markdown hyperlink — [label](URL). Clicking opens the URL in your browser.',
    why: 'Link to references, commentaries, or online resources.',
    examples: [
      { input: '[BibleHub H7225](https://biblehub.com/hebrew/7225.htm)', output: 'Clickable link: BibleHub H7225' },
    ],
  },
  {
    id: 'youtube',
    syntax: '[Title — HH:MM](youtube.com/…)',
    label: 'YouTube timestamp link',
    description: 'A link whose URL contains a YouTube video ID. Clicking opens that video inside the YouTube tab, optionally seeking to the timestamp if ?t=N is in the URL. Use ⌘⇧L while a video is playing to insert one automatically.',
    why: 'Bookmark a specific moment in a sermon or teaching and jump back to it from your notes.',
    examples: [
      { input: '[Teaching — 12:34](https://youtu.be/dQw4w9WgXcQ?t=754)', output: 'Clicking opens YouTube tab at 12:34' },
      { input: '[Full video](https://youtu.be/dQw4w9WgXcQ)', output: 'Clicking opens YouTube tab at the beginning' },
    ],
    notes: 'Insert automatically with ⌘⇧L while a video is playing.',
  },
  {
    id: 'bible-ref',
    syntax: 'Genesis 1:1',
    label: 'Bible verse reference',
    description: 'Any recognisable Bible reference typed in plain text is automatically highlighted and clickable. Clicking it switches to the Scripture panel and navigates to that passage.',
    why: 'Link your notes directly to the passages you\'re studying — one click to jump there.',
    examples: [
      { input: 'Genesis 1:1', output: 'Highlighted link → Genesis 1:1' },
      { input: 'Gen 1:1', output: 'Abbreviated form — same result' },
      { input: '1 Samuel 17:4', output: 'Numbered book' },
      { input: 'Song of Solomon 1:1', output: 'Multi-word book name' },
      { input: 'Rev 22:1-5', output: 'Verse range — highlights the range on arrival' },
      { input: 'Psalm 119', output: 'Chapter only — opens chapter 119' },
    ],
    notes: 'Both titlecase and lowercase work. Verse ranges work for any book.',
    hasAllBooksPanel: true,
  },
  {
    id: 'wikilink',
    syntax: '[[Note Title]]',
    label: 'Note wikilink',
    description: 'Double brackets around a note title creates a link to another note in your library.',
    why: 'Build a connected knowledge base — link your study notes to each other like a personal wiki.',
    examples: [
      { input: '[[Creation study]]', output: 'Clickable link that opens the "Creation study" note' },
      { input: '[[Covenant overview]]', output: 'Opens that specific note' },
    ],
  },
  {
    id: 'lexicon-ref',
    syntax: 'H7225 / G3056',
    label: 'Lexicon reference',
    description: 'Any Strong\'s number typed in a note (H#### for Hebrew, G#### for Greek) is automatically highlighted and clickable. Clicking it opens that entry in the Lexicon panel.',
    why: 'Jump straight to a Strong\'s entry from your notes without leaving the editor.',
    examples: [
      { input: 'H7225',  output: 'Opens Strong\'s H7225 — בְּרֵאשִׁית (bĕrêʼshîyth) in the Lexicon' },
      { input: 'G3056',  output: 'Opens Strong\'s G3056 — λόγος (logos) in the Lexicon' },
      { input: 'H430',   output: 'Opens Strong\'s H430 — אֱלֹהִים (Elohim)' },
    ],
    notes: 'Both uppercase and lowercase h/g are recognised. Disable in Settings → Notes.',
  },
  {
    id: 'lxx-ref',
    syntax: 'lxx:Genesis 1:1\nGenesis 8:1-4 LXX',
    label: 'LXX reference',
    description: 'Two forms: prefix a reference with lxx: (or LXX:), or append LXX to the end. Either form navigates to the Brenton Septuagint instead of KJVA.',
    why: 'Compare how the Septuagint renders a canonical passage alongside the KJV without manually switching translations.',
    examples: [
      { input: 'lxx:Genesis 1:1',    output: 'Opens Genesis 1:1 in Brenton LXX (prefix form)' },
      { input: 'Genesis 8:1-4 LXX',  output: 'Same result — suffix form' },
      { input: 'lxx:Psalms 22:1',    output: 'LXX Psalms 22:1 (verse numbering differs from KJV)' },
      { input: 'Isaiah 7:14 LXX',    output: 'LXX Isaiah 7:14 — parthenos (virgin) wording' },
      { input: 'Tobit 1:1',          output: 'Deuterocanonical — no marker needed (LXX only)' },
    ],
    notes: 'The lxx:/LXX suffix overrides whatever translation is currently active.',
  },
  {
    id: 'scripture-block',
    syntax: 'Genesis 1:1\nIn the beginning…',
    label: 'Scripture block',
    description: 'When you type a verse reference followed by its actual verse text, Berean recognises the passage and renders it as a styled scripture block with a left accent bar. Multi-verse ranges become numbered blocks. The underlying text stays plain so it copies cleanly.',
    why: 'Quote scripture in your notes with clear visual separation from your own commentary.',
    examples: [
      { input: 'Genesis 1:1 In the beginning Yehovah created the heavens and the earth', output: 'Single-line scripture block' },
      { input: 'Gen 1:1-3\n1 In the beginning…\n2 And the earth…\n3 And Yehovah said…', output: 'Multi-line numbered block' },
    ],
    notes: 'Enable auto-formatting in Settings → Notes → Scripture blocks. A line only formats when its text closely matches the real verse, so commentary like "Genesis 5:4 my thoughts" stays plain.',
  },
  {
    id: 'verse-suggestion',
    syntax: 'Type "Gen 1:1" → popup',
    label: 'Verse block suggestion',
    description: 'When you type a complete verse reference (or range), a small popup offers to expand it into a full scripture block — fetching the verse text for you. Press Enter to insert, or Esc to dismiss.',
    why: 'Pull in scripture text without leaving the editor or copy-pasting from the reader.',
    examples: [
      { input: 'Gen 1:1',     output: 'Popup → Insert scripture block (single verse, inline)' },
      { input: 'John 1:1-3',  output: 'Popup → Insert scripture block (range, numbered lines)' },
    ],
    notes: 'Toggle in Settings → Notes → Verse block suggestion. Press Enter to accept, Esc to dismiss.',
  },
  {
    id: 'strongs-block',
    syntax: 'Type "H7225" → popup',
    label: 'Strong\'s block suggestion',
    description: 'When you type a Strong\'s number, a popup offers to expand it into a full lexicon block — the number, lemma, transliteration and definition, formatted across two lines. Press Enter to insert, or Esc to dismiss.',
    why: 'Drop a complete lexicon entry into your study notes in one keystroke.',
    examples: [
      { input: 'H7225', output: 'Popup → Insert Strong\'s block (בְּרֵאשִׁית rêʼshîyth; the beginning…)' },
      { input: 'g5485', output: 'Lowercase works too → G5485 χάρις cháris; grace…' },
    ],
    notes: 'Toggle in Settings → Notes → Strong\'s block suggestion. Lowercase h/g is accepted; the inserted block always uses the uppercase form. You can also copy a block from the Lexicon panel\'s copy button.',
  },
  {
    id: 'shortcuts',
    syntax: '⌘⇧N  ⌘⇧M  ⌘Z',
    label: 'Keyboard shortcuts',
    description: 'These shortcuts work inside the notes editor. All use the ⌘ (Command) key on macOS.',
    why: 'Format and navigate notes without lifting your hands from the keyboard.',
    examples: [
      { input: '⌘⇧N',              output: 'New general note' },
      { input: '⌘⇧M',              output: 'Toggle markdown preview (rendered ↔ raw)' },
      { input: '⌘Z / ⌘⇧Z',        output: 'Undo / Redo' },
      { input: '⌘B / ⌘I / ⌘U',    output: 'Bold / Italic / Underline' },
      { input: '⌘⇧H',              output: 'Highlight selected text (==text==)' },
      { input: '⌘⇧R',              output: 'Suppress / re-enable refs for selected text' },
      { input: '⌘⇧L',              output: 'Insert YouTube timestamp at cursor (while video plays)' },
    ],
    notes: 'Select text first before using ⌘B, ⌘I, ⌘U, ⌘⇧H, and ⌘⇧R. Alignment is applied per line via the toolbar.',
  },
]

// ── Verse builder ─────────────────────────────────────────────────────────────

function VerseBuilder() {
  const flatBooks = ALL_BOOKS
  const [bookIdx, setBookIdx] = useState(0)
  const [chapter, setChapter] = useState('1')
  const [startVerse, setStartVerse] = useState('1')
  const [endVerse, setEndVerse] = useState('')
  const [copied, setCopied] = useState(false)

  const book = flatBooks[bookIdx]
  const hasRange = endVerse.trim() !== ''
  const ref = endVerse.trim()
    ? `${book.abbr} ${chapter}:${startVerse}-${endVerse}`
    : startVerse.trim()
    ? `${book.abbr} ${chapter}:${startVerse}`
    : `${book.abbr} ${chapter}`

  function copyRef() {
    navigator.clipboard.writeText(ref).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="bg-[rgb(var(--color-surface-3))] rounded-xl border border-[rgb(var(--color-surface-4))] p-4 space-y-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))]">Verse builder</p>
      <div className="space-y-2">
        <div className="flex gap-2 items-center">
          <span className="text-[10px] text-[rgb(var(--color-text-muted))] w-12 flex-shrink-0">Book</span>
          <select
            value={bookIdx}
            onChange={(e) => { setBookIdx(Number(e.target.value)); setChapter('1'); setStartVerse('1'); setEndVerse('') }}
            className="flex-1 bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] text-xs px-2 py-1.5 rounded-lg outline-none cursor-pointer min-w-0"
          >
            {flatBooks.map((b, i) => (
              <option key={b.id} value={i}>{b.name}</option>
            ))}
          </select>
        </div>
        <div className="flex gap-2 items-center">
          <span className="text-[10px] text-[rgb(var(--color-text-muted))] w-12 flex-shrink-0">Chapter</span>
          <input
            type="number" min={1} value={chapter}
            onChange={(e) => setChapter(e.target.value)}
            className="w-20 bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] text-xs px-2 py-1.5 rounded-lg outline-none"
          />
        </div>
        <div className="flex gap-2 items-center">
          <span className="text-[10px] text-[rgb(var(--color-text-muted))] w-12 flex-shrink-0">Verse</span>
          <input
            type="number" min={1} placeholder="start" value={startVerse}
            onChange={(e) => setStartVerse(e.target.value)}
            className="w-20 bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] text-xs px-2 py-1.5 rounded-lg outline-none placeholder:text-[rgb(var(--color-text-muted))]"
          />
          <span className="text-[10px] text-[rgb(var(--color-text-muted))]">–</span>
          <input
            type="number" min={1} placeholder="end (optional)" value={endVerse}
            onChange={(e) => setEndVerse(e.target.value)}
            className="w-32 bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] text-xs px-2 py-1.5 rounded-lg outline-none placeholder:text-[rgb(var(--color-text-muted))]"
          />
        </div>
      </div>
      {/* Preview + copy */}
      <div className="flex items-center gap-2 pt-1">
        <code className="flex-1 text-xs font-mono px-3 py-2 rounded-lg bg-[rgb(var(--color-surface-1))] text-[rgb(var(--color-accent))] border border-[rgb(var(--color-surface-4))]">
          {ref}
        </code>
        <button
          onClick={copyRef}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-medium bg-[rgb(var(--color-accent))/15] text-[rgb(var(--color-accent))] hover:bg-[rgb(var(--color-accent))/25] transition-colors cursor-pointer flex-shrink-0"
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className="text-[10px] text-[rgb(var(--color-text-muted))]">
        Paste this into any note — it will auto-detect as a clickable reference.
      </p>
    </div>
  )
}

// ── All books view ─────────────────────────────────────────────────────────────

function AllBooksView() {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    if (!query.trim()) return BOOK_GROUPS
    const q = query.toLowerCase()
    return BOOK_GROUPS
      .map((g) => ({
        ...g,
        books: g.books.filter(
          (b) =>
            b.name.toLowerCase().includes(q) ||
            b.abbr.toLowerCase().includes(q) ||
            b.id.toLowerCase().includes(q) ||
            g.group.toLowerCase().includes(q)
        ),
      }))
      .filter((g) => g.books.length > 0)
  }, [query])

  const totalBooks = filtered.reduce((sum, g) => sum + g.books.length, 0)

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Search + stats */}
      <div className="px-5 pt-4 pb-3 border-b border-[rgb(var(--color-surface-4))] space-y-3 flex-shrink-0">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[rgb(var(--color-text-muted))]" />
          <input
            autoFocus
            type="text"
            placeholder="Search books…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] text-xs pl-7 pr-3 py-2 rounded-lg outline-none placeholder:text-[rgb(var(--color-text-muted))]"
          />
        </div>
        <p className="text-[10px] text-[rgb(var(--color-text-muted))]">
          {totalBooks} {totalBooks === 1 ? 'book' : 'books'} · type any name or abbreviation in your note to create a clickable link
        </p>
      </div>

      {/* Book list */}
      <div className="flex-1 overflow-y-auto px-5 py-3 space-y-5">
        {/* Verse builder at the top */}
        {!query && <VerseBuilder />}

        {filtered.length === 0 ? (
          <p className="text-xs text-[rgb(var(--color-text-muted))] text-center py-6">No books match "{query}"</p>
        ) : (
          filtered.map((group) => (
            <div key={group.group}>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))] mb-1.5">{group.group}</p>
              <div className="grid grid-cols-1 gap-0.5">
                {group.books.map((book) => {
                  const exRef = `${book.abbr} ${book.exampleChapter}:${book.exampleVerse}`
                  return (
                    <div
                      key={book.id}
                      className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-[rgb(var(--color-surface-4))] transition-colors group"
                    >
                      <span className="text-xs text-[rgb(var(--color-text-primary))] w-44 flex-shrink-0 truncate">{book.name}</span>
                      <code className="text-[10px] font-mono text-[rgb(var(--color-text-muted))] bg-[rgb(var(--color-surface-4))] px-1.5 py-0.5 rounded flex-shrink-0 group-hover:bg-[rgb(var(--color-surface-2))]">
                        {book.abbr}
                      </code>
                      <span className="text-[10px] text-[rgb(var(--color-text-muted))] flex-shrink-0">e.g.</span>
                      <code className="text-[10px] font-mono text-[rgb(var(--color-accent))] flex-shrink-0">{exRef}</code>
                    </div>
                  )
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ── Main modal ────────────────────────────────────────────────────────────────

export default function MarkdownReferenceModal() {
  const open = useAppStore((s) => s.markdownReferenceOpen)
  const close = useAppStore((s) => s.closeMarkdownReference)
  const [selected, setSelected] = useState<RefItem | null>(null)
  const [allBooksOpen, setAllBooksOpen] = useState(false)

  function handleClose() {
    close()
    setSelected(null)
    setAllBooksOpen(false)
  }

  function goBack() {
    if (allBooksOpen) {
      setAllBooksOpen(false)
    } else {
      setSelected(null)
    }
  }

  const showBack = selected !== null
  const title = allBooksOpen
    ? 'All supported books'
    : selected
    ? selected.label
    : 'Markdown reference'

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content
          aria-describedby={undefined}
          className="
            fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
            z-50 w-full max-w-2xl max-h-[84vh]
            bg-[rgb(var(--color-surface-2))] border border-[rgb(var(--color-surface-4))]
            rounded-xl shadow-2xl overflow-hidden flex flex-col
          "
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-[rgb(var(--color-surface-4))] flex-shrink-0">
            <div className="flex items-center gap-2">
              {showBack && (
                <button
                  onClick={goBack}
                  className="p-1 rounded text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
                >
                  <ArrowLeft size={15} />
                </button>
              )}
              <Dialog.Title className="text-sm font-semibold text-[rgb(var(--color-text-primary))]">
                {title}
              </Dialog.Title>
            </div>
            <button
              onClick={handleClose}
              className="p-1 rounded text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden flex flex-col min-h-0">
            {allBooksOpen ? (
              <AllBooksView />
            ) : selected ? (
              <div className="flex-1 overflow-y-auto">
                <DetailView item={selected} onOpenAllBooks={() => setAllBooksOpen(true)} />
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto">
                <IndexView onSelect={setSelected} />
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ── Index view ─────────────────────────────────────────────────────────────────

function IndexView({ onSelect }: { onSelect: (item: RefItem) => void }) {
  return (
    <div className="p-4 grid grid-cols-2 gap-2">
      {REFERENCE_ITEMS.map((item) => (
        <button
          key={item.id}
          onClick={() => onSelect(item)}
          className="text-left flex items-start gap-3 p-3 rounded-lg bg-[rgb(var(--color-surface-3))] hover:bg-[rgb(var(--color-surface-4))] transition-colors cursor-pointer group"
        >
          <code className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[rgb(var(--color-surface-1))] text-[rgb(var(--color-accent))] flex-shrink-0 mt-0.5 group-hover:bg-[rgb(var(--color-surface-4))]">
            {item.syntax.split('\n')[0]}
          </code>
          <div className="min-w-0">
            <p className="text-xs font-medium text-[rgb(var(--color-text-primary))] truncate">{item.label}</p>
            <p className="text-[10px] text-[rgb(var(--color-text-muted))] mt-0.5 line-clamp-2">{item.description}</p>
          </div>
        </button>
      ))}
    </div>
  )
}

// ── Detail view ────────────────────────────────────────────────────────────────

function DetailView({ item, onOpenAllBooks }: { item: RefItem; onOpenAllBooks: () => void }) {
  return (
    <div className="px-6 py-5 space-y-5">
      {/* Syntax */}
      <div>
        <p className="text-[10px] font-semibold text-[rgb(var(--color-text-muted))] uppercase tracking-wider mb-2">Syntax</p>
        <code className="block px-3 py-2 rounded-lg bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-accent))] text-sm font-mono whitespace-pre-wrap">
          {item.syntax}
        </code>
      </div>

      {/* What it does */}
      <div>
        <p className="text-[10px] font-semibold text-[rgb(var(--color-text-muted))] uppercase tracking-wider mb-2">What it does</p>
        <p className="text-sm text-[rgb(var(--color-text-secondary))] leading-relaxed">{item.description}</p>
      </div>

      {/* Why use it */}
      <div>
        <p className="text-[10px] font-semibold text-[rgb(var(--color-text-muted))] uppercase tracking-wider mb-2">Why use it</p>
        <p className="text-sm text-[rgb(var(--color-text-secondary))] leading-relaxed">{item.why}</p>
      </div>

      {/* Examples */}
      <div>
        <p className="text-[10px] font-semibold text-[rgb(var(--color-text-muted))] uppercase tracking-wider mb-2">Examples</p>
        <div className="space-y-2">
          {item.examples.map((ex, i) => (
            <div key={i} className="rounded-lg bg-[rgb(var(--color-surface-3))] overflow-hidden">
              <div className="px-3 py-2 border-b border-[rgb(var(--color-surface-4))]">
                <p className="text-[9px] font-semibold text-[rgb(var(--color-text-muted))] uppercase tracking-wider mb-1">You type</p>
                <code className="text-xs font-mono text-[rgb(var(--color-text-primary))] whitespace-pre-wrap">{ex.input}</code>
              </div>
              <div className="px-3 py-2">
                <p className="text-[9px] font-semibold text-[rgb(var(--color-text-muted))] uppercase tracking-wider mb-1">Result</p>
                <p className="text-xs text-[rgb(var(--color-text-secondary))] whitespace-pre-wrap">{ex.output}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* "All supported books" call-to-action — only for bible-ref item */}
      {item.hasAllBooksPanel && (
        <button
          onClick={onOpenAllBooks}
          className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-[rgb(var(--color-surface-3))] border border-[rgb(var(--color-surface-4))] hover:bg-[rgb(var(--color-surface-4))] transition-colors cursor-pointer group"
        >
          <div className="text-left">
            <p className="text-xs font-medium text-[rgb(var(--color-text-primary))]">All supported books</p>
            <p className="text-[10px] text-[rgb(var(--color-text-muted))] mt-0.5">
              Browse every book · search by name or abbreviation · build a verse reference
            </p>
          </div>
          <ArrowLeft size={14} className="rotate-180 text-[rgb(var(--color-text-muted))] group-hover:text-[rgb(var(--color-accent))] transition-colors flex-shrink-0 ml-3" />
        </button>
      )}

      {/* Notes */}
      {item.notes && (
        <div className="px-3 py-2 rounded-lg bg-[rgb(var(--color-accent))/8] border border-[rgb(var(--color-accent))/20]">
          <p className="text-xs text-[rgb(var(--color-text-secondary))] leading-relaxed">{item.notes}</p>
        </div>
      )}
    </div>
  )
}
