import { useState, useEffect } from 'react'
import { AlertTriangle, Copy, Check, X } from 'lucide-react'

interface CrashInfo {
  message: string
  stack: string
  label: string
  timestamp: number
}

export default function CrashReport() {
  const [crash, setCrash] = useState<CrashInfo | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem('berean-crash')
      if (raw) {
        const info = JSON.parse(raw) as CrashInfo
        // Only show crashes from the last 60 seconds (i.e., from this reload)
        if (Date.now() - info.timestamp < 60_000) {
          setCrash(info)
        }
        localStorage.removeItem('berean-crash')
      }
    } catch { /* ignore */ }
  }, [])

  if (!crash) return null

  const details = [
    `Error: ${crash.message}`,
    crash.label ? `Source: ${crash.label}` : '',
    crash.stack ? `\nStack trace:\n${crash.stack}` : '',
    `\nTimestamp: ${new Date(crash.timestamp).toISOString()}`,
  ].filter(Boolean).join('\n')

  function copyDetails() {
    navigator.clipboard.writeText(details).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }

  return (
    <div className="fixed bottom-4 right-4 z-[100] w-80 rounded-xl border border-red-500/30 bg-[rgb(var(--color-surface-1))] shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-red-500/20 bg-red-500/8">
        <AlertTriangle size={14} className="text-red-400 flex-shrink-0" />
        <span className="text-xs font-semibold text-red-400 flex-1">App recovered from a crash</span>
        <button
          onClick={() => setCrash(null)}
          className="text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer transition-colors"
        >
          <X size={13} />
        </button>
      </div>

      {/* Error detail */}
      <div className="px-3 py-2.5">
        <p className="text-[11px] text-[rgb(var(--color-text-secondary))] font-medium mb-1">
          {crash.label}
        </p>
        <p className="text-[11px] text-[rgb(var(--color-text-muted))] leading-relaxed line-clamp-3">
          {crash.message}
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 px-3 pb-2.5">
        <button
          onClick={copyDetails}
          className="flex items-center gap-1.5 text-[10px] px-2 py-1 rounded bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer transition-colors"
        >
          {copied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
          {copied ? 'Copied' : 'Copy details'}
        </button>
        <button
          onClick={() => setCrash(null)}
          className="text-[10px] px-2 py-1 rounded text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer transition-colors"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
