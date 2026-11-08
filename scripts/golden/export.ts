// Writes the golden corpus (see corpus.ts). Run: npm run golden:export
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildGoldenCorpus, GOLDEN_DIR, serializeGolden } from './corpus'
import { buildReferenceTablesSwift, SWIFT_TABLES_PATH } from './swiftTables'
import { buildBibleGolden } from './bible'
import { buildTextGolden } from './text'
import { dirname } from 'node:path'

mkdirSync(GOLDEN_DIR, { recursive: true })
for (const f of buildGoldenCorpus()) {
  const text = serializeGolden(f)
  writeFileSync(join(GOLDEN_DIR, `${f.name}.json`), text)
  console.log(`${f.name}.json  ${text.length} chars`)
}

mkdirSync(dirname(SWIFT_TABLES_PATH), { recursive: true })
writeFileSync(SWIFT_TABLES_PATH, buildReferenceTablesSwift())
console.log('ReferenceTables.swift')

const bible = await buildBibleGolden()
if (bible) {
  const text = serializeGolden(bible)
  writeFileSync(join(GOLDEN_DIR, 'bible.json'), text)
  console.log(`bible.json  ${text.length} chars`)
} else {
  console.log('bible.json  skipped (data/*.db not present)')
}

const textGolden = await buildTextGolden()
if (textGolden) {
  const text = serializeGolden(textGolden)
  writeFileSync(join(GOLDEN_DIR, 'text.json'), text)
  console.log(`text.json  ${text.length} chars`)
} else {
  console.log('text.json  skipped (data/*.db not present)')
}
