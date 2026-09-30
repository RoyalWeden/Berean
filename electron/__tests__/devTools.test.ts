import { describe, it, expect } from 'vitest'
import { devToolsEnabled } from '../devTools'

describe('devToolsEnabled', () => {
  it('is enabled for a development build under any identity', () => {
    expect(devToolsEnabled({ isDev: true, identity: 'production' })).toBe(true)
    expect(devToolsEnabled({ isDev: true, identity: 'development' })).toBe(true)
  })

  it('is enabled for a packaged build running as the Berean Dev identity', () => {
    expect(devToolsEnabled({ isDev: false, identity: 'development' })).toBe(true)
  })

  it('is disabled for a packaged production-identity build', () => {
    expect(devToolsEnabled({ isDev: false, identity: 'production' })).toBe(false)
  })
})
