import { describe, it, expect } from 'vitest'
import { RECOMMENDED_MODELS, isAllowedModelId, formatBytes } from '../modelCatalog'

describe('model catalog', () => {
  it('has the installed-size values and unique ids', () => {
    const size = (id: string) => RECOMMENDED_MODELS.find((m) => m.id === id)?.sizeBytes
    expect(size('llama3.1:latest')).toBe(4.9e9)
    expect(size('gemma4:12b-it-qat')).toBe(7.2e9)
    expect(new Set(RECOMMENDED_MODELS.map((m) => m.id)).size).toBe(RECOMMENDED_MODELS.length)
  })
  it('allows only catalog or installed, well-formed ids', () => {
    expect(isAllowedModelId('llama3.2:3b', [])).toBe(true)
    expect(isAllowedModelId('custom:7b', ['custom:7b'])).toBe(true)
    expect(isAllowedModelId('custom:7b', [])).toBe(false)
    expect(isAllowedModelId('x; rm -rf', ['x; rm -rf'])).toBe(false)
    expect(isAllowedModelId(undefined, [])).toBe(false)
  })
  it('formats sizes', () => {
    expect(formatBytes(4.9e9)).toBe('4.9 GB')
    expect(formatBytes(500e6)).toBe('500 MB')
  })
})
