// Drift guard for the native-port golden corpus (scripts/golden). If this fails, the TypeScript
// behaviour or the corpus generator changed: run `npm run golden:export`, then `swift test` in
// Packages/BereanKit, and commit the regenerated fixtures together with the change.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildGoldenCorpus, GOLDEN_DIR, serializeGolden } from '../../scripts/golden/corpus'
import { buildReferenceTablesSwift, SWIFT_TABLES_PATH } from '../../scripts/golden/swiftTables'
import { buildBibleGolden } from '../../scripts/golden/bible'
import { buildTextGolden } from '../../scripts/golden/text'
import { buildLexiconGolden } from '../../scripts/golden/lexicon'

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
  it('ReferenceTables.swift matches src/lib/parseRef.ts', () => {
    expect(existsSync(SWIFT_TABLES_PATH) && readFileSync(SWIFT_TABLES_PATH, 'utf8') === buildReferenceTablesSwift(), 'ReferenceTables.swift is stale — run npm run golden:export').toBe(true)
  })
  it('bible.json matches the TypeScript Bible service (skipped without data/*.db)', async () => {
    const bible = await buildBibleGolden()
    if (!bible) return
    const path = join(GOLDEN_DIR, 'bible.json')
    expect(existsSync(path), 'bible.json missing — run npm run golden:export').toBe(true)
    const committedText = readFileSync(path, 'utf8')
    if (committedText === serializeGolden(bible)) return
    // A different SQLite build may order equal-rank FTS rows differently (DECISIONS F-05): compare
    // search results by row set (setHash + count) in that case, everything else exactly.
    type Search = { hash?: string; first?: string[] }
    const committed = JSON.parse(committedText) as { sqliteVersion: string; search: Search[] }
    const fresh = JSON.parse(serializeGolden(bible)) as { sqliteVersion: string; search: Search[] }
    expect(committed.sqliteVersion !== fresh.sqliteVersion, 'bible.json is stale — run npm run golden:export').toBe(true)
    const relax = (g: { sqliteVersion?: string; search: Search[] }) => ({ ...g, sqliteVersion: undefined, search: g.search.map(({ hash: _h, first: _f, ...rest }) => rest) })
    expect(relax(fresh), `bible.json is stale beyond FTS tie order (exported on SQLite ${committed.sqliteVersion}, now ${fresh.sqliteVersion})`).toEqual(relax(committed))
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
})
