import { describe, it, expect } from 'vitest'
import { downloadReducer, initialModelDownloadState, isModelReady, canStartDownload } from '../modelDownloadState'

describe('downloadReducer', () => {
  it('idle -> START -> downloading, with counters reset', () => {
    const s = downloadReducer(initialModelDownloadState, { type: 'START' })
    expect(s.status).toBe('downloading')
    expect(s.receivedBytes).toBe(0)
    expect(s.error).toBeNull()
  })

  it('PROGRESS updates counters while downloading', () => {
    let s = downloadReducer(initialModelDownloadState, { type: 'START' })
    s = downloadReducer(s, { type: 'PROGRESS', receivedBytes: 1000, totalBytes: 5000 })
    expect(s.status).toBe('downloading')
    expect(s.receivedBytes).toBe(1000)
    expect(s.totalBytes).toBe(5000)
  })

  it('PROGRESS is ignored (no-op) when nothing is in flight — guards against a stale/late event', () => {
    const s = downloadReducer(initialModelDownloadState, { type: 'PROGRESS', receivedBytes: 999, totalBytes: 999 })
    expect(s).toEqual(initialModelDownloadState)
  })

  it('downloading -> VERIFYING -> verifying', () => {
    let s = downloadReducer(initialModelDownloadState, { type: 'START' })
    s = downloadReducer(s, { type: 'VERIFYING' })
    expect(s.status).toBe('verifying')
  })

  it('VERIFYING is ignored unless currently downloading', () => {
    const s = downloadReducer(initialModelDownloadState, { type: 'VERIFYING' })
    expect(s.status).toBe('idle')
  })

  it('-> READY sets receivedBytes = totalBytes and clears any error', () => {
    let s = downloadReducer(initialModelDownloadState, { type: 'START' })
    s = downloadReducer(s, { type: 'PROGRESS', receivedBytes: 40, totalBytes: 100 })
    s = downloadReducer(s, { type: 'READY' })
    expect(s.status).toBe('ready')
    expect(s.receivedBytes).toBe(100)
    expect(s.totalBytes).toBe(100)
    expect(s.error).toBeNull()
  })

  it('a failed download cleans up: zeroed counters, status error, error message kept', () => {
    let s = downloadReducer(initialModelDownloadState, { type: 'START' })
    s = downloadReducer(s, { type: 'PROGRESS', receivedBytes: 40, totalBytes: 100 })
    s = downloadReducer(s, { type: 'FAILED', error: 'network down' })
    expect(s.status).toBe('error')
    expect(s.receivedBytes).toBe(0)
    expect(s.totalBytes).toBe(0)
    expect(s.error).toBe('network down')
  })

  it('a cancelled download resets fully back to idle (no error shown)', () => {
    let s = downloadReducer(initialModelDownloadState, { type: 'START' })
    s = downloadReducer(s, { type: 'PROGRESS', receivedBytes: 40, totalBytes: 100 })
    s = downloadReducer(s, { type: 'CANCELLED' })
    expect(s).toEqual(initialModelDownloadState)
  })

  it('RESET always returns to the initial state regardless of current status', () => {
    let s = downloadReducer(initialModelDownloadState, { type: 'START' })
    s = downloadReducer(s, { type: 'READY' })
    s = downloadReducer(s, { type: 'RESET' })
    expect(s).toEqual(initialModelDownloadState)
  })
})

describe('isModelReady / canStartDownload', () => {
  it('isModelReady is true only for status "ready"', () => {
    expect(isModelReady(initialModelDownloadState)).toBe(false)
    expect(isModelReady(downloadReducer(initialModelDownloadState, { type: 'READY' }))).toBe(true)
  })

  it('canStartDownload is true for idle/error, false otherwise', () => {
    expect(canStartDownload(initialModelDownloadState)).toBe(true)
    const failed = downloadReducer(downloadReducer(initialModelDownloadState, { type: 'START' }), { type: 'FAILED', error: 'x' })
    expect(canStartDownload(failed)).toBe(true)
    const downloading = downloadReducer(initialModelDownloadState, { type: 'START' })
    expect(canStartDownload(downloading)).toBe(false)
    const ready = downloadReducer(initialModelDownloadState, { type: 'READY' })
    expect(canStartDownload(ready)).toBe(false)
  })
})
