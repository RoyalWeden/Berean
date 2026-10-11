import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// 0.7.1 (3) on a real iPhone: the NSMetadataQuery handler (main queue) called
// startDownloadingUbiquitousItem — a synchronous FileProvider XPC call — once per non-current sync
// file. A large first gather froze scrolling and the watchdog killed the app (0x8BADF00D).
const src = readFileSync(
  join(__dirname, '../../../../ios/App/BereanNative/Sources/BereanNative/BereanCloudPlugin.swift'),
  'utf8',
)

function body(name: string): string {
  const start = src.indexOf(`func ${name}(`)
  expect(start, name).toBeGreaterThan(-1)
  const open = src.indexOf('{', start)
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1)
  }
  throw new Error(`unterminated ${name}`)
}

describe('BereanCloudPlugin keeps iCloud download requests off the main thread', () => {
  it('requestDownload is the only caller of startDownloadingUbiquitousItem and asserts the plugin queue', () => {
    expect(src.match(/\.startDownloadingUbiquitousItem\(/g)).toHaveLength(1)
    expect(body('requestDownload')).toMatch(/dispatchPrecondition\(condition: \.onQueue\(queue\)\)/)
  })

  it('the metadata-query path hands downloads to the plugin queue', () => {
    const dn = body('downloadNonCurrent')
    expect(dn).toMatch(/queue\.async\s*\{[^}]*requestDownload/)
    expect(dn.replace(/queue\.async\s*\{[^}]*\}/, '')).not.toMatch(/requestDownload/)
  })
})
