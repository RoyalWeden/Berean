// Drift guard for the native-port golden corpus (scripts/golden). If this fails, the TypeScript
// behaviour or the corpus generator changed: run `npm run golden:export`, then `swift test` in
// Packages/BereanKit, and commit the regenerated fixtures together with the change.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildGoldenCorpus, GOLDEN_DIR, serializeGolden } from '../../scripts/golden/corpus'
import { buildReferenceTablesSwift, SWIFT_TABLES_PATH } from '../../scripts/golden/swiftTables'
import { buildBibleGolden } from '../../scripts/golden/bible'

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
    expect(existsSync(path) && readFileSync(path, 'utf8') === serializeGolden(bible), 'bible.json is stale — run npm run golden:export').toBe(true)
  }, 120_000)
})
