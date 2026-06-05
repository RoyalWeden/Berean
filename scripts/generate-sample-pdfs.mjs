#!/usr/bin/env node
/**
 * Generate sample note PDFs to visually verify print/PDF formatting.
 *
 * It imports the REAL buildPrintHTML / renderPreviewContent from the app source
 * (via a tiny esbuild bundle so TS + the marked dep resolve), writes the HTML for
 * a handful of representative notes, then renders each to PDF with headless Chrome.
 *
 * Output: ./sample-pdfs/*.html and ./sample-pdfs/*.pdf
 *
 * Usage:  node scripts/generate-sample-pdfs.mjs
 */
import { mkdirSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execFileSync } from 'child_process'
import { build } from 'esbuild'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const outDir = join(root, 'sample-pdfs')
mkdirSync(outDir, { recursive: true })

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

// ── Bundle the real buildPrintHTML from the app source ────────────────────────
// We stub the zustand store so noteScriptureBlock is ON for the samples.
const entry = `
import { buildPrintHTML } from '${join(root, 'src/components/notes/NoteEditor.tsx').replace(/\\/g, '/')}'
import { useAppStore } from '${join(root, 'src/store/index.ts').replace(/\\/g, '/')}'
useAppStore.setState({ noteScriptureBlock: true, noteScriptureBlockThreshold: 0 })
globalThis.__buildPrintHTML = buildPrintHTML
`
const tmpEntry = join(outDir, '_entry.mjs')
writeFileSync(tmpEntry, entry)

const result = await build({
  entryPoints: [tmpEntry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  loader: { '.tsx': 'tsx', '.ts': 'ts' },
  define: { 'import.meta.env': '{}' },
  // Stub the React-only / electron-only imports the editor pulls in but we don't execute.
  external: [],
  jsx: 'automatic',
  logLevel: 'error',
})

// Evaluate the bundle to get buildPrintHTML
const dataUrl = 'data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64')
await import(dataUrl)
const buildPrintHTML = globalThis.__buildPrintHTML

// ── Sample notes ──────────────────────────────────────────────────────────────
const samples = [
  {
    name: '01-springtime-june',
    title: 'Springtime June',
    opts: {},
    content: `# Noah

## The Covenant with Noah

Jubilees 6:1-4
1 And **<u>*on the new moon of the third month*</u>** he went forth from the ark, and built an altar on that mountain.
2 And he made atonement for the earth, and took a kid and made atonement by its blood for all the guilt of the earth; for everything that had been on it had been destroyed, save those that were in the ark with Noah.
3 And he placed the fat thereof on the altar, and he took an ox, and a goat, and a sheep and kids, and salt, and a turtle-dove, and the young of a dove, and placed a burnt sacrifice on the altar.
4 And the Lord smelt the goodly savour, and He made a covenant with him that there should not be any more a flood to destroy the earth.

# Abraham

## The Covenant with Abraham

Jubilees 14:1 After these things, in the fourth year of this week, on the new moon of the third month, the word of the Lord came to Abram in a dream, saying: 'Fear not, Abram; I am thy defender, and thy reward will be exceeding great.'`,
  },
  {
    name: '02-formatting-showcase',
    title: 'Formatting Showcase',
    opts: { marginPreset: 'normal', fontSize: 12, fontFamily: 'system' },
    content: `# Formatting Showcase

This note exercises **every** supported element.

## Text styles

**Bold**, *italic*, ***bold italic***, <u>underline</u>, ~~strikethrough~~,
==highlighted==, and \`inline code\`.

## Lists

1. First ordered
2. Second ordered

- Dash bullet one
- Dash bullet *two*

- [ ] Unchecked task
- [x] Completed task

## Blockquote & callouts

> A plain blockquote with **bold** inside.

> [!NOTE] Remember
> Keep the **Sabbath** holy — see Exodus 20:8.

> [!WARNING] Caution
> Do not add to the words.

## Table

| Reference | Topic |
|-----------|-------|
| Deut 6:4 | Shema |
| Exo 20:3 | First commandment |

## Code

\`\`\`
let x = 'this is a code block'
\`\`\`

---

*End of showcase.*`,
  },
  {
    name: '03-scripture-study',
    title: 'Scripture Study — Grace',
    opts: { marginPreset: 'wide', fontFamily: 'serif', fontSize: 13 },
    content: `# Grace — Divine Influence

Titus 2:11-14
11 For the **grace** of Yehovah that bringeth salvation hath appeared to all men
12 Teaching us that, denying ungodliness and worldly lusts, we should live *soberly*
13 Looking for that blessed hope
14 Who gave himself for us, that he might <u>redeem us</u> from all iniquity

## Notes

Grace = ==divine influence upon the heart==, not unmerited favour.

> [!NOTE] Cross-reference
> Compare with [[Romans 6:14]] and the refreshing of the covenant.

John 14:15 If ye love me, keep my commandments`,
  },
  {
    name: '04-grayscale-narrow',
    title: 'Grayscale Narrow',
    opts: { marginPreset: 'narrow', colorMode: 'grayscale', fontSize: 11 },
    content: `# Grayscale Test

Genesis 1:1 In the **beginning** Yehovah created the heavens and the earth

This page is rendered in grayscale with narrow margins.

> [!TIP] Print tip
> Grayscale saves color ink.`,
  },
  {
    name: '05-no-title-large',
    title: 'No Title Large Font',
    opts: { includeTitle: false, fontSize: 16, fontFamily: 'sansserif' },
    content: `## Large Font, No Document Title

The note title is omitted from the printed output here, and the font is 16pt sans-serif.

- Easy to read
- Good for **presentations**

Exodus 20:8 Remember the sabbath day, to keep it holy`,
  },
]

// Theme showcase — same note rendered in every theme
const THEME_NOTE = `# Theme Showcase

This sample shows the **same note** in each theme.

Genesis 1:1-3
1 In the **beginning** Yehovah created the heaven and the earth
2 And the earth was *without form, and void*
3 And Yehovah said, <u>Let there be light</u>: and there was light

## Notes

Grace = ==divine influence upon the heart==.

> [!NOTE] Reminder
> Keep the **Sabbath** holy — see Exodus 20:8.

- [x] Read Genesis 1
- [ ] Study the creation account`

const ALL_THEMES = [
  'classic', 'manuscript', 'minimal', 'ocean', 'night',
  'parchment', 'forest', 'royal', 'ember', 'arctic',
  'slate', 'rose', 'dawn', 'midnight', 'ivory',
]
for (const theme of ALL_THEMES) {
  samples.push({
    name: `06-theme-${theme}`,
    title: `Theme — ${theme}`,
    opts: { theme, fontFamily: { manuscript: 'serif', ocean: 'sansserif' }[theme] ?? 'system' },
    content: THEME_NOTE,
  })
}

// Margin comparison — same note at each margin preset
for (const margin of ['none', 'narrow', 'normal', 'wide']) {
  samples.push({
    name: `07-margin-${margin}`,
    title: `Margin — ${margin}`,
    opts: { marginPreset: margin, theme: 'classic' },
    content: THEME_NOTE,
  })
}

// Custom asymmetric margins: small top, large left, medium right, small bottom
samples.push({
  name: '08-margin-custom',
  title: 'Margin — custom (top .25, right 1, bottom .5, left 2)',
  opts: { marginPreset: 'custom', customMargins: { top: 0.25, right: 1, bottom: 0.5, left: 2 }, theme: 'classic' },
  content: THEME_NOTE,
})

const pdfPaths = []
for (const s of samples) {
  const htmlDoc = buildPrintHTML(s.title, s.content, s.opts)
  const htmlPath = join(outDir, `${s.name}.html`)
  const pdfPath = join(outDir, `${s.name}.pdf`)
  writeFileSync(htmlPath, htmlDoc)
  // Render to PDF with headless Chrome
  execFileSync(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--no-pdf-header-footer',
    `--print-to-pdf=${pdfPath}`,
    `file://${htmlPath}`,
  ], { stdio: 'pipe' })
  pdfPaths.push(pdfPath)
  console.log(`✓ ${s.name}.pdf`)
}

console.log(`\nGenerated ${pdfPaths.length} sample PDFs in ${outDir}`)
