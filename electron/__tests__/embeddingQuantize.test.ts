import { describe, it, expect } from 'vitest'
import { quantizeEmbedding, dequantizeEmbedding, cosineSimilarity } from '../embeddingQuantize'

describe('embedding quantization round-trip', () => {
  it('reconstructs a vector within int8 quantization tolerance', () => {
    const original = [0.5, -0.25, 1.0, -1.0, 0.001, 3.7, -3.7]
    const { bytes, scale } = quantizeEmbedding(original)
    const back = dequantizeEmbedding(bytes, scale)
    for (let i = 0; i < original.length; i++) {
      // Max possible error per component is half the quantization step (scale), since rounding
      // to the nearest int8 level can be off by at most 0.5 steps.
      expect(Math.abs(back[i] - original[i])).toBeLessThanOrEqual(scale / 2 + 1e-9)
    }
  })

  it('uses the full int8 range for the largest-magnitude component', () => {
    const { bytes } = quantizeEmbedding([1, -4, 2])
    // -4 is the max-abs component -> should map to -127 (the extreme of the int8 range).
    expect(bytes[1]).toBe(-127)
  })

  it('does not throw or divide by zero for an all-zero vector', () => {
    const { bytes, scale } = quantizeEmbedding([0, 0, 0])
    expect(scale).toBe(1)
    expect([...bytes]).toEqual([0, 0, 0])
  })

  it('clamps rounding at the int8 boundary rather than overflowing', () => {
    // Every component equal to the max means every quantized value should land exactly at 127,
    // never wrap around to a negative number.
    const { bytes } = quantizeEmbedding([5, 5, 5])
    expect([...bytes]).toEqual([127, 127, 127])
  })
})

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors', () => {
    const v = new Float32Array([1, 2, 3])
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5)
  })

  it('is 0 for orthogonal vectors', () => {
    const a = new Float32Array([1, 0])
    const b = new Float32Array([0, 1])
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 10)
  })

  it('is -1 for opposite vectors', () => {
    const a = new Float32Array([1, 2, 3])
    const b = new Float32Array([-1, -2, -3])
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 5)
  })

  it('is scale-invariant (matches direction, not magnitude)', () => {
    const a = new Float32Array([1, 2, 3])
    const bigA = new Float32Array([10, 20, 30])
    const b = new Float32Array([3, 2, 1])
    expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(bigA, b), 5)
  })

  it('returns 0 (not NaN) for a zero vector rather than dividing by zero', () => {
    const a = new Float32Array([0, 0, 0])
    const b = new Float32Array([1, 2, 3])
    expect(cosineSimilarity(a, b)).toBe(0)
  })

  it('ranks a semantically-adjacent-magnitude match correctly after real quantize/dequantize round-trip', () => {
    // Simulates the real pipeline: quantize two "verse" vectors, dequantize, compare similarity.
    const anxiety = [0.9, 0.1, 0.0, 0.2]
    const takeNoThought = [0.85, 0.15, 0.05, 0.18] // close direction -> should score high
    const unrelated = [-0.9, 0.8, 0.6, -0.7] // far direction -> should score low
    const qa = quantizeEmbedding(anxiety)
    const qb = quantizeEmbedding(takeNoThought)
    const qc = quantizeEmbedding(unrelated)
    const da = dequantizeEmbedding(qa.bytes, qa.scale)
    const db = dequantizeEmbedding(qb.bytes, qb.scale)
    const dc = dequantizeEmbedding(qc.bytes, qc.scale)
    expect(cosineSimilarity(da, db)).toBeGreaterThan(cosineSimilarity(da, dc))
  })
})
