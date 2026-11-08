// Drift guard for the native-port golden corpus (scripts/golden). If this fails, the TypeScript
// behaviour or the corpus generator changed: run `npm run golden:export`, then `swift test` in
// Packages/BereanKit, and commit the regenerated fixtures together with the change.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildGoldenCorpus, GOLDEN_DIR, serializeGolden } from '../../scripts/golden/corpus'
import { buildDefaultRulesSwift, buildReferenceTablesSwift, SWIFT_RULES_PATH, SWIFT_TABLES_PATH } from '../../scripts/golden/swiftTables'
import { buildBibleGolden } from '../../scripts/golden/bible'
import { buildTextGolden } from '../../scripts/golden/text'
import { buildLexiconGolden } from '../../scripts/golden/lexicon'
import { buildDisplayGolden } from '../../scripts/golden/display'
import { buildCrossrefsGolden } from '../../scripts/golden/crossrefs'
import { buildRecordedMigrationsSwift, buildSchemaGolden, SWIFT_MIGRATIONS_PATH } from '../../scripts/golden/schema'
import { buildTabsGolden } from '../../scripts/golden/tabs'
import { buildNotesGolden } from '../../scripts/golden/notes'
import { buildHighlightsGolden } from '../../scripts/golden/highlights'
import { buildWorkspacesGolden } from '../../scripts/golden/workspaces'
import { buildNoteMarkdownGolden } from '../../scripts/golden/noteMarkdown'

describe('golden corpus', () => {
  for (const f of buildGoldenCorpus()) {
    it(`${f.name}.json matches the TypeScript oracle`, () => {
      const path = join(GOLDEN_DIR, `${f.name}.json`)
      expect(existsSync(path), `${path} missing — run npm run golden:export`).toBe(true)
      const committed = readFileSync(path, 'utf8')
      const fresh = serializeGolden(f)
      if (committed !== fresh) {
        const a = committed.split('\n'), b = fresh.split('\n')
        const i = a.findIndex((line, k) => line !== b[k])
        expect.fail(`${f.name}.json is stale — run npm run golden:export (first difference at line ${i + 1}: committed ${a[i]?.slice(0, 120)} / now ${b[i]?.slice(0, 120)})`)
      }
    })
  }
  it('DefaultWordReplacerRules.swift matches src/store/index.ts', () => {
    expect(existsSync(SWIFT_RULES_PATH) && readFileSync(SWIFT_RULES_PATH, 'utf8') === buildDefaultRulesSwift(), 'DefaultWordReplacerRules.swift is stale — run npm run golden:export').toBe(true)
  })
  it('ReferenceTables.swift matches src/lib/parseRef.ts', () => {
    expect(existsSync(SWIFT_TABLES_PATH) && readFileSync(SWIFT_TABLES_PATH, 'utf8') === buildReferenceTablesSwift(), 'ReferenceTables.swift is stale — run npm run golden:export').toBe(true)
  })
  it('bible.json matches the TypeScript Bible service (skipped without data/*.db)', async () => {
    const bible = await buildBibleGolden()
    if (!bible) return
    const path = join(GOLDEN_DIR, 'bible.json')
    // Exact, including FTS order: ADR-0008's tie-breaker makes it identical on every SQLite build.
    expect(existsSync(path) && readFileSync(path, 'utf8') === serializeGolden(bible), 'bible.json is stale — run npm run golden:export').toBe(true)
  }, 120_000)
  it('text.json matches the TypeScript verse-text code (skipped without data/*.db)', async () => {
    const g = await buildTextGolden()
    if (!g) return
    const path = join(GOLDEN_DIR, 'text.json')
    expect(existsSync(path) && readFileSync(path, 'utf8') === serializeGolden(g), 'text.json is stale — run npm run golden:export').toBe(true)
  }, 300_000)
  it('lexicon.json matches the TypeScript lexicon service (skipped without data/*.db)', async () => {
    const g = await buildLexiconGolden()
    if (!g) return
    const path = join(GOLDEN_DIR, 'lexicon.json')
    expect(existsSync(path) && readFileSync(path, 'utf8') === serializeGolden(g), 'lexicon.json is stale — run npm run golden:export').toBe(true)
  }, 300_000)
  it('display.json matches the TypeScript word replacer / verse display (skipped without data/*.db)', async () => {
    const g = await buildDisplayGolden()
    if (!g) return
    const path = join(GOLDEN_DIR, 'display.json')
    expect(existsSync(path) && readFileSync(path, 'utf8') === serializeGolden(g), 'display.json is stale — run npm run golden:export').toBe(true)
  }, 300_000)
  it('crossrefs.json matches the TypeScript cross-reference service (skipped without data/*.db)', async () => {
    const g = await buildCrossrefsGolden()
    if (!g) return
    const path = join(GOLDEN_DIR, 'crossrefs.json')
    expect(existsSync(path) && readFileSync(path, 'utf8') === serializeGolden(g), 'crossrefs.json is stale — run npm run golden:export').toBe(true)
  }, 300_000)
  it('schema.json matches the TypeScript migrations', async () => {
    const g = await buildSchemaGolden()
    const path = join(GOLDEN_DIR, 'schema.json')
    expect(existsSync(path) && readFileSync(path, 'utf8') === serializeGolden(g), 'schema.json is stale — run npm run golden:export').toBe(true)
  }, 120_000)
  it('RecordedMigrations.swift matches the TypeScript migrations', async () => {
    expect(existsSync(SWIFT_MIGRATIONS_PATH) && readFileSync(SWIFT_MIGRATIONS_PATH, 'utf8') === await buildRecordedMigrationsSwift(), 'RecordedMigrations.swift is stale — run npm run golden:export').toBe(true)
  }, 120_000)
  it('tabs.json matches the TypeScript tab persistence / sessions service', async () => {
    const path = join(GOLDEN_DIR, 'tabs.json')
    expect(existsSync(path) && readFileSync(path, 'utf8') === serializeGolden(await buildTabsGolden()), 'tabs.json is stale — run npm run golden:export').toBe(true)
  }, 120_000)
  it('notes.json matches the TypeScript notes read path', async () => {
    const path = join(GOLDEN_DIR, 'notes.json')
    expect(existsSync(path) && readFileSync(path, 'utf8') === serializeGolden(await buildNotesGolden()), 'notes.json is stale — run npm run golden:export').toBe(true)
  }, 120_000)
  it('highlights.json matches the TypeScript highlights service', async () => {
    const path = join(GOLDEN_DIR, 'highlights.json')
    expect(existsSync(path) && readFileSync(path, 'utf8') === serializeGolden(await buildHighlightsGolden()), 'highlights.json is stale — run npm run golden:export').toBe(true)
  }, 60_000)
  it('note-markdown.json matches the TypeScript note file format', () => {
    const path = join(GOLDEN_DIR, 'note-markdown.json')
    expect(existsSync(path) && readFileSync(path, 'utf8') === serializeGolden(buildNoteMarkdownGolden()), 'note-markdown.json is stale — run npm run golden:export').toBe(true)
  })

  it('workspaces.json matches the TypeScript workspaces service', async () => {
    const path = join(GOLDEN_DIR, 'workspaces.json')
    expect(existsSync(path) && readFileSync(path, 'utf8') === serializeGolden(await buildWorkspacesGolden()), 'workspaces.json is stale — run npm run golden:export').toBe(true)
  }, 60_000)
})
