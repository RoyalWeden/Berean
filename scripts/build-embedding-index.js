#!/usr/bin/env node
/**
 * Builds electron/db-generated/verse_embeddings.db — a semantic (embedding) index over every
 * verse in every text this app ships, used by electron/embeddings.ts's semanticSearch() to find
 * verses whose WORDING doesn't literally overlap a user's question (the thing FTS5 keyword search
 * structurally cannot do — see electron/ipc/aiLookup.ts's gatherSemanticCandidates for how the
 * result gets fused back into the existing keyword pipeline via Reciprocal Rank Fusion).
 *
 * Model: nomic-embed-text, chosen over mxbai-embed-large after a head-to-head comparison — 18,536
 * NT+Psalms/Proverbs/Exodus/Leviticus/Isaiah/Deuteronomy/Job/Ecclesiastes/Malachi kjva verses
 * embedded with each model, then the 15 modern-wording/thematic eval-harness fixture QUESTIONS
 * embedded and ranked by cosine similarity against that same sample. Both are free, local, Ollama
 * models — no per-user cost either way.
 *
 *   nomic-embed-text  (768-dim,  274MB): recall@1=6.7%  recall@5=26.7% recall@10=26.7%  10.6ms/verse to embed
 *   mxbai-embed-large (1024-dim, 670MB): recall@1=0.0%  recall@5=6.7%  recall@10=26.7%  25.3ms/verse to embed
 *
 * nomic-embed-text wins clearly on both axes (better recall AND ~2.4x faster to embed with) — not
 * a close call needing the "prefer the smaller one" tiebreak from the mission brief; mxbai simply
 * didn't perform better here despite being larger.
 *
 * HONEST CAVEAT, not glossed over: BOTH models' raw recall on this task is low in absolute terms —
 * far below the existing keyword/FTS5 pipeline's 83-90% on the same category of question (see
 * scripts/eval/runRetrievalEval.ts's baseline). Generic sentence-embedding models, trained on
 * modern web text, do not map cleanly onto short, archaic-KJV-phrased verse fragments — a plain
 * brute-force cosine match on raw verse text is a genuinely weaker signal than expected, not the
 * strong standalone retriever the mission brief's "anxiety -> Matthew 6:25" motivating example
 * might suggest. It still fills a gap literal keyword search structurally cannot (see
 * electron/ipc/semanticCandidates.ts's own header) and costs nothing extra to have as one more
 * fused signal via Reciprocal Rank Fusion (electron/rrf.ts) — but it should be understood as a
 * modest additive nudge on top of an already-strong keyword pipeline, not a replacement lever.
 * See the mission report for the full before/after numbers and what was and wasn't verified.
 *
 * Storage: a plain SQLite table (text_id, book_id, chapter, verse_num, scale, vector BLOB),
 * Int8-quantized (see electron/embeddingQuantize.ts for the encode/decode math and why) rather
 * than float32 — cuts the ~420MB float32 estimate for the full ~137k-verse corpus down to
 * ~105MB + a few KB of scale floats. Brute-force cosine similarity at query time (see
 * electron/embeddings.ts) is fast enough at this row count on this machine that a real vector-
 * search extension (sqlite-vec/sqlite-vss) isn't worth the added dependency for a dev-only index.
 *
 * Resumable: before embedding each text, queries which (chapter, verse_num) pairs already have a
 * row in the index for that text_id and skips them — safe to Ctrl-C and rerun; it picks up
 * wherever it left off instead of re-embedding from scratch. Progress is printed per text and per
 * batch, since embedding ~137k verses genuinely takes a while even locally.
 *
 * Run with: node scripts/build-embedding-index.js
 * (Optionally: node scripts/build-embedding-index.js kjva   — build/resume just one text, for
 * testing or to prioritize the largest/most-used texts first.)
 *
 * Uses Node's own built-in node:sqlite (DatabaseSync), NOT better-sqlite3 — same reason
 * scripts/eval/betterSqlite3NodeShim.ts exists: this worktree's better-sqlite3 native binding is
 * compiled for Electron's ABI and can't load under a plain `node` invocation. node:sqlite needs no
 * rebuild and touches no node_modules, and (unlike the eval harness) this script isn't running
 * inside vitest's Vite-based module graph, so it can `require('node:sqlite')` directly rather than
 * needing that file's createRequire workaround.
 */
const { DatabaseSync } = require('node:sqlite')
const path = require('path')
const fs = require('fs')

const OLLAMA_BASE = 'http://localhost:11434'
const MODEL = 'nomic-embed-text'
const BATCH_SIZE = 64 // Ollama /api/embed accepts an array `input` — batching cuts round-trip overhead a lot vs one HTTP call per verse.
const DATA_DIR = path.join(__dirname, '../data')
const OUT_DIR = path.join(__dirname, '../electron/db-generated')
const OUT_PATH = path.join(OUT_DIR, 'verse_embeddings.db')

// Mirrors electron/db/bible.ts's TEXT_FILES — deliberately duplicated rather than imported (this
// script runs under plain Node with require(), not through electron-vite's TS/alias pipeline, and
// the list is small/stable enough that keeping it in sync by hand is low-risk; every text_id here
// was cross-checked against that file at the time this script was written).
const TEXT_FILES = {
  kjva: 'kjva.db', kjv: 'kjv.db', lxx: 'lxx_brenton.db', enoch: 'enoch.db', jubilees: 'jubilees.db',
  apoc_elijah: 'apoc_elijah.db', recog_clement: 'recog_clement.db', hermas: 'hermas.db',
  hermas_taylor: 'hermas_taylor.db', asc_isaiah: 'asc_isaiah.db', ep_barnabas: 'ep_barnabas.db',
  t12p: 't12p.db', gad: 'gad.db', t_job: 't_job.db', '1clement': '1clement.db',
  apoc_abraham: 'apoc_abraham.db', didache_hoole: 'didache_hoole.db', t_jacob: 't_jacob.db',
  '2baruch': '2baruch.db',
}

function quantize(vector) {
  let maxAbs = 0
  for (const v of vector) { const a = Math.abs(v); if (a > maxAbs) maxAbs = a }
  const scale = maxAbs === 0 ? 1 : maxAbs / 127
  const bytes = Buffer.alloc(vector.length)
  for (let i = 0; i < vector.length; i++) {
    bytes.writeInt8(Math.max(-127, Math.min(127, Math.round(vector[i] / scale))), i)
  }
  return { bytes, scale }
}

async function embedBatch(texts) {
  const res = await fetch(`${OLLAMA_BASE}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, input: texts }),
  })
  if (!res.ok) throw new Error(`Ollama embed failed: ${res.status} ${await res.text()}`)
  const data = await res.json()
  return data.embeddings
}

function openOutputDb() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const db = new DatabaseSync(OUT_PATH)
  db.exec(`
    CREATE TABLE IF NOT EXISTS embeddings (
      text_id   TEXT NOT NULL,
      book_id   TEXT NOT NULL,
      chapter   INTEGER NOT NULL,
      verse_num INTEGER NOT NULL,
      scale     REAL NOT NULL,
      vector    BLOB NOT NULL,
      PRIMARY KEY (text_id, book_id, chapter, verse_num)
    );
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
  `)
  db.exec(`INSERT OR REPLACE INTO meta (key, value) VALUES ('model', '${MODEL}')`)
  return db
}

function loadAlreadyDone(outDb, textId) {
  const rows = outDb.prepare('SELECT chapter, verse_num FROM embeddings WHERE text_id = ?').all(textId)
  const done = new Set()
  for (const r of rows) done.add(`${r.chapter}:${r.verse_num}`)
  return done
}

async function buildText(textId, filename, outDb) {
  const srcPath = path.join(DATA_DIR, filename)
  if (!fs.existsSync(srcPath)) {
    console.log(`  [skip] ${textId}: ${filename} not found`)
    return
  }
  const srcDb = new DatabaseSync(srcPath, { readOnly: true })
  const allVerses = srcDb.prepare('SELECT book_id, chapter, verse_num, text FROM verses ORDER BY id').all()
  srcDb.close()

  const done = loadAlreadyDone(outDb, textId)
  const todo = allVerses.filter((v) => !done.has(`${v.chapter}:${v.verse_num}`))
  console.log(`  ${textId}: ${allVerses.length} verses total, ${done.size} already indexed, ${todo.length} to do`)
  if (todo.length === 0) return

  const insert = outDb.prepare('INSERT OR REPLACE INTO embeddings (text_id, book_id, chapter, verse_num, scale, vector) VALUES (?, ?, ?, ?, ?, ?)')
  const t0 = Date.now()
  for (let i = 0; i < todo.length; i += BATCH_SIZE) {
    const batch = todo.slice(i, i + BATCH_SIZE)
    const embeddings = await embedBatch(batch.map((v) => v.text))
    outDb.exec('BEGIN')
    try {
      for (let j = 0; j < batch.length; j++) {
        const { bytes, scale } = quantize(embeddings[j])
        insert.run(textId, batch[j].book_id, batch[j].chapter, batch[j].verse_num, scale, bytes)
      }
      outDb.exec('COMMIT')
    } catch (e) {
      outDb.exec('ROLLBACK')
      throw e
    }
    const doneCount = Math.min(i + BATCH_SIZE, todo.length)
    const elapsed = (Date.now() - t0) / 1000
    const rate = doneCount / elapsed
    const etaSec = (todo.length - doneCount) / rate
    process.stdout.write(`\r  ${textId}: ${doneCount}/${todo.length} (${rate.toFixed(1)} verses/s, eta ${Math.round(etaSec)}s)   `)
  }
  process.stdout.write('\n')
}

async function main() {
  const only = process.argv[2] // optional: build/resume just one text_id
  const outDb = openOutputDb()
  const entries = only ? [[only, TEXT_FILES[only]]] : Object.entries(TEXT_FILES)
  if (only && !TEXT_FILES[only]) {
    console.error(`Unknown text_id "${only}". Known: ${Object.keys(TEXT_FILES).join(', ')}`)
    process.exit(1)
  }
  console.log(`Building embedding index (model=${MODEL}) -> ${OUT_PATH}`)
  const overallStart = Date.now()
  for (const [textId, filename] of entries) {
    await buildText(textId, filename, outDb)
  }
  const totalRows = outDb.prepare('SELECT COUNT(*) as n FROM embeddings').get().n
  console.log(`Done in ${((Date.now() - overallStart) / 1000).toFixed(0)}s. Index now has ${totalRows} rows.`)
  const stat = fs.statSync(OUT_PATH)
  console.log(`Index file size: ${(stat.size / 1024 / 1024).toFixed(1)} MB`)
  outDb.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
