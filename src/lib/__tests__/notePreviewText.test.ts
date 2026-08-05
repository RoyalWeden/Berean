import { describe, it, expect } from 'vitest'
import { stripMarkdownFormatting } from '../notePreviewText'

describe('stripMarkdownFormatting', () => {
  it('strips headings, bold, italic, strikethrough', () => {
    expect(stripMarkdownFormatting('# Heading\n**bold** *italic* ~~gone~~')).toBe('Heading\nbold italic gone')
  })

  it('strips ==highlight== markup', () => {
    expect(stripMarkdownFormatting('The ==light== of the world')).toBe('The light of the world')
  })

  it('strips callout type tags but keeps the body', () => {
    expect(stripMarkdownFormatting('> [!WARNING] Heads up\n> Body text')).toBe('Heads up\nBody text')
  })

  it('strips HTML comment markers (each <!-- ... --> individually), leaving text between them intact', () => {
    // The berean:highlight-preview wrapper is a pair of separate comment markers around
    // visible content, not a single hide-everything-between block — matches how the vault
    // export actually uses it (see noteToMarkdown in vault.ts).
    expect(stripMarkdownFormatting('before <!-- berean:highlight-preview -->hidden<!-- /berean:highlight-preview --> after').replace(/\s+/g, ' '))
      .toBe('before hidden after')
  })

  it('strips literal inline HTML tags (mark, u, and anything else)', () => {
    expect(stripMarkdownFormatting('<mark class="hlcyan">key term</mark> and <u>underlined</u>'))
      .toBe('key term and underlined')
  })

  it('strips links and images down to their visible text', () => {
    expect(stripMarkdownFormatting('[a link](https://example.com) and ![alt text](img.png)'))
      .toBe('a link and alt text')
  })

  it('strips wikilinks, including the aliased form', () => {
    expect(stripMarkdownFormatting('[[Gen 1:1]] and [[Gen 1:1|the beginning]]'))
      .toBe('Gen 1:1 and the beginning')
  })
})
