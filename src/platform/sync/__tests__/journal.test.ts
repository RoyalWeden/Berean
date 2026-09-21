import { describe, it, expect } from 'vitest'
import { chunkForFiles, decodeJournal, encodeJournal, isValidOp, journalFileName, parseJournalFileName, JOURNAL_MAX_OPS } from '../journal'
import type { SyncOp } from '../types'

const op = (seq: number, over: Partial<SyncOp> = {}): SyncOp => ({
  id: `id${seq}`, seq, hlc: `${String(1700000000000 + seq).padStart(13, '0')}-0000-dev`, device: 'dev', entity: 'note', key: `k${seq}`, op: 'upsert', fields: { title: 't' }, schema: 44, ...over,
})

describe('journal encoding', () => {
  it('round-trips ops line by line and names files by seq range', () => {
    const ops = [op(1), op(2, { op: 'delete', fields: undefined }), op(3, { base: '1700000000000-0000-x' })]
    const text = encodeJournal(ops)
    expect(text.endsWith('\n')).toBe(true)
    const d = decodeJournal(text)
    expect(d.ops).toEqual(ops)
    expect(d.unreadable).toBe(0)
    expect(d.truncated).toBe(false)
    expect(journalFileName(1, 3)).toBe('journal-000000001-000000003.jsonl')
    expect(parseJournalFileName('journal-000000001-000000003.jsonl')).toEqual({ name: 'journal-000000001-000000003.jsonl', seqFrom: 1, seqTo: 3 })
    expect(parseJournalFileName('manifest.json')).toBeNull()
    // lexical order == seq order
    expect(journalFileName(9, 9) < journalFileName(10, 10)).toBe(true)
  })

  it('tolerates a truncated last line and skips unreadable lines', () => {
    const text = encodeJournal([op(1), op(2)])
    const cut = text.slice(0, -5)
    const d = decodeJournal(cut)
    expect(d.ops.map((o) => o.seq)).toEqual([1])
    expect(d.truncated).toBe(true)
    const junk = `${JSON.stringify(op(1))}\nnot json\n{"id":"x"}\n${JSON.stringify(op(3))}\n`
    const d2 = decodeJournal(junk)
    expect(d2.ops.map((o) => o.seq)).toEqual([1, 3])
    expect(d2.unreadable).toBe(2)
  })

  it('validates op shape strictly', () => {
    expect(isValidOp(op(1))).toBe(true)
    expect(isValidOp({ ...op(1), seq: 0 })).toBe(false)
    expect(isValidOp({ ...op(1), hlc: 'nope' })).toBe(false)
    expect(isValidOp({ ...op(1), op: 'merge' })).toBe(false)
    expect(isValidOp({ ...op(1), fields: undefined })).toBe(false)   // upsert needs fields
    expect(isValidOp({ ...op(1), op: 'delete', fields: undefined })).toBe(true)
    expect(isValidOp({ ...op(1), base: 5 })).toBe(false)
    expect(isValidOp(null)).toBe(false)
  })

  it('chunks into files by op count and byte size, keeping seq ranges contiguous', () => {
    const many = Array.from({ length: JOURNAL_MAX_OPS + 10 }, (_, i) => op(i + 1))
    const files = chunkForFiles(many)
    expect(files.length).toBe(2)
    expect(files[0].info).toMatchObject({ seqFrom: 1, seqTo: JOURNAL_MAX_OPS })
    expect(files[1].info).toMatchObject({ seqFrom: JOURNAL_MAX_OPS + 1, seqTo: JOURNAL_MAX_OPS + 10 })
    const big = Array.from({ length: 5 }, (_, i) => op(i + 1, { fields: { content: 'x'.repeat(100_000) } }))
    const byBytes = chunkForFiles(big)
    expect(byBytes.length).toBe(3)   // ~100 KB each, 256 KB cap → 2 per file
    expect(chunkForFiles([])).toEqual([])
  })
})
