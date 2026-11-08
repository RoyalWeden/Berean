/**
 * Golden corpus — deterministic fixtures computed by the TypeScript implementation (the oracle)
 * for the native Swift port to reproduce exactly (Packages/BereanKit, BereanConformanceTests).
 *
 *   npm run golden:export     regenerate Packages/BereanKit/Tests/BereanConformanceTests/Golden
 *   npm test                  tests/unit/goldenCorpus.test.ts fails if the committed fixtures
 *                             no longer match what the TypeScript produces (re-export, then run
 *                             `swift test` in Packages/BereanKit).
 *
 * Rules: no clocks, no Math.random, no environment — a seeded PRNG only, and only arithmetic that is
 * exact or correctly rounded in IEEE 754 (no Math.pow/`**` with non-integer results, no Math.sin…), so
 * every Node version produces identical files. Every input travels
 * through JSON, so inputs are normalised with JSON.parse(JSON.stringify(x)) BEFORE the oracle
 * runs. Strings that must keep unpaired surrogates are carried as UTF-16 code-unit arrays.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { hashFields } from '../../src/platform/sync/engine'
import { fieldHashes } from '../../src/platform/sync/merge'
import { HLC_ZERO, HybridLogicalClock, compareHlc, formatHlc, parseHlc } from '../../src/platform/sync/hlc'
import {
  chunkForFiles, decodeJournal, encodeJournal, isValidOp, journalFileName, parseJournalFileName, snapshotFileName,
} from '../../src/platform/sync/journal'
import { compareOrder, isValidOrderKey, keyBetween, keysAfter } from '../../src/platform/sync/fractional'
import type { SyncOp } from '../../src/platform/sync/types'
import * as ref from '../../src/lib/parseRef'
import { normalizeStrongsId, parseStrongsIds } from '../../src/lib/research/strongsId'

export const GOLDEN_FORMAT = 1
const ROOT = resolve(__dirname, '../..')

/** Sources whose behaviour the fixtures pin; their hashes are recorded in every file. */
const SOURCES: Record<string, string[]> = {
  'core-json': ['scripts/golden/corpus.ts'],
  'sync-hash': ['src/platform/sync/engine.ts', 'src/platform/sync/merge.ts'],
  hlc: ['src/platform/sync/hlc.ts'],
  journal: ['src/platform/sync/journal.ts', 'src/platform/sync/types.ts'],
  fractional: ['src/platform/sync/fractional.ts'],
  reference: ['src/lib/parseRef.ts', 'src/lib/hermasMap.ts', 'src/lib/chapterNumbering.ts'],
  strongs: ['src/lib/research/strongsId.ts'],
}

function sourceHashes(name: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of SOURCES[name]) out[p] = createHash('sha256').update(readFileSync(resolve(ROOT, p))).digest('hex')
  return out
}

// ── deterministic randomness ────────────────────────────────────────────────────────────────
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
type Rng = () => number
const int = (r: Rng, n: number) => Math.floor(r() * n)
const pick = <T>(r: Rng, xs: readonly T[]): T => xs[int(r, xs.length)]

const units = (s: string): number[] => Array.from({ length: s.length }, (_, i) => s.charCodeAt(i))
const fromUnits = (u: number[]): string => String.fromCharCode(...u)
const norm = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T

function f64Hex(x: number): string {
  const b = new DataView(new ArrayBuffer(8))
  b.setFloat64(0, x)
  return Array.from({ length: 8 }, (_, i) => b.getUint8(i).toString(16).padStart(2, '0')).join('')
}
function hexF64(h: string): number {
  const b = new DataView(new ArrayBuffer(8))
  for (let i = 0; i < 8; i++) b.setUint8(i, parseInt(h.slice(i * 2, i * 2 + 2), 16))
  return b.getFloat64(0)
}

// Text samples that have broken real sync ports: Hebrew with niqqud, Greek polytonic, emoji
// with ZWJ / skin tone / flags, combining marks, BOM/ZW chars, astral CJK, line separators.
const TEXT_SAMPLES: string[] = [
  '', 'a', 'Yeshua', 'In the beginning', 'בְּרֵאשִׁית בָּרָא אֱלֹהִים', 'יְהוָה', 'χάρις', 'Ἐν ἀρχῇ ἦν ὁ λόγος',
  'ὁ λόγος σὰρξ ἐγένετο', '👍', '👨‍👩‍👧‍👦', '👋🏽', '🇮🇱', 'é', 'é', ' nbsp', '﻿bom', 'zw​j',
  '𝔊𝔬𝔡', '𠀀𠀁', 'line\nbreak', 'tab\there', 'cr\rlf', 'quote"back\\slash', '/slash/', '  ',
  '\u0000\u0001\u001f\u007f', '<script>&amp;</script>', '{"json":true}', 'Gen 1:1', '[[Exod 20:11]]',
  '**bold** _it_ `code`', '# Heading\n\n> quote', '🟡🔴🟢🔵🟣', 'H7225 G3056',
]
// Unpaired surrogates (only representable as code units).
const SURROGATE_SAMPLES: number[][] = [
  [0xd800], [0xdfff], [0x61, 0xd83d], [0xdc4d, 0x62], [0xdc4d, 0xd83d], [0xd83d, 0xdc4d, 0xd83d], [0xdbff, 0xdbff, 0xdfff],
]

function randomString(r: Rng): string {
  const kind = int(r, 6)
  if (kind === 0) return pick(r, TEXT_SAMPLES)
  if (kind === 1) return fromUnits(pick(r, SURROGATE_SAMPLES))
  const n = int(r, 12)
  let s = ''
  for (let i = 0; i < n; i++) {
    const c = int(r, 10)
    if (c < 4) s += String.fromCharCode(0x20 + int(r, 95))
    else if (c < 5) s += String.fromCharCode(int(r, 0x20))
    else if (c < 6) s += String.fromCharCode(0x0590 + int(r, 0x70))
    else if (c < 7) s += String.fromCharCode(0x0370 + int(r, 0x90))
    else if (c < 8) s += String.fromCodePoint(0x1f300 + int(r, 0x300))
    else if (c < 9) s += String.fromCharCode(0xd800 + int(r, 0x800))   // may be unpaired
    else s += String.fromCharCode(int(r, 0x10000))
  }
  return s
}

function randomNumber(r: Rng): number {
  switch (int(r, 9)) {
    case 0: return int(r, 100)
    case 1: return -int(r, 1_000_000)
    case 2: return Math.round(r() * 1e6) / 100
    // Built by parsing a decimal string: correctly rounded on every engine. (`x * 10 ** n` is not —
    // V8 versions differ in Math.pow for negative exponents, which made CI's Node 22 disagree with Node 24.)
    case 3: return Number(`${int(r, 1_000_000_000)}e${int(r, 60) - 39}`)
    case 4: return Date.UTC(2020, 0, 1) + int(r, 2e11)
    case 5: return pick(r, [0, 1, -1, 0.1, 0.2, 0.3, 1e21, 1e-7, 123e-20, 2 ** 53, 2 ** 53 + 2, Number.MAX_SAFE_INTEGER, Number.MIN_VALUE, Number.MAX_VALUE, -0])
    case 6: return hexF64(Array.from({ length: 8 }, () => int(r, 256).toString(16).padStart(2, '0')).join(''))
    case 7: return 1 / (1 + int(r, 999))
    default: return int(r, 2 ** 31) * (r() < 0.5 ? -1 : 1)
  }
}

const KEY_SAMPLES = [
  'id', 'title', 'content', 'book_num', 'chapter', 'verse', 'color', 'created_at', 'updated_at', 'tags', 'order_key',
  'deleted', 'a', 'B', 'b', 'Z', '_', '0', '1', '2', '10', '9', '01', '-1', '1.5', '4294967294', '4294967295', '',
  'ä', 'é', 'é', '中', '😀', 'שם', 'λ', ' ', 'aa', 'a b', '__proto__x',
]

function randomValue(r: Rng, depth: number): unknown {
  const k = int(r, depth > 2 ? 5 : 8)
  if (k === 0) return null
  if (k === 1) return r() < 0.5
  if (k === 2 || k === 3) return randomNumber(r)
  if (k === 4) return randomString(r)
  if (k === 5) return Array.from({ length: int(r, 5) }, () => randomValue(r, depth + 1))
  return randomObject(r, depth + 1)
}

function randomObject(r: Rng, depth: number): Record<string, unknown> {
  const o: Record<string, unknown> = {}
  const n = int(r, depth === 0 ? 9 : 5)
  for (let i = 0; i < n; i++) o[r() < 0.8 ? pick(r, KEY_SAMPLES) : randomString(r)] = randomValue(r, depth)
  return o
}

// ── fixture builders ────────────────────────────────────────────────────────────────────────
export interface GoldenFile { name: string; data: unknown }

function file(name: string, cases: Record<string, unknown>): GoldenFile {
  return { name, data: { ...cases, format: GOLDEN_FORMAT, generator: 'scripts/golden/corpus.ts', sources: sourceHashes(name) } }
}

function coreJson(): GoldenFile {
  const r = mulberry32(0xc0de)
  const numbers: number[] = [
    0, -0, 1, -1, 0.1, 0.5, 1.5, 100, 1e20, 1e21, 1.5e21, 123456789012345680000, 1e-6, 1e-7, 1.234e-7, 0.000001234,
    2 ** 53, 2 ** 53 + 1, 2 ** 63, 2 ** 64, Number.MAX_SAFE_INTEGER, Number.MIN_VALUE, Number.MAX_VALUE, 5e-324,
    2.2250738585072014e-308, 1 / 3, 2 / 3, Math.PI, Math.E, 0.1 + 0.2, 1e300, 9.999999999999999e22, 1e23, 4.35, 0.035,
    NaN, Infinity, -Infinity, 1729, 1761955200000, 1e15, 1e16, 1e17, 123.456, -123.456e-10,
  ]
  for (let i = 0; i < 400; i++) numbers.push(randomNumber(r))
  const numberCases = numbers.map((x) => ({ bits: f64Hex(x), toString: String(x), json: JSON.stringify(x) }))

  const strs: number[][] = TEXT_SAMPLES.map(units).concat(SURROGATE_SAMPLES)
  for (let i = 0; i < 0x80; i++) strs.push([i])
  for (let i = 0; i < 200; i++) strs.push(units(randomString(r)))
  const stringCases = strs.map((u) => ({ units: u, json: JSON.stringify(fromUnits(u)) }))

  // JSON.parse → JSON.stringify round trips: property order (array-index keys first), duplicate
  // keys, escapes, whitespace, number spellings.
  const parseTexts = [
    '{"b":1,"a":2,"2":3,"1":4,"01":5,"-1":6,"4294967295":7,"4294967294":8}',
    '{"a":1,"a":2,"b":3,"a":4}', '{"10":0,"9":0,"x":0,"0":0}', ' \t\r\n[ 1 , 2 ]\r\n', '"\\ud83d\\udc4d"',
    '"\\ud800"', '"\\uDC00x"', '"\\u0000\\u001F\\/\\b\\f\\n\\r\\t\\"\\\\"', '[1e2,1E-2,-0,0.0,1.0e+0,12345678901234567890]',
    '{"nested":{"z":[{"b":1,"a":[]}],"a":{}}}', '[true,false,null]', '1e400', '-1e400', '1e-400', '"é"',
    '{"__proto__":1,"constructor":2}', '[[[[[]]]]]', '{"":"empty key"}', '0', '-0', '" "',
  ]
  const parseCases = parseTexts.map((text) => ({ text, json: JSON.stringify(JSON.parse(text)) }))
  const invalidTexts = [
    '', ' ', '{', '[1,]', '{"a":1,}', "{'a':1}", '01', '1.', '.5', '+1', '-', '1e', '"\t"', '"\\x"', '"\\u12"',
    'undefined', 'NaN', 'Infinity', 'nul', 'tru', '[1 2]', '{"a" 1}', '"abc', '1 2', '  1', '﻿1', '{"a":1}x',
  ]
  for (const t of invalidTexts) { try { JSON.parse(t); throw new Error(`expected invalid: ${t}`) } catch (e) { if (!(e instanceof SyntaxError)) throw e } }
  return file('core-json', { numbers: numberCases, strings: stringCases, parse: parseCases, invalid: invalidTexts })
}

function syncHash(): GoldenFile {
  const r = mulberry32(0x5eed)
  const handmade: Record<string, unknown>[] = [
    {}, { a: 1 }, { b: 1, a: 2 }, { '2': 'x', '10': 'y', b: 'z', a: 'w' }, { nested: { z: 1, a: { d: [{ y: 1, x: 2 }], c: null } } },
    { id: 'n1', title: 'Gen 1:1 — Creation', content: 'In the beginning Yehovah created…', book_num: 1, chapter: 1, verse: 1, color: 'blue', tags: '["creation"]' },
    { text: 'בְּרֵאשִׁית', greek: 'χάρις', emoji: '👨‍👩‍👧‍👦', flag: '🇮🇱' }, { n: 0.1, m: 1e21, k: 1e-7, big: 2 ** 53 + 2, neg: -0 },
    { s: fromUnits([0xd83d]), t: fromUnits([0xdc4d, 0x41]) }, { nul: null, arr: [null, [], {}, [1, [2, [3]]]] },
    { ['é']: 1, ['é']: 2, ['😀']: 3, ['中']: 4, Z: 5, a: 6 },
  ]
  const objects = handmade.map(norm)
  for (let i = 0; i < 300; i++) objects.push(norm(randomObject(r, 0)))
  const cases = objects.map((fields) => ({ fields, recordHash: hashFields(fields), fieldHashes: fieldHashes(fields) }))
  return file('sync-hash', { cases })
}

function hlc(): GoldenFile {
  const r = mulberry32(0x41c)
  const format = [
    { wallMs: 0, counter: 0, deviceId: '' }, { wallMs: 1, counter: 1, deviceId: 'mac' },
    { wallMs: 1761955200000, counter: 0xffff, deviceId: 'abc123' }, { wallMs: 9999999999999, counter: 0xabc, deviceId: 'Ωmega' },
  ].concat(Array.from({ length: 50 }, () => ({ wallMs: int(r, 2e12), counter: int(r, 0x10000), deviceId: pick(r, ['m1', 'i2', 'devABC', 'x']) })))
    .map((h) => ({ ...h, formatted: formatHlc(h) }))
  const parseInputs = [
    HLC_ZERO, '1761955200000-0000-mac', '1761955200000-ffff-dev-with-dash', '1761955200000-FFFF-mac', '176195520000-0000-mac',
    '1761955200000-000-mac', '1761955200000-0000', '1761955200000-0000-', '1761955200000-0000-a\nb', '1761955200000-0000-a ',
    '1761955200000-0000-日本', 'x761955200000-0000-mac', '17619552000001-0000-mac', '', '١٧٦١٩٥٥٢٠٠٠٠٠-0000-mac',
  ]
  const parse = parseInputs.map((s) => { try { return { input: s, result: parseHlc(s) } } catch { return { input: s, result: null } } })
  const samples = parse.filter((p) => p.result).map((p) => p.input).concat(format.map((f) => f.formatted), ['1761955200000-0000-é', '1761955200000-0000-😀', '1761955200000-0000-￿'])
  const compare: Array<{ a: string; b: string; result: number }> = []
  for (let i = 0; i < 120; i++) { const a = pick(r, samples), b = pick(r, samples); compare.push({ a, b, result: compareHlc(a, b) }) }

  // Clock scripts: each step sets the wall clock then ticks or receives.
  const scripts: Array<{ deviceId: string; last?: string; steps: Array<{ now: number; tick?: true; receive?: string; result: string; drift?: number }> }> = []
  for (let s = 0; s < 25; s++) {
    let now = 1761955200000 + int(r, 1e6)
    const deviceId = pick(r, ['mac', 'iphone', 'dev2'])
    const last = s % 4 === 0 ? formatHlc({ wallMs: now + int(r, 5000), counter: int(r, 0x10000), deviceId }) : undefined
    let drift: number | undefined
    const clock = new HybridLogicalClock(deviceId, { now: () => now, last, onDrift: (ms) => { drift = ms } })
    const steps: (typeof scripts)[number]['steps'] = []
    for (let i = 0; i < 40; i++) {
      now += pick(r, [0, 0, 0, 1, 5, -3, 1000, -100000, 3600000])
      drift = undefined
      if (r() < 0.6) {
        steps.push({ now, tick: true, result: clock.tick() })
      } else {
        const remote = formatHlc({ wallMs: now + pick(r, [-5000, 0, 0, 1, 2000, 3600000, 3600001, 7200000]), counter: pick(r, [0, 1, 0xfffe, 0xffff, int(r, 0x10000)]), deviceId: 'other' })
        clock.receive(remote)
        steps.push({ now, receive: remote, result: clock.latest(), ...(drift !== undefined ? { drift } : {}) })
      }
    }
    scripts.push({ deviceId, ...(last ? { last } : {}), steps })
  }
  return file('hlc', { zero: HLC_ZERO, formatCases: format, parse, compare, scripts })
}

function makeOp(r: Rng, seq: number): SyncOp {
  const op: SyncOp = {
    id: `op-${seq}-${int(r, 1e6)}`, seq, hlc: formatHlc({ wallMs: 1761955200000 + seq * 7, counter: int(r, 3), deviceId: 'devA' }),
    device: 'devA', entity: pick(r, ['note', 'highlight', 'tab', 'verse_tag']), key: `k${int(r, 50)}`, op: r() < 0.85 ? 'upsert' : 'delete', schema: 48,
  }
  if (op.op === 'upsert') { op.fields = norm(randomObject(r, 1)); op.fh = fieldHashes(op.fields) }
  if (r() < 0.5) op.base = formatHlc({ wallMs: 1761955100000 + seq, counter: 0, deviceId: 'devB' })
  if (r() < 0.3) op.lin = [op.hlc]
  return op
}

function journal(): GoldenFile {
  const r = mulberry32(0x10a)
  const fileNames = [0, 1, 42, 999999999, 1000000000, 123456].map((seq) => ({ seq, snapshot: snapshotFileName(seq) }))
  const journalNames = [[1, 1], [1, 500], [501, 1000], [999999998, 999999999], [1000000000, 1000000001]].map(([a, b]) => ({ seqFrom: a, seqTo: b, name: journalFileName(a, b) }))
  const parseNames = [
    'journal-000000001-000000500.jsonl', 'journal-000000001-000000500.json', 'journal-1-2.jsonl', 'journal-000000001-0000005000.jsonl',
    'Journal-000000001-000000500.jsonl', 'journal-00000000a-000000500.jsonl', 'snapshot-000000001.json', 'journal-١٢٣٤٥٦٧٨٩-000000500.jsonl',
    'journal-999999999-000000001.jsonl', ' journal-000000001-000000500.jsonl',
  ].map((name) => ({ name, result: parseJournalFileName(name) }))

  const ops: SyncOp[] = norm(Array.from({ length: 40 }, (_, i) => makeOp(r, i + 1)))
  const encoded = encodeJournal(ops)
  const validBase = { id: 'x', seq: 1, hlc: '1761955200000-0000-dev', device: 'dev', entity: 'note', key: 'k', op: 'upsert', fields: {}, schema: 48 }
  const variants: unknown[] = [
    validBase, { ...validBase, op: 'delete', fields: undefined }, { ...validBase, seq: 0 }, { ...validBase, seq: 1.5 }, { ...validBase, seq: '1' },
    { ...validBase, hlc: '1761955200000-0000-de-v' }, { ...validBase, hlc: '1761955200000-0000-de v' }, { ...validBase, hlc: '1761955200000-0000-de v' },
    { ...validBase, hlc: '1761955200000-0000-' }, { ...validBase, device: '' }, { ...validBase, entity: '' }, { ...validBase, key: '' },
    { ...validBase, op: 'merge' }, { ...validBase, fields: null }, { ...validBase, fields: [] }, { ...validBase, op: 'delete', fields: null },
    { ...validBase, base: null }, { ...validBase, base: 7 }, { ...validBase, base: '1761955200000-0000-x' }, { ...validBase, schema: '48' },
    { ...validBase, fh: null }, { ...validBase, fh: {} }, { ...validBase, fh: { a: 1 } }, { ...validBase, fh: [] }, { ...validBase, lin: [] },
    { ...validBase, lin: ['a', 1] }, { ...validBase, lin: {} }, [], null, 'string', 1, { ...validBase, seq: 1e21 }, { ...validBase, extra: { deep: [1] } },
  ]
  const isValid = variants.map((v) => { const value = norm(v); return { value, valid: isValidOp(value) } })

  const lines = encoded.split('\n')
  const decodeTexts = [
    '', '\n', encoded, encoded.slice(0, -1), encoded.slice(0, Math.floor(encoded.length / 2)), `${lines[0]}\r\n${lines[1]}\n`,
    `${lines[0]}\n{garbage\n\n   \n${lines[2]}\n`, `${lines[0]}\n${JSON.stringify({ ...validBase, seq: 0 })}\n`, ` \n﻿\n${lines[3]}\n`,
    `${lines[0]}\n[1,2]\n"str"\nnull\n`,
  ]
  const decode = decodeTexts.map((text) => ({ text, result: decodeJournal(text) }))

  // Chunking: many ops (size + count caps). Content is summarised (length + FNV) to keep the file small.
  const bigOps: SyncOp[] = []
  for (let i = 1; i <= 1400; i++) {
    const op = makeOp(r, i)
    if (i % 97 === 0 && op.fields) op.fields.blob = 'x'.repeat(40_000 + int(r, 30_000)) + '💡'.repeat(int(r, 300))
    bigOps.push(op)
  }
  const normBig = norm(bigOps)
  const fnv = (s: string) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 } return h.toString(16).padStart(8, '0') }
  const chunks = chunkForFiles(normBig).map((c) => ({ info: c.info, length: c.content.length, fnv: fnv(c.content) }))
  return file('journal', { fileNames, journalNames, parseNames, ops, encoded, isValid, decode, chunk: { ops: normBig, chunks } })
}

function fractional(): GoldenFile {
  const r = mulberry32(0xf7ac)
  const keyCase = (a?: string, b?: string) => { try { return { a: a ?? null, b: b ?? null, result: keyBetween(a, b) } } catch { return { a: a ?? null, b: b ?? null, result: null } } }
  const between = [
    keyCase(), keyCase('a0'), keyCase(undefined, 'a0'), keyCase('a0', 'a1'), keyCase('a0', 'a0V'), keyCase('a0V', 'a1'), keyCase('a1', 'a0'),
    keyCase('a0', 'a0'), keyCase('Zz'), keyCase(undefined, 'Zz'), keyCase('zzzzzzzzzzzzzzzzzzzzzzzzzzz'), keyCase(undefined, 'A00000000000000000000000001'),
    keyCase('A000000000000000000000000001'), keyCase('a00'), keyCase('a'), keyCase(''), keyCase('a0!'), keyCase('b00'), keyCase('a0', 'b00'),
    keyCase('az', 'b00'), keyCase('a1', 'a2'), keyCase('a0z', 'a1'), keyCase('a0zzz', 'a1'), keyCase('a0', 'a00001'), keyCase('Y00'), keyCase(undefined, 'Y00'),
    keyCase('a0é'), keyCase('é0'), keyCase('A00000000000000000000000000'), keyCase(undefined, 'A000000000000000000000000001'),
  ]
  // Random insertion walk: keep a sorted list, insert between random neighbours / at the ends.
  const walk: Array<{ a: string | null; b: string | null; result: string }> = []
  const list: string[] = [keyBetween(undefined, undefined)]
  for (let i = 0; i < 600; i++) {
    const pos = int(r, list.length + 1)
    const a = pos > 0 ? list[pos - 1] : undefined
    const b = pos < list.length ? list[pos] : undefined
    const k = keyBetween(a, b)
    walk.push({ a: a ?? null, b: b ?? null, result: k })
    list.splice(pos, 0, k)
  }
  const after = [{ a: null, n: 5 }, { a: 'a0', n: 70 }, { a: 'Zz', n: 3 }, { a: 'zzzzzzzzzzzzzzzzzzzzzzzzzzy', n: 3 }].map(({ a, n }) => ({ a, n, result: keysAfter(a ?? undefined, n) }))
  const validInputs = ['a0', 'a', '', 'a00', 'a0V', 'A00000000000000000000000000', 'Zz', 'Z0', 'b00', 'b0', 'a0é', '😀0', 'zzzzzzzzzzzzzzzzzzzzzzzzzzz', 'a0 ']
  const valid = validInputs.map((key) => ({ key, valid: isValidOrderKey(key) }))
  const items = list.slice(0, 40).flatMap((k, i) => [{ orderKey: k, id: `id${i}` }, { orderKey: k, id: `Id${i}` }])
  const compare: Array<{ a: { orderKey: string; id: string }; b: { orderKey: string; id: string }; result: number }> = []
  for (let i = 0; i < 100; i++) { const a = pick(r, items), b = pick(r, items); compare.push({ a, b, result: compareOrder(a, b) }) }
  return file('fractional', { between, walk, after, valid, compare })
}

function reference(): GoldenFile {
  const r = mulberry32(0x7ef)
  const calls: Array<{ fn: string; args: unknown[]; hermas?: string; out: unknown }> = []
  const HERMAS = ['hermas', 'hermas_taylor']
  const call = (fn: string, args: unknown[], hermas?: string) => {
    if (hermas) ref.setHermasTextId(hermas)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = norm((ref as any)[fn](...args) ?? null)
    if (hermas) ref.setHermasTextId('hermas')
    calls.push({ fn, args, ...(hermas ? { hermas } : {}), out })
  }
  const books = ref.ALL_BOOKS
  const misspell = (w: string): string[] => {
    const out: string[] = []
    if (w.length > 4) {
      const i = 1 + int(r, w.length - 2)
      out.push(w.slice(0, i) + w.slice(i + 1))                       // drop
      out.push(w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2))      // swap
      out.push(w.slice(0, i) + w[i] + w.slice(i))                     // double
      out.push(w.slice(0, i) + 'x' + w.slice(i + 1))                  // substitute
    }
    return out
  }

  // Book tokens: every pattern and name, case variants, prefixes, misspellings, junk.
  const tokens = new Set<string>(['', ' ', 'a', 'jo', 'j', 'to', 'II Kings', 'III John', 'I Sam', 'i samuel', 'iii jn', 'iv kings',
    'song of solomon 1', 'vsdeuteronomy', 'Genesys', 'Corinthans', '1 Corinthans', 'Deuteronmy', 'Philipians', 'Revelaton', 'Room', 'Gen.', 'Ge n', 'GEN', 'gEnEsIs', 'Ἰησοῦς', 'בראשית', 'Ps', 'Pss', 'man', 'Hermas', 'recognitions'])
  for (const b of books) {
    tokens.add(b.name); tokens.add(b.name.toUpperCase()); tokens.add(b.name.toLowerCase()); tokens.add(` ${b.name}  `)
    for (const p of b.patterns) tokens.add(p)
    const ns = b.name.toLowerCase().replace(/\s+/g, '')
    for (let k = 2; k < Math.min(ns.length, 6); k++) tokens.add(ns.slice(0, k))
    for (const m of misspell(b.name.toLowerCase())) tokens.add(m)
  }
  for (let i = 0; i < 60; i++) tokens.add(randomString(r))
  for (const t of tokens) { call('resolveBookToken', [t]); call('isExactBookToken', [t]) }

  // parseRef inputs.
  const inputs = new Set<string>()
  const forms = ['# 1', '# 1:1', '#1:1', '#. 2:3', '# 3:4-5', '# 3:4–6', '# 2-3', '# 1:2-3:4', '# 1:2,4,6-8', '# 1 2', '# 1:1 LXX', '# 1:1 lxx',
    '# 999', '# 1:201', '# Chapter 2', '#, 3:1', '# 0', '# 1:0', '# 1.5', '# 2 : 3', '# 1:2, 5', '# 1:2,x', '# 1:3,250', '  #   4:5  ', '# 1:2 - 3', '# 1:1 LXXX']
  for (const b of books) {
    for (const f of forms) inputs.add(f.replace('#', b.name))
    // Boundaries: verse cap (200) and each book's chapter cap.
    for (const f of ['# 1:200', '# 1:3-200', '# 1:2,200', '# 1:2,201', '# 1:199-201']) inputs.add(f.replace('#', b.name))
    const max = ref.maxChapterFor(b.id)
    if (max !== undefined) for (const c of [max, max + 1]) { inputs.add(`${b.name} ${c}`); inputs.add(`${b.name} ${c}:1`); inputs.add(`${b.name} 1-${c}`) }
    for (const p of b.patterns) inputs.add(`${p} 1:1`)
    inputs.add(`${pick(r, b.patterns)} ${1 + int(r, 30)}:${1 + int(r, 40)}`)
    inputs.add(`${b.name.toUpperCase()} 1`)
  }
  for (const s of ['', '   ', 'Gen', '1:1', 'Gen 1:1:1', 'John3:16', 'jn 3 16', '1 sam 2 3', 'gen 1 1', 'james 1 15', 'song of solomon 1 1',
    'Isa. 53:5', 'Gen. 1:1', '1 Cor. 13:4', 'Rec. Clem. IV 35', 'Recognitions 4:35', 'Recognitions of Clement 4:35', 'RCL 4:35', 'RCL 4 25:1',
    'rcl x 3', 'rcl 11 3', 'rcl 4', 'Recognitions, Book 10 41:8', 'Recognitions of Clement, Book 10, Chapter 41:8', 'Recognitions, Book 3, Chapter 12',
    'Recognitions, Book 3 5', 'Recognitions, Book 3 12:1', 'Recognitions, Book 3 76', 'Recognitions, Book 11 1', 'RCL3 12', 'RCL3 2', 'Hermas Vision 2 3:1',
    'Shepherd of Hermas, Mandate 4', 'Hermas Similitude 9', 'Shepherd of Hermas, Vision 2.1:2', 'her vis 3', 'Hermas, Visions 5:2', 'Hermas, Similitudes, 35:1',
    'Hermas Mandate 5 2', 'Hermas Mandate 13', 'Hermas Vision 3.14', 'Hosea 13-14', 'Isaiah 63:17-64:3', 'Deuteronomy 32:3-4,6', 'Deuteronomy 32:3,6,9-13,23,25',
    'Deut 32:3,6 and then', 'is 99', 'is 5', 'am 3', 'Psalm 119:176', 'Psalm 151', 'Ps 23', 'Pss 3', 'II Kings 2:1', 'III John 1:2', 'I Sam 3',
    'Genesys 1:1', 'Revelaton 22:21', 'Room 5', 'Isaiah 66:3 LXX', 'Gen\t1:1', 'Gen 1:1', 'Gen 1:1', 'Gen 1:1\n', 'Ｇｅｎ 1:1', 'Gen ١:١',
    'Gen 1-', 'Gen 1:', 'Exod 20:1–17', 'Exod 20:1—17', 'Didache 1:1', 'Jude 1:3', 'Obadiah 1', 'Obadiah 2', '1Jn 1:9', '1 jo 1:9', '3 John 1:4'])
    inputs.add(s)
  for (let i = 0; i < 150; i++) inputs.add(`${pick(r, [...tokens])} ${int(r, 200)}${r() < 0.6 ? `:${int(r, 210)}` : ''}${r() < 0.2 ? `-${int(r, 50)}` : ''}`)
  for (const s of inputs) {
    call('parseRef', [s])
    if (/her|shep/i.test(s)) call('parseRef', [s], 'hermas_taylor')
  }

  // Canonical conversions.
  const canon = ['GEN.1.1', 'GEN.1.0', 'GEN.1', 'GEN', 'XYZ.1.1', 'RCL3.2.1', 'RCL3.1.1', 'HER_VIS.5.2', 'PSA.119.176', '1CO.13.4', 'gen.1.1', 'GEN.x.1', 'GEN.1.x', 'GEN..1', '.1.1', 'DID.1.1', 'GEN.1.1.1']
  for (const s of [...inputs].slice(0, 400).concat(['GEN.1.1', 'Gen 1.1', 'gen.1.1', 'Genesis 1:1', 'Hosea 13-14', 'Gen 1:2-3'])) call('toCanonical', [s])
  for (const c of canon) for (const fn of ['toFilename', 'toUIDisplay', 'toWikilink', 'toRelatedVerse', 'parseCanonical']) call(fn, [c])
  for (const [b, c, v] of [['GEN', 1, 1], ['GEN', 1, undefined], ['RCL3', 2, 0]] as const) call('createCanonical', v === undefined ? [b, c] : [b, c, v])

  // Labels.
  for (const b of books) {
    call('bookName', [b.id]); call('bookOrder', [b.id]); call('maxChapterFor', [b.id])
    for (const ch of [1, 2, 3, 12, 25, 65]) {
      for (const h of HERMAS) {
        if (h === 'hermas_taylor' && !b.id.startsWith('HER_')) continue
        call('bookChapterVerseLabel', [b.id, ch], h); call('bookChapterVerseLabel', [b.id, ch, 7], h)
      }
      call('bookChapterHoverLabel', [b.id, ch]); call('bookChapterLabel', [b.id, ch])
    }
    for (const h of HERMAS) call('getTranslationForBook', [b.id], h)
  }
  for (const id of ['XYZ', '', 'gen']) { call('bookName', [id]); call('bookOrder', [id]); call('bookChapterVerseLabel', [id, 3, 4]) }
  for (const n of ['I Samuel', 'II Kings', 'III John', 'IV Maccabees', 'Revelation of John', 'Revelation of John 2', 'Recognitions of Clement — Book VII', 'Book XVI', 'Book IV and Book V', 'I', 'Isaiah', 'IIKings', ''])
    call('normalizeBookName', [n])
  for (const [n, id] of [['I John', '1JN'], ['3MA', '3MA'], ['', 'GEN'], ['  ', 'XYZ'], ['Genesis', undefined], ['ii maccabees', '2MA']] as const) call('displayBookName', id === undefined ? [n] : [n, id])
  for (const d of ['PRO.30.26', 'RCL3.2.1', 'HER_VIS.9', 'GEN', 'GEN.x', 'GEN.1.x', 'XYZ.1.2']) for (const h of HERMAS) call('formatDottedVerseRef', [d], h)
  for (const [v, t] of [['DEU.29.3', 'kjva'], ['DEU.29.3', 'LXX'], ['DEU.29.3-5', undefined], ['DEU.29.3-3', undefined], ['GEN.1.1,GEN.1.3', 'lxx'], ['', undefined], ['garbage', undefined], [' GEN.1 , EXO.2.3 ', null]] as const)
    call('verseRefDisplay', t === undefined ? [v] : [v, t])
  for (const t of ['enoch', 'ENOCH', 'hermas_taylor', 'kjv', 'lxx', 'didache_hoole', '']) call('isDedicatedTranslation', [t])
  for (const s of ['H7225', 'g3056', ' G1 ', 'H123456', 'X1', 'H', 'h0']) call('isStrongsRef', [s])
  for (const s of ['in the beginning', "Yehovah's word", 'a b c', '  ', 'AND OR NOT "quoted" (x)', 'é ü', 'H7225*']) call('safeFtsQuery', [s])
  return file('reference', { calls })
}

function strongs(): GoldenFile {
  const r = mulberry32(0x57a0)
  const texts = [
    '', 'G5485', 'g5485', 'G-5485', 'G 5485', 'H02617', 'G–25', 'G‐25', 'G‑25', 'G‒25', 'G—25', 'G 5485', 'G  5485', 'G - 5485',
    '5G', 'H2O2', 'AG5485', 'G548501', 'G54850', 'G0', 'G00', 'G000123', 'H7225a', 'H7225ab', 'H7225A', 'H1234567', 'G5485 and H2617 and g5485',
    'grace (G5485) mercy (H2617).', 'éG12', 'G12é', '١G12', 'G12٣', '😀G12😀', 'xG12', '_G12', 'G12_', 'H 1', 'H​1', 'h 0001b',
    'What does G26 mean vs H157?', 'G1 G2 G3 G1 g2', 'G\t\t5', 'G- 5', 'Strong\'s G26', 'G\n26', 'H8674', 'H8675',
  ]
  for (let i = 0; i < 150; i++) {
    const parts = Array.from({ length: 1 + int(r, 4) }, () => pick(r, ['G', 'H', 'g', 'h', 'x', ' ', '-', '–', '0', '00', `${int(r, 99999)}`, 'a', 'é', '😀', ' ', '1234567', '(', ')']))
    texts.push(parts.join(''))
  }
  const cases = texts.map((text) => ({ text, ids: norm(parseStrongsIds(text)), normalized: normalizeStrongsId(text) }))
  return file('strongs', { cases })
}

export function buildGoldenCorpus(): GoldenFile[] {
  return [coreJson(), syncHash(), hlc(), journal(), fractional(), reference(), strongs()]
}

/** Canonical on-disk text (stable across runs; `JSON.stringify` escapes unpaired surrogates). */
export function serializeGolden(f: GoldenFile): string {
  return JSON.stringify(f.data, null, 1) + '\n'
}

export const GOLDEN_DIR = resolve(ROOT, 'Packages/BereanKit/Tests/BereanConformanceTests/Golden')
