// Writes the golden corpus (see corpus.ts). Run: npm run golden:export
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildGoldenCorpus, GOLDEN_DIR, serializeGolden } from './corpus'
import { buildDefaultRulesSwift, buildReferenceTablesSwift, SWIFT_RULES_PATH, SWIFT_TABLES_PATH } from './swiftTables'
import { buildBibleGolden } from './bible'
import { buildTextGolden } from './text'
import { buildLexiconGolden } from './lexicon'
import { buildDisplayGolden } from './display'
import { buildCrossrefsGolden } from './crossrefs'
import { buildRecordedMigrationsSwift, buildSchemaGolden, SWIFT_MIGRATIONS_PATH } from './schema'
import { buildTabsGolden } from './tabs'
import { buildNotesGolden } from './notes'
import { buildHighlightsGolden } from './highlights'
import { buildWorkspacesGolden } from './workspaces'
import { buildNoteMarkdownGolden } from './noteMarkdown'
import { dirname } from 'node:path'

mkdirSync(GOLDEN_DIR, { recursive: true })
for (const f of buildGoldenCorpus()) {
  const text = serializeGolden(f)
  writeFileSync(join(GOLDEN_DIR, `${f.name}.json`), text)
  console.log(`${f.name}.json  ${text.length} chars`)
}

mkdirSync(dirname(SWIFT_TABLES_PATH), { recursive: true })
writeFileSync(SWIFT_TABLES_PATH, buildReferenceTablesSwift())
mkdirSync(dirname(SWIFT_RULES_PATH), { recursive: true })
writeFileSync(SWIFT_RULES_PATH, buildDefaultRulesSwift())
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

const lexicon = await buildLexiconGolden()
if (lexicon) {
  const text = serializeGolden(lexicon)
  writeFileSync(join(GOLDEN_DIR, 'lexicon.json'), text)
  console.log(`lexicon.json  ${text.length} chars`)
} else {
  console.log('lexicon.json  skipped (data/*.db not present)')
}

const display = await buildDisplayGolden()
if (display) {
  const text = serializeGolden(display)
  writeFileSync(join(GOLDEN_DIR, 'display.json'), text)
  console.log(`display.json  ${text.length} chars`)
} else {
  console.log('display.json  skipped (data/*.db not present)')
}

const crossrefs = await buildCrossrefsGolden()
if (crossrefs) {
  const text = serializeGolden(crossrefs)
  writeFileSync(join(GOLDEN_DIR, 'crossrefs.json'), text)
  console.log(`crossrefs.json  ${text.length} chars`)
} else {
  console.log('crossrefs.json  skipped (data/*.db not present)')
}

const schema = await buildSchemaGolden()
writeFileSync(join(GOLDEN_DIR, 'schema.json'), serializeGolden(schema))
console.log('schema.json')
mkdirSync(dirname(SWIFT_MIGRATIONS_PATH), { recursive: true })
writeFileSync(SWIFT_MIGRATIONS_PATH, await buildRecordedMigrationsSwift())
console.log('RecordedMigrations.swift')
writeFileSync(join(GOLDEN_DIR, 'tabs.json'), serializeGolden(await buildTabsGolden()))
console.log('tabs.json')
writeFileSync(join(GOLDEN_DIR, 'notes.json'), serializeGolden(await buildNotesGolden()))
console.log('notes.json')
writeFileSync(join(GOLDEN_DIR, 'highlights.json'), serializeGolden(await buildHighlightsGolden()))
console.log('highlights.json')
writeFileSync(join(GOLDEN_DIR, 'workspaces.json'), serializeGolden(await buildWorkspacesGolden()))
console.log('workspaces.json')
writeFileSync(join(GOLDEN_DIR, 'note-markdown.json'), serializeGolden(buildNoteMarkdownGolden()))
console.log('note-markdown.json')
