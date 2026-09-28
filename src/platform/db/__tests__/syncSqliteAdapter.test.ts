import { describe, it, expect } from 'vitest'
import { memoryDb } from './testDb'

describe('SyncSqliteAdapter (node:sqlite driver)', () => {
  it('runs basic CRUD with positional params and reports changes/lastInsertRowid', async () => {
    const db = memoryDb()
    await db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, n INTEGER)')
    const r1 = await db.run('INSERT INTO t (name, n) VALUES (?, ?)', ['a', 1])
    expect(r1.changes).toBe(1)
    expect(r1.lastInsertRowid).toBe(1)
    await db.run('INSERT INTO t (name, n) VALUES (?, ?)', ['b', 2])
    expect(await db.all('SELECT name FROM t ORDER BY id')).toEqual([{ name: 'a' }, { name: 'b' }])
    expect(await db.get('SELECT n FROM t WHERE name = ?', ['b'])).toEqual({ n: 2 })
    expect(await db.get('SELECT n FROM t WHERE name = ?', ['zz'])).toBeUndefined()
    // undefined param binds as NULL rather than throwing
    const r2 = await db.run('INSERT INTO t (name, n) VALUES (?, ?)', ['c', undefined])
    expect(r2.changes).toBe(1)
    expect(await db.get('SELECT n FROM t WHERE name = ?', ['c'])).toEqual({ n: null })
  })

  it('commits a transaction and rolls back on throw', async () => {
    const db = memoryDb()
    await db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)')
    const out = await db.transaction(async (tx) => {
      await tx.run('INSERT INTO t (v) VALUES (?)', ['x'])
      await tx.run('INSERT INTO t (v) VALUES (?)', ['y'])
      return (await tx.all('SELECT v FROM t')).length
    })
    expect(out).toBe(2)
    await expect(db.transaction(async (tx) => {
      await tx.run('INSERT INTO t (v) VALUES (?)', ['z'])
      throw new Error('boom')
    })).rejects.toThrow('boom')
    expect(await db.all('SELECT v FROM t ORDER BY id')).toEqual([{ v: 'x' }, { v: 'y' }])
  })

  it('nested transactions use savepoints: inner rollback keeps outer work', async () => {
    const db = memoryDb()
    await db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)')
    await db.transaction(async (tx) => {
      await tx.run('INSERT INTO t (v) VALUES (?)', ['outer'])
      await tx.transaction(async (inner) => {
        await inner.run('INSERT INTO t (v) VALUES (?)', ['inner'])
        throw new Error('inner fails')
      }).catch(() => {})
      await tx.run('INSERT INTO t (v) VALUES (?)', ['after'])
    })
    expect((await db.all<{ v: string }>('SELECT v FROM t ORDER BY id')).map((r) => r.v)).toEqual(['outer', 'after'])
  })

  it('serialises outside statements behind an open transaction', async () => {
    const db = memoryDb()
    await db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)')
    const order: string[] = []
    let release!: () => void
    const gate = new Promise<void>((res) => { release = res })
    const tx = db.transaction(async (h) => {
      await h.run('INSERT INTO t (v) VALUES (?)', ['in-tx'])
      order.push('tx-insert')
      await gate               // deliberately hold the transaction open across a real async gap
      order.push('tx-end')
    })
    // An outside write issued while the transaction is open must not run until it commits.
    const outside = db.run('INSERT INTO t (v) VALUES (?)', ['outside']).then(() => order.push('outside'))
    await new Promise((r) => setTimeout(r, 10))
    expect(order).toEqual(['tx-insert'])
    release()
    await Promise.all([tx, outside])
    expect(order).toEqual(['tx-insert', 'tx-end', 'outside'])
    expect((await db.all<{ v: string }>('SELECT v FROM t ORDER BY id')).map((r) => r.v)).toEqual(['in-tx', 'outside'])
  })

  it('two transactions never overlap', async () => {
    const db = memoryDb()
    await db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)')
    const log: string[] = []
    const a = db.transaction(async (tx) => { log.push('a1'); await tx.run('INSERT INTO t (v) VALUES (?)', ['a']); await new Promise((r) => setTimeout(r, 5)); log.push('a2') })
    const b = db.transaction(async (tx) => { log.push('b1'); await tx.run('INSERT INTO t (v) VALUES (?)', ['b']); log.push('b2') })
    await Promise.all([a, b])
    expect(log).toEqual(['a1', 'a2', 'b1', 'b2'])
  })

  it('supports FTS5 MATCH and ATTACH', async () => {
    const db = memoryDb()
    await db.exec("CREATE VIRTUAL TABLE f USING fts5(text); INSERT INTO f VALUES ('in the beginning'); INSERT INTO f VALUES ('the end')")
    expect(await db.all('SELECT text FROM f WHERE f MATCH ?', ['beginning'])).toEqual([{ text: 'in the beginning' }])
    await db.attach(':memory:', 'other')
    await db.exec('CREATE TABLE other.o (x INTEGER); INSERT INTO other.o VALUES (7)')
    expect(await db.get('SELECT x FROM other.o')).toEqual({ x: 7 })
    await db.detach('other')
    await expect(db.attach(':memory:', 'bad alias;')).rejects.toThrow(/Invalid ATTACH alias/)
  })
})
