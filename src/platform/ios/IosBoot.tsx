import React, { useEffect, useState } from 'react'
import { runSelfTest, type SelfTestResult } from './selfTest'

/**
 * Temporary iPhone root while the mobile shell (Phase 10) is being built: runs the native-stack
 * self-test on launch and shows every check with its timing. Once the shell lands this becomes
 * the Settings → About → "Run self-test" page rather than the app's first screen.
 */
export function IosBoot() {
  const [results, setResults] = useState<SelfTestResult[]>([])
  const [running, setRunning] = useState(true)

  useEffect(() => {
    let cancelled = false
    setRunning(true)
    setResults([])
    runSelfTest((r) => { if (!cancelled) setResults((prev) => [...prev, r]) })
      .finally(() => { if (!cancelled) setRunning(false) })
    return () => { cancelled = true }
  }, [])

  const passed = results.filter((r) => r.ok).length
  const total = results.length

  return (
    <div style={{ padding: 'max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom))', fontFamily: '-apple-system, system-ui, sans-serif', color: '#e5e7eb', background: '#0b0b0f', minHeight: '100vh' }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, margin: '8px 0 2px' }}>Berean — iPhone foundation</h1>
      <p style={{ fontSize: 13, color: '#9ca3af', margin: '0 0 16px' }}>
        {running ? 'Running native self-test…' : `${passed}/${total} checks passed`}
      </p>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {results.map((r) => (
          <li key={r.name} style={{ padding: '10px 12px', marginBottom: 8, borderRadius: 10, background: r.ok ? 'rgba(34,197,94,0.12)' : 'rgba(248,113,113,0.14)', border: `1px solid ${r.ok ? 'rgba(34,197,94,0.35)' : 'rgba(248,113,113,0.45)'}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 14, fontWeight: 500 }}>
              <span>{r.ok ? '✓' : '✗'} {r.name}</span>
              <span style={{ color: '#9ca3af', fontVariantNumeric: 'tabular-nums' }}>{r.ms.toFixed(0)} ms</span>
            </div>
            <div style={{ fontSize: 12, color: r.ok ? '#9ca3af' : '#fca5a5', marginTop: 4, wordBreak: 'break-word' }}>{r.detail}</div>
          </li>
        ))}
      </ul>
    </div>
  )
}
