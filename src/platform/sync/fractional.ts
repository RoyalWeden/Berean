/**
 * Fractional indexing for orderable synced records (docs/mobile/icloud.md §4.6).
 *
 * Port of the well-known "fractional-indexing" algorithm (David Greenspan) over a base-62
 * alphabet: an order key is `<integer part><fraction part>`; keys compare as plain strings,
 * there is always a key strictly between any two, appending at either end only bumps the
 * integer part (so keys stay short under the common "add tab at the end" pattern), and two
 * devices inserting at the same spot concurrently produce keys that merge deterministically
 * (ties broken by record id in `compareOrder`).
 *
 * Integer part: first char is a length marker — 'a'..'z' = positive with 1..26 following digits,
 * 'A'..'Z' = negative with 26..1 following digits. Fraction part: digits, never ending in '0'.
 * The first key ever generated is "a0".
 */
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const SMALLEST_INT = 'A' + '0'.repeat(26)

function integerLength(head: string): number {
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 'a'.charCodeAt(0) + 2
  if (head >= 'A' && head <= 'Z') return 'Z'.charCodeAt(0) - head.charCodeAt(0) + 2
  throw new Error(`invalid order key head: ${JSON.stringify(head)}`)
}

function integerPart(key: string): string {
  const n = integerLength(key[0])
  if (n > key.length) throw new Error(`invalid order key: ${key}`)
  return key.slice(0, n)
}

function validateInteger(int: string): void {
  if (int.length !== integerLength(int[0])) throw new Error(`invalid integer part: ${int}`)
}

function validateOrderKey(key: string): void {
  if (key === SMALLEST_INT) throw new Error(`invalid order key: ${key}`)
  const i = integerPart(key)
  const f = key.slice(i.length)
  if (f.slice(-1) === '0') throw new Error(`invalid order key (trailing 0): ${key}`)
  for (const ch of key.slice(1)) if (!DIGITS.includes(ch)) throw new Error(`invalid order key character in ${key}`)
}

function incrementInteger(x: string): string | null {
  validateInteger(x)
  const [head, ...digs] = x.split('')
  let carry = true
  for (let i = digs.length - 1; carry && i >= 0; i--) {
    const d = DIGITS.indexOf(digs[i]) + 1
    if (d === DIGITS.length) digs[i] = '0'
    else { digs[i] = DIGITS[d]; carry = false }
  }
  if (carry) {
    if (head === 'Z') return 'a0'
    if (head === 'z') return null
    const h = String.fromCharCode(head.charCodeAt(0) + 1)
    if (h > 'a') digs.push('0')
    else digs.pop()
    return h + digs.join('')
  }
  return head + digs.join('')
}

function decrementInteger(x: string): string | null {
  validateInteger(x)
  const [head, ...digs] = x.split('')
  let borrow = true
  for (let i = digs.length - 1; borrow && i >= 0; i--) {
    const d = DIGITS.indexOf(digs[i]) - 1
    if (d === -1) digs[i] = DIGITS.slice(-1)
    else { digs[i] = DIGITS[d]; borrow = false }
  }
  if (borrow) {
    if (head === 'a') return 'Z' + DIGITS.slice(-1)
    if (head === 'A') return null
    const h = String.fromCharCode(head.charCodeAt(0) - 1)
    // Negative heads gain a digit as they decrease ('Z' has 1 digit, 'Y' has 2 …); positive
    // heads lose one ('c' → 'b').
    if (h < 'Z') digs.push(DIGITS.slice(-1))
    else digs.pop()
    return h + digs.join('')
  }
  return head + digs.join('')
}

/** Midpoint of two fraction parts (`a` < `b`; `b` null = open upper end). */
function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) throw new Error(`midpoint: ${a} >= ${b}`)
  if (a.slice(-1) === '0' || (b && b.slice(-1) === '0')) throw new Error('midpoint: trailing zero')
  if (b) {
    let n = 0
    while ((a[n] || '0') === b[n]) n++
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n))
  }
  const digitA = a ? DIGITS.indexOf(a[0]) : 0
  const digitB = b !== null ? DIGITS.indexOf(b[0]) : DIGITS.length
  if (digitB - digitA > 1) {
    return DIGITS[Math.round(0.5 * (digitA + digitB))]
  }
  if (b && b.length > 1) return b.slice(0, 1)
  return DIGITS[digitA] + midpoint(a.slice(1), null)
}

/**
 * A key strictly between `a` and `b`. Pass `undefined` for an open end: `keyBetween(undefined, b)`
 * sorts before b, `keyBetween(a, undefined)` sorts after a, `keyBetween(undefined, undefined)`
 * is the first key ("a0").
 */
export function keyBetween(a: string | undefined, b: string | undefined): string {
  if (a !== undefined) validateOrderKey(a)
  if (b !== undefined) validateOrderKey(b)
  if (a !== undefined && b !== undefined && a >= b) throw new Error(`keyBetween: ${a} is not < ${b}`)
  if (a === undefined) {
    if (b === undefined) return 'a0'
    const ib = integerPart(b)
    const fb = b.slice(ib.length)
    if (ib === SMALLEST_INT) return ib + midpoint('', fb)
    if (ib < b) return ib
    const res = decrementInteger(ib)
    if (res === null) throw new Error('keyBetween: range underflow')
    return res
  }
  if (b === undefined) {
    const ia = integerPart(a)
    const fa = a.slice(ia.length)
    const i = incrementInteger(ia)
    return i === null ? ia + midpoint(fa, null) : i
  }
  const ia = integerPart(a)
  const fa = a.slice(ia.length)
  const ib = integerPart(b)
  const fb = b.slice(ib.length)
  if (ia === ib) return ia + midpoint(fa, fb)
  const i = incrementInteger(ia)
  if (i === null) throw new Error('keyBetween: range overflow')
  if (i < b) return i
  return ia + midpoint(fa, null)
}

/** `n` keys after `a` (or from the start when `a` is undefined), ascending. */
export function keysAfter(a: string | undefined, n: number): string[] {
  const out: string[] = []
  let prev = a
  for (let i = 0; i < n; i++) {
    const k = keyBetween(prev, undefined)
    out.push(k)
    prev = k
  }
  return out
}

/** Stable comparison for records carrying an order key, tie-broken by id so two devices that
 *  chose the same key still converge to one order. */
export function compareOrder(a: { orderKey: string; id: string }, b: { orderKey: string; id: string }): number {
  if (a.orderKey < b.orderKey) return -1
  if (a.orderKey > b.orderKey) return 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function isValidOrderKey(key: string): boolean {
  try { validateOrderKey(key); return true } catch { return false }
}
