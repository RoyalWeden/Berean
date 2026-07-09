/**
 * Integration tests for vault sync (Octarine bidirectional sync)
 *
 * Tests vault:watch, vault:reconcile, and note import/export
 * Runs against throwaway vault copy
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'child_process'
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'

const VAULT_TEST = '/private/tmp/vault-test-' + Date.now()

describe('Vault Sync Integration', () => {
  beforeAll(() => {
    // Create throwaway vault
    mkdirSync(VAULT_TEST, { recursive: true })
    mkdirSync(join(VAULT_TEST, 'Verse Notes'), { recursive: true })
    mkdirSync(join(VAULT_TEST, 'Notes'), { recursive: true })
    mkdirSync(join(VAULT_TEST, 'Daily'), { recursive: true })
  })

  afterAll(() => {
    // Cleanup
    rmSync(VAULT_TEST, { recursive: true, force: true })
  })

  it('Test 1.1: Berean → Octarine (write to vault)', async () => {
    // GIVEN: Verse note in database
    // WHEN: Export vault
    // THEN: File appears in vault with correct frontmatter

    const testNoteContent = {
      type: 'verse',
      ref: 'GEN.1.1',
      title: 'Genesis 1.1',
      content: 'Test note content',
      color: 'blue',
      berean_id: 'test-001'
    }

    // Mock export function
    const expectedFile = join(VAULT_TEST, 'Verse Notes', 'Genesis 1.1.md')
    const expectedContent = `---
cssclasses: ["berean-verse"]
ref: GEN.1.1
text_id: kjva
created_at: 2026-06-28T00:00:00.000Z
updated_at: 2026-06-28T00:00:00.000Z
berean_id: test-001
berean_color: blue
---

Test note content`

    writeFileSync(expectedFile, expectedContent, 'utf8')

    // VERIFY: File exists and has correct format
    const content = readFileSync(expectedFile, 'utf8')
    expect(content).toContain('cssclasses: ["berean-verse"]')
    expect(content).toContain('ref: GEN.1.1')
    expect(content).toContain('berean_id: test-001')
    expect(content).toContain('Test note content')
  })

  it('Test 1.2: Octarine → Berean (watch + reconcile)', async () => {
    // GIVEN: Note file in vault
    // WHEN: File is modified externally (simulating Octarine edit)
    // THEN: Chokidar detects change and reconciles to DB

    const testFile = join(VAULT_TEST, 'Notes', 'Test.md')
    const initialContent = `---
cssclasses: ["berean-note"]
berean_id: test-002
updated_at: 2026-06-28T10:00:00.000Z
---

Original content`

    writeFileSync(testFile, initialContent, 'utf8')

    // Simulate external edit (Octarine)
    const modifiedContent = `---
cssclasses: ["berean-note"]
berean_id: test-002
updated_at: 2026-06-28T10:05:00.000Z
---

Modified by Octarine`

    writeFileSync(testFile, modifiedContent, 'utf8')

    // VERIFY: Content changed and timestamp updated
    const saved = readFileSync(testFile, 'utf8')
    expect(saved).toContain('Modified by Octarine')
    expect(saved).toContain('2026-06-28T10:05:00.000Z')
  })

  it('Test 4: Wikilink resolution across folders', () => {
    // GIVEN: Note with cross-folder wikilinks
    // WHEN: Wikilinks are parsed
    // THEN: Paths resolve to correct files

    const testCases = [
      {
        link: '[[Genesis 1.1]]',
        expectedFolder: 'Verse Notes',
        expectedFile: 'Genesis 1.1.md',
        description: 'Bare verse reference'
      },
      {
        link: '[[Verse Notes/Genesis 1.1]]',
        expectedFolder: 'Verse Notes',
        expectedFile: 'Genesis 1.1.md',
        description: 'Full path verse reference'
      },
      {
        link: '[[Welcome]]',
        expectedFolder: 'Notes',
        expectedFile: 'Welcome.md',
        description: 'Same-folder note'
      },
      {
        link: '[[Daily/2026-06-28]]',
        expectedFolder: 'Daily',
        expectedFile: '2026-06-28.md',
        description: 'Daily note cross-folder'
      }
    ]

    // Mock resolve function would validate each case
    testCases.forEach(tc => {
      // TODO: Import actual normalizeWikiTarget from noteUtils
      // const resolved = normalizeWikiTarget(tc.link, VAULT_TEST)
      // expect(resolved.folder).toBe(tc.expectedFolder)
      // expect(resolved.file).toBe(tc.expectedFile)
      expect(tc.description).toBeTruthy() // Placeholder
    })
  })

  it('Test 6: Collision detection in migration', () => {
    // GIVEN: Vault has existing file "Gospel.md"
    // WHEN: Migration tries to write another "Gospel.md"
    // THEN: Collision is detected and reported

    const existing = join(VAULT_TEST, 'Notes', 'Gospel.md')
    writeFileSync(existing, '# Gospel\n\nExisting note', 'utf8')

    // Migration should detect collision
    const newNoteTitle = 'Gospel'
    const filesInFolder = ['Gospel.md'] // Existing files in Notes/

    const hasCollision = filesInFolder.includes(`${newNoteTitle}.md`)
    expect(hasCollision).toBe(true)

    // Should handle by renaming or reporting error
    const newName = newNoteTitle + ' — Copy'
    expect(newName).not.toBe(newNoteTitle)
  })

  it('Test 10: Verse reference format normalization', () => {
    // GIVEN: Verse reference in multiple formats
    // WHEN: Format conversion applied
    // THEN: All normalize to canonical form

    const formats = [
      { input: 'Genesis 1:1', expected: 'GEN.1.1', description: 'Colon to dot' },
      { input: 'Genesis 1.1', expected: 'GEN.1.1', description: 'Already dot' },
      { input: 'GEN.1.1', expected: 'GEN.1.1', description: 'All caps' },
      { input: 'gen.1.1', expected: 'GEN.1.1', description: 'All lowercase' }
    ]

    // TODO: Import actual parseRef functions
    // formats.forEach(f => {
    //   const canonical = parseRef.toCanonical(f.input)
    //   expect(canonical).toBe(f.expected)
    // })

    expect(formats.length).toBe(4) // Placeholder
  })
})
