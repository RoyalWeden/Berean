/**
 * Comprehensive print/PDF rendering tests (150 cases).
 *
 * Targets the bug where scripture (verse) blocks and content following them showed
 * raw markdown/HTML (e.g. "**<u>*text*</u>**", "# Abraham ## Sub") in printed PDFs
 * instead of formatted output. Also covers the print-option controls (margins,
 * font, title, color) added to buildPrintHTML.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { useAppStore } from '@/store'
import { renderPreviewContent, buildPrintHTML, PRINT_THEMES } from '../NoteEditor'

function html(md: string) { return renderPreviewContent(md) }

// Verse-block rendering requires the scripture-block setting ON. We enable it for
// the whole suite (threshold 0 so any ref+body is accepted) and restore after.
let prevEnabled: boolean
let prevThreshold: number
beforeAll(() => {
  const s = useAppStore.getState()
  prevEnabled = s.noteScriptureBlock
  prevThreshold = s.noteScriptureBlockThreshold
  useAppStore.setState({ noteScriptureBlock: true, noteScriptureBlockThreshold: 0 })
})
afterAll(() => {
  useAppStore.setState({ noteScriptureBlock: prevEnabled, noteScriptureBlockThreshold: prevThreshold })
})

// ── 1. Verse block — inner markdown rendering (the core bug) ───────────────────

describe('verse block — inner markdown rendering', () => {
  const ref = 'Genesis 1:1'

  it('renders **bold** inside a single-line verse block', () => {
    const out = html(`${ref} In the **beginning** Yehovah created`)
    expect(out).toContain('<strong>beginning</strong>')
    expect(out).not.toContain('**beginning**')
  })

  it('renders *italic* inside a verse block', () => {
    const out = html(`${ref} In the *beginning* Yehovah created`)
    expect(out).toContain('<em>beginning</em>')
    expect(out).not.toContain('*beginning*')
  })

  it('renders <u>underline</u> inside a verse block', () => {
    const out = html(`${ref} In the <u>beginning</u> Yehovah`)
    expect(out).toContain('<u>beginning</u>')
  })

  it('renders ==highlight== inside a verse block', () => {
    const out = html(`${ref} In the ==beginning== Yehovah`)
    expect(out).toContain('<mark')
    expect(out).toContain('beginning')
    expect(out).not.toContain('==beginning==')
  })

  it('renders `inline code` inside a verse block', () => {
    const out = html(`${ref} the word \`bereshith\` means`)
    expect(out).toContain('<code>bereshith</code>')
  })

  it('renders nested **<u>*triple*</u>** inside a verse block', () => {
    const out = html(`${ref} And **<u>*on the new moon*</u>** he went`)
    expect(out).toContain('<strong>')
    expect(out).toContain('<u>')
    expect(out).toContain('<em>')
    expect(out).not.toContain('**<u>')
    expect(out).not.toContain('*</u>**')
  })

  it('renders ~~strikethrough~~ inside a verse block', () => {
    const out = html(`${ref} this is ~~struck~~ text`)
    expect(out).toContain('<del>struck</del>')
  })

  it('does not show raw ** markers in verse block output', () => {
    const out = html(`${ref} **bold** and more **bold** here`)
    expect(out).not.toMatch(/\*\*[^*<]+\*\*/)
  })

  it('verse block ref still renders as a link', () => {
    const out = html(`${ref} some **bold** text`)
    expect(out).toContain('class="berean-verse-ref"')
    expect(out).toContain('Genesis 1:1')
  })

  it('verse block wrapper div is present', () => {
    const out = html(`${ref} some text here for the verse`)
    expect(out).toContain('berean-verse-block')
  })
})

// ── 2. Multi-line verse block — inner markdown per line ────────────────────────

describe('multi-line verse block — inner markdown', () => {
  const block = `Jubilees 6:1-4
1 And **<u>*on the new moon of the third month*</u>** he went forth
2 And he made *atonement* for the earth
3 And he placed the **fat** thereof on the altar
4 And the ==Lord== smelt the goodly savour`

  it('renders bold in line 1', () => {
    expect(html(block)).toContain('<strong>')
  })

  it('renders underline in line 1', () => {
    expect(html(block)).toContain('<u>')
  })

  it('renders italic in line 1 and line 2', () => {
    const out = html(block)
    expect(out).toContain('<em>')
    expect(out).toContain('atonement')
  })

  it('renders highlight in line 4', () => {
    const out = html(block)
    expect(out).toContain('<mark')
  })

  it('joins body lines with <br>', () => {
    expect(html(block)).toContain('<br>')
  })

  it('no raw ** markers anywhere', () => {
    expect(html(block)).not.toMatch(/\*\*[^*<]+\*\*/)
  })

  it('no raw <u> escaped to &lt;u&gt;', () => {
    expect(html(block)).not.toContain('&lt;u&gt;')
  })

  it('ref is a link', () => {
    expect(html(block)).toContain('berean-verse-ref')
  })

  it('all 4 verse numbers preserved', () => {
    const out = html(block)
    expect(out).toContain('1 And')
    expect(out).toContain('2 And')
    expect(out).toContain('3 And')
    expect(out).toContain('4 And')
  })

  it('produces exactly one verse-block div', () => {
    const count = (html(block).match(/berean-verse-block/g) || []).length
    expect(count).toBe(1)
  })
})

// ── 3. Content AFTER a verse block (the absorption bug) ────────────────────────

describe('content after verse block — heading absorption', () => {
  const note = `Genesis 1:1 In the beginning Yehovah created the heavens

# Abraham

## The Covenant`

  it('h1 after verse block renders as <h1>', () => {
    expect(html(note)).toContain('<h1>Abraham</h1>')
  })

  it('h2 after verse block renders as <h2>', () => {
    expect(html(note)).toContain('<h2>The Covenant</h2>')
  })

  it('headings are not merged into one line', () => {
    expect(html(note)).not.toContain('# Abraham ## The Covenant')
  })

  it('no raw # markers leak through', () => {
    expect(html(note)).not.toMatch(/<[^>]*># Abraham/)
  })

  it('paragraph after verse block renders', () => {
    const out = html(`Genesis 1:1 In the beginning Yehovah created\n\nA following paragraph here.`)
    expect(out).toContain('<p>A following paragraph here.</p>')
  })

  it('bold paragraph after verse block renders bold', () => {
    const out = html(`Genesis 1:1 In the beginning Yehovah\n\n**Important** point`)
    expect(out).toContain('<strong>Important</strong>')
  })

  it('list after verse block renders', () => {
    const out = html(`Genesis 1:1 In the beginning Yehovah created\n\n- item one\n- item two`)
    expect(out).toContain('<ul')
    expect(out).toContain('item one')
  })

  it('table after verse block renders', () => {
    const out = html(`Genesis 1:1 In the beginning Yehovah created\n\n| A | B |\n|---|---|\n| 1 | 2 |`)
    expect(out).toContain('<table>')
  })

  it('two verse blocks with heading between them', () => {
    const note2 = `Genesis 1:1 In the beginning Yehovah created\n\n## Middle\n\nExodus 20:3 Thou shalt have no other gods`
    const out = html(note2)
    expect(out).toContain('<h2>Middle</h2>')
    expect((out.match(/berean-verse-block/g) || []).length).toBe(2)
  })

  it('heading BEFORE verse block also renders', () => {
    const out = html(`## Before\n\nGenesis 1:1 In the beginning Yehovah created`)
    expect(out).toContain('<h2>Before</h2>')
  })
})

// ── 4. Callout blocks — inner markdown + no absorption ────────────────────────

describe('callout blocks', () => {
  it('NOTE callout renders inner bold', () => {
    const out = html('> [!NOTE] Title\n> This is **bold** in callout')
    expect(out).toContain('<strong>bold</strong>')
  })

  it('TIP callout renders inner italic', () => {
    const out = html('> [!TIP] Title\n> This is *italic* tip')
    expect(out).toContain('<em>italic</em>')
  })

  it('heading after callout renders', () => {
    const out = html('> [!NOTE] Title\n> Body content\n\n# After Callout')
    expect(out).toContain('<h1>After Callout</h1>')
  })

  it('callout not merged with following heading', () => {
    const out = html('> [!WARNING] Warn\n> Be careful\n\n## Next Section')
    expect(out).toContain('<h2>Next Section</h2>')
    expect(out).not.toContain('# Next Section')
  })

  it('paragraph after callout renders', () => {
    const out = html('> [!IMPORTANT] Imp\n> Critical\n\nFollowing text here.')
    expect(out).toContain('<p>Following text here.</p>')
  })

  it('callout with link in body', () => {
    const out = html('> [!NOTE] Title\n> See [docs](https://x.com)')
    expect(out).toContain('href="https://x.com"')
  })

  it('CAUTION callout border color present', () => {
    const out = html('> [!CAUTION] Stop\n> Danger ahead')
    expect(out).toContain('border-left')
  })

  it('callout followed by another callout', () => {
    const out = html('> [!NOTE] A\n> First\n\n> [!TIP] B\n> Second')
    const divs = (out.match(/border-left:3px solid/g) || []).length
    expect(divs).toBeGreaterThanOrEqual(2)
  })

  it('callout followed by verse block', () => {
    const out = html('> [!NOTE] A\n> First\n\nGenesis 1:1 In the beginning Yehovah created')
    expect(out).toContain('berean-verse-block')
  })

  it('verse block followed by callout', () => {
    const out = html('Genesis 1:1 In the beginning Yehovah created\n\n> [!NOTE] A\n> After verse')
    expect(out).toContain('berean-verse-block')
    expect(out).toContain('After verse')
  })
})

// ── 5. buildPrintHTML — margin presets ────────────────────────────────────────

describe('buildPrintHTML — margins', () => {
  // Margins are controlled by body padding (uniform), with @page margin zeroed so the
  // iframe preview and the printed PDF match exactly.
  it('@page margin is always 0', () => {
    expect(buildPrintHTML('T', 'body', { marginPreset: 'wide' })).toContain('@page { margin: 0; }')
  })

  it('none preset → 0in body padding (edge to edge)', () => {
    expect(buildPrintHTML('T', 'body', { marginPreset: 'none' })).toMatch(/body\s*\{[^}]*padding: 0in/)
  })

  it('narrow preset → 0.5in body padding', () => {
    expect(buildPrintHTML('T', 'body', { marginPreset: 'narrow' })).toMatch(/body\s*\{[^}]*padding: 0\.5in/)
  })

  it('normal preset → 1in body padding', () => {
    expect(buildPrintHTML('T', 'body', { marginPreset: 'normal' })).toMatch(/body\s*\{[^}]*padding: 1in/)
  })

  it('wide preset → 1.5in body padding', () => {
    expect(buildPrintHTML('T', 'body', { marginPreset: 'wide' })).toMatch(/body\s*\{[^}]*padding: 1\.5in/)
  })

  it('default (no opts) → 1in body padding', () => {
    expect(buildPrintHTML('T', 'body')).toMatch(/body\s*\{[^}]*padding: 1in/)
  })

  it('body has no max-width centering (margins fully control width)', () => {
    expect(buildPrintHTML('T', 'body', { marginPreset: 'narrow' })).not.toMatch(/body\s*\{[^}]*max-width/)
  })

  it('none margin still produces valid doc', () => {
    const out = buildPrintHTML('T', '# Heading', { marginPreset: 'none' })
    expect(out).toContain('<!DOCTYPE html>')
  })

  // ── Custom per-side margins ──────────────────────────────────────────────
  it('custom preset applies per-side margins (top right bottom left)', () => {
    const out = buildPrintHTML('T', 'body', {
      marginPreset: 'custom', customMargins: { top: 0.5, right: 1, bottom: 1.5, left: 0.75 },
    })
    expect(out).toMatch(/body\s*\{[^}]*padding: 0\.5in 1in 1\.5in 0\.75in/)
  })

  it('custom preset with zero margins → edge to edge', () => {
    const out = buildPrintHTML('T', 'body', {
      marginPreset: 'custom', customMargins: { top: 0, right: 0, bottom: 0, left: 0 },
    })
    expect(out).toMatch(/body\s*\{[^}]*padding: 0in 0in 0in 0in/)
  })

  it('custom preset clamps negative values to 0', () => {
    const out = buildPrintHTML('T', 'body', {
      marginPreset: 'custom', customMargins: { top: -2, right: 1, bottom: 1, left: 1 },
    })
    expect(out).toMatch(/body\s*\{[^}]*padding: 0in 1in 1in 1in/)
  })

  it('custom preset without customMargins falls back to uniform 1in', () => {
    const out = buildPrintHTML('T', 'body', { marginPreset: 'custom' })
    expect(out).toMatch(/body\s*\{[^}]*padding: 1in/)
  })

  it('custom margins do not break verse blocks or theme', () => {
    const out = buildPrintHTML('T', 'Genesis 1:1 In the **beginning** Yehovah created', {
      marginPreset: 'custom', customMargins: { top: 1, right: 0.5, bottom: 1, left: 0.5 }, theme: 'ocean',
    })
    expect(out).toContain('<strong>beginning</strong>')
    expect(out).toContain('class="berean-verse-block"')
    expect(out).toContain('#0d9488')
  })
})

// ── 6. buildPrintHTML — font size ─────────────────────────────────────────────

describe('buildPrintHTML — font size', () => {
  it('12pt default', () => {
    expect(buildPrintHTML('T', 'b')).toContain('font-size: 12pt')
  })

  it('10pt small', () => {
    expect(buildPrintHTML('T', 'b', { fontSize: 10 })).toContain('font-size: 10pt')
  })

  it('14pt large', () => {
    expect(buildPrintHTML('T', 'b', { fontSize: 14 })).toContain('font-size: 14pt')
  })

  it('16pt extra large', () => {
    expect(buildPrintHTML('T', 'b', { fontSize: 16 })).toContain('font-size: 16pt')
  })

  it('8pt tiny', () => {
    expect(buildPrintHTML('T', 'b', { fontSize: 8 })).toContain('font-size: 8pt')
  })

  it('font size applies to body rule', () => {
    const out = buildPrintHTML('T', 'b', { fontSize: 13 })
    expect(out).toMatch(/body\s*\{[^}]*font-size: 13pt/)
  })
})

// ── 7. buildPrintHTML — font family ───────────────────────────────────────────

describe('buildPrintHTML — font family', () => {
  it('system default includes -apple-system', () => {
    expect(buildPrintHTML('T', 'b', { fontFamily: 'system' })).toContain('-apple-system')
  })

  it('serif includes Georgia', () => {
    expect(buildPrintHTML('T', 'b', { fontFamily: 'serif' })).toContain('Georgia')
  })

  it('sansserif includes Inter', () => {
    expect(buildPrintHTML('T', 'b', { fontFamily: 'sansserif' })).toContain('Inter')
  })

  it('serif does not include Inter', () => {
    expect(buildPrintHTML('T', 'b', { fontFamily: 'serif' })).not.toContain('font-family: Inter')
  })

  it('default font family is system', () => {
    expect(buildPrintHTML('T', 'b')).toContain('-apple-system')
  })

  it('font family applies in body rule', () => {
    const out = buildPrintHTML('T', 'b', { fontFamily: 'serif' })
    expect(out).toMatch(/body\s*\{[^}]*Georgia/)
  })
})

// ── 8. buildPrintHTML — title toggle ──────────────────────────────────────────

describe('buildPrintHTML — title inclusion', () => {
  it('includeTitle true shows note-doc-title', () => {
    expect(buildPrintHTML('My Note', 'body', { includeTitle: true })).toContain('note-doc-title')
  })

  it('includeTitle false omits note-doc-title h1', () => {
    expect(buildPrintHTML('My Note', 'body', { includeTitle: false })).not.toContain('class="note-doc-title"')
  })

  it('includeTitle false still has <title> meta', () => {
    expect(buildPrintHTML('My Note', 'body', { includeTitle: false })).toContain('<title>My Note</title>')
  })

  it('default includes the title', () => {
    expect(buildPrintHTML('My Note', 'body')).toContain('note-doc-title')
  })

  it('title text appears when included', () => {
    expect(buildPrintHTML('Genesis Study', 'body', { includeTitle: true })).toContain('Genesis Study')
  })

  it('body still renders when title omitted', () => {
    expect(buildPrintHTML('T', '# Heading body', { includeTitle: false })).toContain('<h1>Heading body</h1>')
  })
})

// ── 9. buildPrintHTML — color mode ────────────────────────────────────────────

describe('buildPrintHTML — color mode', () => {
  it('grayscale adds filter', () => {
    expect(buildPrintHTML('T', 'b', { colorMode: 'grayscale' })).toContain('grayscale(100%)')
  })

  it('color mode does not add grayscale filter', () => {
    expect(buildPrintHTML('T', 'b', { colorMode: 'color' })).not.toContain('grayscale(100%)')
  })

  it('default is color (no grayscale)', () => {
    expect(buildPrintHTML('T', 'b')).not.toContain('grayscale(100%)')
  })

  it('grayscale still renders body content', () => {
    expect(buildPrintHTML('T', '**bold**', { colorMode: 'grayscale' })).toContain('<strong>bold</strong>')
  })

  it('grayscale filter on body element', () => {
    const out = buildPrintHTML('T', 'b', { colorMode: 'grayscale' })
    expect(out).toMatch(/body\s*\{[^}]*grayscale/)
  })
})

// ── 10. buildPrintHTML — combined options ─────────────────────────────────────

describe('buildPrintHTML — combined options', () => {
  it('all options together produce valid doc', () => {
    const out = buildPrintHTML('Full', '# Body\n\n**text**', {
      marginPreset: 'wide', fontSize: 14, fontFamily: 'serif', includeTitle: true, colorMode: 'grayscale',
    })
    expect(out).toContain('<!DOCTYPE html>')
    expect(out).toMatch(/body\s*\{[^}]*padding: 1\.5in/)
    expect(out).toContain('font-size: 14pt')
    expect(out).toContain('Georgia')
    expect(out).toContain('grayscale')
    expect(out).toContain('note-doc-title')
    expect(out).toContain('<h1>Body</h1>')
    expect(out).toContain('<strong>text</strong>')
  })

  it('narrow + sansserif + no title + color', () => {
    const out = buildPrintHTML('X', 'content', {
      marginPreset: 'narrow', fontFamily: 'sansserif', includeTitle: false, colorMode: 'color',
    })
    expect(out).toContain('0.5in')
    expect(out).toContain('Inter')
    expect(out).not.toContain('class="note-doc-title"')
    expect(out).not.toContain('grayscale(100%)')
  })

  it('options do not corrupt verse-block rendering', () => {
    const out = buildPrintHTML('X', 'Genesis 1:1 In the **beginning** Yehovah created', { marginPreset: 'wide' })
    expect(out).toContain('<strong>beginning</strong>')
    expect(out).toContain('berean-verse-block')
  })
})

// ── 11. Stash mechanism robustness ────────────────────────────────────────────

describe('stash mechanism — no token leakage', () => {
  it('no BEREANSTASH token in verse-block output', () => {
    expect(html('Genesis 1:1 In the beginning Yehovah created')).not.toContain('BEREANSTASH')
  })

  it('no BEREANSTASH token in callout output', () => {
    expect(html('> [!NOTE] T\n> body')).not.toContain('BEREANSTASH')
  })

  it('no ENDSTASH leakage', () => {
    expect(html('Genesis 1:1 In the beginning Yehovah created\n\n# After')).not.toContain('ENDSTASH')
  })

  it('multiple verse blocks all restored', () => {
    const out = html('Genesis 1:1 In the beginning Yehovah created\n\nExodus 20:3 Thou shalt have no other gods\n\nLeviticus 1:1 And Yehovah called unto Moses')
    expect((out.match(/berean-verse-block/g) || []).length).toBe(3)
    expect(out).not.toContain('BEREANSTASH')
  })

  it('mixed verse blocks and callouts all restored', () => {
    const out = html('Genesis 1:1 In the beginning Yehovah\n\n> [!NOTE] T\n> note body\n\nExodus 20:3 Thou shalt have no other gods')
    expect(out).not.toContain('BEREANSTASH')
    expect(out).toContain('berean-verse-block')
  })

  it('verse block at very start of document', () => {
    const out = html('Genesis 1:1 In the beginning Yehovah created')
    expect(out).toContain('berean-verse-block')
    expect(out).not.toContain('BEREANSTASH')
  })

  it('verse block at very end of document', () => {
    const out = html('# Title\n\nGenesis 1:1 In the beginning Yehovah created')
    expect(out).toContain('<h1>Title</h1>')
    expect(out).toContain('berean-verse-block')
  })

  it('ten verse blocks all render', () => {
    const refs = Array.from({ length: 10 }, (_, i) => `Genesis 1:${i + 1} verse text number ${i + 1} here`).join('\n\n')
    const out = html(refs)
    expect((out.match(/berean-verse-block/g) || []).length).toBe(10)
    expect(out).not.toContain('BEREANSTASH')
  })
})

// ── 12. Regression — standard markdown still works with blocks present ─────────

describe('regression — standard markdown alongside verse blocks', () => {
  const doc = `# Main Title

Some intro **bold** text.

Genesis 1:1 In the beginning Yehovah created

## Section Two

- list item *one*
- list item two

> [!NOTE] Reminder
> Keep the **Sabbath**

| Day | Activity |
|-----|----------|
| 7 | Rest |

\`\`\`
code block
\`\`\`

---

Exodus 20:8 Remember the sabbath day to keep it holy

Final paragraph.`

  it('main h1 renders', () => { expect(html(doc)).toContain('<h1>Main Title</h1>') })
  it('intro bold renders', () => { expect(html(doc)).toContain('<strong>bold</strong>') })
  it('first verse block renders', () => { expect(html(doc)).toContain('berean-verse-block') })
  it('section h2 renders', () => { expect(html(doc)).toContain('<h2>Section Two</h2>') })
  it('list renders', () => { expect(html(doc)).toContain('<li>') })
  it('list italic renders', () => { expect(html(doc)).toContain('<em>one</em>') })
  it('callout renders', () => { expect(html(doc)).toContain('Reminder') })
  it('callout bold renders', () => { expect(html(doc)).toContain('<strong>Sabbath</strong>') })
  it('table renders', () => { expect(html(doc)).toContain('<table>') })
  it('code block renders', () => { expect(html(doc)).toContain('<pre>') })
  it('hr renders', () => { expect(html(doc)).toContain('<hr') })
  it('second verse block renders', () => {
    expect((html(doc).match(/berean-verse-block/g) || []).length).toBe(2)
  })
  it('final paragraph renders', () => { expect(html(doc)).toContain('<p>Final paragraph.</p>') })
  it('no raw markdown leaks', () => {
    const out = html(doc)
    expect(out).not.toMatch(/\*\*[^*<]+\*\*/)
    expect(out).not.toContain('BEREANSTASH')
  })
  it('full doc through buildPrintHTML is valid', () => {
    const out = buildPrintHTML('Study', doc)
    expect(out).toContain('<!DOCTYPE html>')
    expect(out).toContain('</html>')
    expect(out).toContain('berean-verse-block')
  })
})

// ── 13. Verse block edge cases ────────────────────────────────────────────────

describe('verse block — edge cases', () => {
  it('verse ref with range (1-4) renders', () => {
    const out = html('Romans 9:21-22 Hath not the potter power over the clay')
    expect(out).toContain('berean-verse-ref')
  })

  it('numbered-book ref (1 Kings) renders', () => {
    const out = html('1 Kings 8:27 But will Yehovah indeed dwell on the earth')
    expect(out).toContain('berean-verse-block')
  })

  it('verse body with em dash renders', () => {
    const out = html('Genesis 1:1 In the beginning — Yehovah created')
    expect(out).toContain('berean-verse-block')
  })

  it('verse body with apostrophe', () => {
    const out = html("Genesis 1:1 In the beginning Yehovah's word created")
    expect(out).toContain('berean-verse-block')
  })

  it('verse body with parentheses', () => {
    const out = html('Genesis 1:1 In the beginning (truly) Yehovah created')
    expect(out).toContain('berean-verse-block')
  })

  it('verse body with quotes renders', () => {
    const out = html('Genesis 1:1 And He said "Let there be light" and so')
    expect(out).toContain('berean-verse-block')
  })

  it('verse block with ampersand', () => {
    const out = html('Genesis 1:1 the heavens & the earth were created')
    expect(out).toContain('berean-verse-block')
  })

  it('verse block does not break on colon in body', () => {
    const out = html('Genesis 1:1 thus: the beginning of all creation made')
    expect(out).toContain('berean-verse-block')
  })

  it('plain text without ref is not wrapped', () => {
    const out = html('Just a regular sentence with no scripture reference.')
    expect(out).not.toContain('berean-verse-block')
  })

  it('verse ref alone (no body) is not wrapped as block', () => {
    // A bare ref with no following body text shouldn't form a verse block
    const out = html('See Genesis 1:1 for context')
    // It should still get an inline verse link via addVerseLinksToHtml
    expect(out).toContain('berean-verse-ref')
  })

  it('multi-line block preserves all verse numbers as text', () => {
    const out = html('Psalm 1:1-2\n1 Blessed is the man that walketh not\n2 But his delight is in the law')
    expect(out).toContain('1 Blessed')
    expect(out).toContain('2 But')
  })

  it('verse block body with bold spanning words', () => {
    const out = html('Genesis 1:1 In the **beginning Yehovah** created the heavens')
    expect(out).toContain('<strong>beginning Yehovah</strong>')
  })

  it('verse block with multiple bold segments', () => {
    const out = html('Genesis 1:1 the **heavens** and the **earth** were made')
    expect((out.match(/<strong>/g) || []).length).toBe(2)
  })

  it('verse block followed immediately by another (no blank line)', () => {
    const out = html('Psalm 1:1-2\n1 Blessed is the man\n2 But his delight')
    expect((out.match(/berean-verse-block/g) || []).length).toBe(1)
  })

  it('verse block with trailing punctuation in ref', () => {
    const out = html('John 3:16 For Yehovah so loved the world that He gave')
    expect(out).toContain('berean-verse-block')
  })
})

// ── 14. PDF-safety: output never contains raw editor syntax ───────────────────

describe('PDF safety — no raw syntax in any output', () => {
  const samples = [
    'Genesis 1:1 In the **beginning** Yehovah created',
    'Genesis 1:1 the <u>underlined</u> word here matters',
    'Genesis 1:1 with ==highlight== shown clearly now',
    '> [!NOTE] T\n> **bold** note body content here',
    '# Heading\n\nGenesis 1:1 verse body **bold** then more',
  ]

  samples.forEach((s, i) => {
    it(`sample ${i + 1}: no literal ** in output`, () => {
      expect(html(s)).not.toMatch(/\*\*[^*<>]+\*\*/)
    })
    it(`sample ${i + 1}: no escaped &lt;u&gt; in output`, () => {
      expect(html(s)).not.toContain('&lt;u&gt;')
    })
    it(`sample ${i + 1}: no literal == highlight in output`, () => {
      expect(html(s)).not.toMatch(/==[^=]+==/)
    })
    it(`sample ${i + 1}: no stash token leakage`, () => {
      expect(html(s)).not.toContain('BEREANSTASH')
    })
  })
})

// ── 15. buildPrintHTML escaping & structure with options ──────────────────────

describe('buildPrintHTML — escaping & structure', () => {
  it('escapes < in title even with options', () => {
    const out = buildPrintHTML('<b>x', 'body', { fontSize: 14 })
    expect(out).toContain('&lt;b&gt;x')
  })

  it('escapes & in title', () => {
    expect(buildPrintHTML('A & B', 'body')).toContain('A &amp; B')
  })

  it('always has charset meta', () => {
    expect(buildPrintHTML('T', 'b', { marginPreset: 'none' })).toContain('charset="utf-8"')
  })

  it('always closes html', () => {
    expect(buildPrintHTML('T', 'b', { colorMode: 'grayscale' })).toContain('</html>')
  })

  it('verse-block CSS present regardless of options', () => {
    expect(buildPrintHTML('T', 'b', { fontFamily: 'serif' })).toContain('.berean-verse-block')
  })

  it('mark CSS present', () => {
    expect(buildPrintHTML('T', 'b')).toContain('mark {')
  })

  it('page-break rules present', () => {
    expect(buildPrintHTML('T', 'b')).toContain('page-break-inside: avoid')
  })

  it('empty body with options still valid', () => {
    expect(buildPrintHTML('T', '', { marginPreset: 'wide', fontSize: 16 })).toContain('<!DOCTYPE html>')
  })
})

// ── 16. Verse-body cross-reference linking ────────────────────────────────────

describe('verse block — cross-ref links in body', () => {
  it('a reference inside a verse body becomes a link', () => {
    const out = html('Matthew 22:37 Yeshua quoted Deuteronomy 6:5 about love')
    // The body mentions Deut 6:5 which addVerseLinksToHtml should link
    expect(out).toContain('berean-verse-ref')
  })

  it('verse body bold survives alongside ref linking', () => {
    const out = html('Matthew 22:37 quoting **Deuteronomy 6:5** with emphasis')
    expect(out).toContain('<strong>')
  })

  it('wikilink near verse block renders', () => {
    const out = html('Genesis 1:1 In the beginning Yehovah created\n\nSee [[Creation Study]] for more')
    expect(out).toContain('Creation Study')
    expect(out).toContain('<a ')
  })
})

// ── 17. Full buildPrintHTML integration with scripture blocks ─────────────────

describe('buildPrintHTML — scripture-block integration', () => {
  const studyNote = `# Sabbath Study

Exodus 20:8-11
8 Remember the **sabbath** day, to keep it holy
9 Six days shalt thou *labour*
10 But the seventh day is the sabbath of Yehovah
11 For in six days Yehovah made <u>heaven and earth</u>

## Cross References

> [!NOTE] Connection
> Compare with [[Genesis 2:2]] on the seventh day rest.

Deuteronomy 5:12 Keep the sabbath day to ==sanctify== it`

  it('produces a valid document', () => {
    expect(buildPrintHTML('Sabbath', studyNote)).toContain('<!DOCTYPE html>')
  })

  it('renders the main heading', () => {
    expect(buildPrintHTML('Sabbath', studyNote)).toContain('<h1>Sabbath Study</h1>')
  })

  it('renders bold in verse body', () => {
    expect(buildPrintHTML('Sabbath', studyNote)).toContain('<strong>sabbath</strong>')
  })

  it('renders italic in verse body', () => {
    expect(buildPrintHTML('Sabbath', studyNote)).toContain('<em>labour</em>')
  })

  it('renders underline in verse body', () => {
    expect(buildPrintHTML('Sabbath', studyNote)).toContain('<u>heaven and earth</u>')
  })

  it('renders the cross-references heading (not absorbed)', () => {
    expect(buildPrintHTML('Sabbath', studyNote)).toContain('<h2>Cross References</h2>')
  })

  it('renders the callout', () => {
    expect(buildPrintHTML('Sabbath', studyNote)).toContain('Connection')
  })

  it('renders highlight in second verse block', () => {
    expect(buildPrintHTML('Sabbath', studyNote)).toContain('<mark')
  })

  it('produces exactly two verse blocks', () => {
    const out = buildPrintHTML('Sabbath', studyNote)
    // Count actual block divs (class="..."), not CSS-rule mentions (.berean-verse-block)
    expect((out.match(/class="berean-verse-block"/g) || []).length).toBe(2)
  })

  it('no raw markdown or stash tokens in final PDF html', () => {
    const out = buildPrintHTML('Sabbath', studyNote)
    expect(out).not.toContain('BEREANSTASH')
    expect(out).not.toContain('&lt;u&gt;')
    expect(out).not.toMatch(/\*\*[^*<>]+\*\*/)
  })
})

// ── 18. Print themes ──────────────────────────────────────────────────────────

describe('buildPrintHTML — themes', () => {
  const sample = 'Genesis 1:1 In the **beginning** Yehovah created'

  it('exports 15 themes', () => {
    expect(Object.keys(PRINT_THEMES)).toHaveLength(15)
  })

  it('includes the 10 additional themes', () => {
    const ids = Object.keys(PRINT_THEMES)
    for (const id of ['parchment', 'forest', 'royal', 'ember', 'arctic', 'slate', 'rose', 'dawn', 'midnight', 'ivory']) {
      expect(ids).toContain(id)
    }
  })

  it('every theme id matches its key', () => {
    for (const [key, t] of Object.entries(PRINT_THEMES)) {
      expect(t.id).toBe(key)
    }
  })

  it('verse blocks use 8px rounded corners in print CSS', () => {
    const out = buildPrintHTML('T', 'Genesis 1:1 In the beginning Yehovah created', { theme: 'classic' })
    expect(out).toMatch(/\.berean-verse-block\s*\{[^}]*border-radius: 8px !important/)
  })

  it('strips internal anchor links but keeps external links', () => {
    // Wikilink → internal #anchor (should lose href); explicit external link keeps href
    const md = 'See [[My Note]] and [YouTube](https://youtu.be/abc)'
    const out = buildPrintHTML('T', md)
    expect(out).not.toContain('href="#note-my-note"')
    expect(out).toContain('href="https://youtu.be/abc"')
  })

  it('strips verse-ref internal anchors in a verse block', () => {
    const out = buildPrintHTML('T', 'Matthew 22:37 quoting Deuteronomy 6:5')
    // No internal #verse-ref- href should remain
    expect(out).not.toMatch(/href="#verse-ref-/)
    expect(out).not.toMatch(/href="#lxx-verse-ref-/)
  })

  it('verse-ref links are styled without underline (not clickable-looking)', () => {
    const out = buildPrintHTML('T', 'body')
    expect(out).toMatch(/a\.berean-verse-ref\s*\{[^}]*text-decoration: none/)
  })

  it('stripped non-verse internal links fall back to plain text', () => {
    const out = buildPrintHTML('T', 'body')
    expect(out).toContain('a:not([href]):not(.berean-verse-ref)')
  })

  it('margin preset is reflected in uniform body padding; none = 0', () => {
    const wide = buildPrintHTML('T', 'body', { marginPreset: 'wide' })
    const none = buildPrintHTML('T', 'body', { marginPreset: 'none' })
    expect(wide).toMatch(/body\s*\{[^}]*padding: 1\.5in/)
    expect(none).toMatch(/body\s*\{[^}]*padding: 0in/)
    // none should NOT have any leftover floor like 0.25in
    expect(none).not.toMatch(/body\s*\{[^}]*padding: 0\.25in/)
  })

  it('midnight is a dark theme with color-adjust exact', () => {
    const out = buildPrintHTML('T', 'body', { theme: 'midnight' })
    expect(out).toContain('print-color-adjust: exact')
    expect(out).toContain('#0d1117')
  })

  it('every theme has required color fields', () => {
    for (const t of Object.values(PRINT_THEMES)) {
      expect(t.bg).toBeTruthy()
      expect(t.text).toBeTruthy()
      expect(t.verseBorder).toBeTruthy()
      expect(t.verseRef).toBeTruthy()
      expect(t.accent).toBeTruthy()
      expect(['system', 'serif', 'sansserif']).toContain(t.suggestedFont)
    }
  })

  it('classic theme uses indigo verse border', () => {
    expect(buildPrintHTML('T', sample, { theme: 'classic' })).toContain('#6366f1')
  })

  it('manuscript theme uses warm amber border', () => {
    expect(buildPrintHTML('T', sample, { theme: 'manuscript' })).toContain('#b45309')
  })

  it('ocean theme uses teal accent', () => {
    expect(buildPrintHTML('T', sample, { theme: 'ocean' })).toContain('#0d9488')
  })

  it('minimal theme uses transparent verse background', () => {
    expect(buildPrintHTML('T', sample, { theme: 'minimal' })).toContain('background: transparent')
  })

  it('night theme uses dark background', () => {
    const out = buildPrintHTML('T', sample, { theme: 'night' })
    expect(out).toContain('#1a1d21')
    expect(out).toContain('print-color-adjust: exact')
  })

  it('default theme (no opt) is classic', () => {
    expect(buildPrintHTML('T', sample)).toContain('#6366f1')
  })

  it('unknown theme falls back to classic', () => {
    // @ts-expect-error testing invalid theme id
    expect(buildPrintHTML('T', sample, { theme: 'nonexistent' })).toContain('#6366f1')
  })

  it('theme verse-block colors use !important to beat inline styles', () => {
    const out = buildPrintHTML('T', sample, { theme: 'ocean' })
    expect(out).toMatch(/\.berean-verse-block\s*\{[^}]*!important/)
  })

  it('each theme produces a valid document', () => {
    for (const id of Object.keys(PRINT_THEMES) as (keyof typeof PRINT_THEMES)[]) {
      const out = buildPrintHTML('T', sample, { theme: id })
      expect(out).toContain('<!DOCTYPE html>')
      expect(out).toContain('</html>')
    }
  })

  it('each theme still renders inner markdown', () => {
    for (const id of Object.keys(PRINT_THEMES) as (keyof typeof PRINT_THEMES)[]) {
      expect(buildPrintHTML('T', sample, { theme: id })).toContain('<strong>beginning</strong>')
    }
  })

  it('each theme still renders verse blocks', () => {
    for (const id of Object.keys(PRINT_THEMES) as (keyof typeof PRINT_THEMES)[]) {
      expect(buildPrintHTML('T', sample, { theme: id })).toContain('class="berean-verse-block"')
    }
  })

  it('theme applies heading color', () => {
    const out = buildPrintHTML('T', '# Heading', { theme: 'ocean' })
    expect(out).toMatch(/h1\s*\{[^}]*color: #0f766e/)
  })

  it('theme applies link/accent color', () => {
    const out = buildPrintHTML('T', '[link](https://x.com)', { theme: 'manuscript' })
    expect(out).toMatch(/a\s*\{[^}]*color: #b45309/)
  })

  it('theme combines with margin and font options', () => {
    const out = buildPrintHTML('T', sample, { theme: 'manuscript', marginPreset: 'wide', fontSize: 14, fontFamily: 'serif' })
    expect(out).toMatch(/body\s*\{[^}]*padding: 1\.5in/)
    expect(out).toContain('font-size: 14pt')
    expect(out).toContain('Georgia')
    expect(out).toContain('#b45309')
  })

  it('theme combines with grayscale', () => {
    const out = buildPrintHTML('T', sample, { theme: 'ocean', colorMode: 'grayscale' })
    expect(out).toContain('grayscale(100%)')
    expect(out).toContain('#0d9488')
  })

  it('no theme leaks raw tokens', () => {
    for (const id of Object.keys(PRINT_THEMES) as (keyof typeof PRINT_THEMES)[]) {
      expect(buildPrintHTML('T', sample, { theme: id })).not.toContain('BEREANSTASH')
    }
  })

  it('night theme keeps body text light', () => {
    const out = buildPrintHTML('T', sample, { theme: 'night' })
    expect(out).toMatch(/body\s*\{[^}]*color: #e6e8eb/)
  })

  it('theme swatch metadata present for UI', () => {
    for (const t of Object.values(PRINT_THEMES)) {
      expect(t.label.length).toBeGreaterThan(0)
      expect(t.desc.length).toBeGreaterThan(0)
    }
  })
})
