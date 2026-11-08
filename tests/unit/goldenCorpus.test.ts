// Drift guard for the native-port golden corpus (scripts/golden). If this fails, the TypeScript
// behaviour or the corpus generator changed: run `npm run golden:export`, then `swift test` in
// Packages/BereanKit, and commit the regenerated fixtures together with the change.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildGoldenCorpus, GOLDEN_DIR, serializeGolden } from '../../scripts/golden/corpus'

describe('golden corpus', () => {
  for (const f of buildGoldenCorpus()) {
    it(`${f.name}.json matches the TypeScript oracle`, () => {
      const path = join(GOLDEN_DIR, `${f.name}.json`)
      expect(existsSync(path), `${path} missing — run npm run golden:export`).toBe(true)
      expect(readFileSync(path, 'utf8') === serializeGolden(f), `${f.name}.json is stale — run npm run golden:export`).toBe(true)
    })
  }
})
