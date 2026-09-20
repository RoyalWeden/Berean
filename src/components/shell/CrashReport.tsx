import { useState, useEffect } from 'react'
import { AlertTriangle, Copy, Check, X } from 'lucide-react'
import { IconButton, Button } from '@/components/ui'

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
    <div className="fixed bottom-4 right-4 z-[1000] pointer-events-auto w-80 material-popover rounded-menu border border-destructive/30 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-destructive/20 bg-destructive/8">
        <AlertTriangle size={14} className="text-destructive flex-shrink-0" />
        <span className="text-caption font-semibold text-destructive flex-1">App recovered from a crash</span>
        <IconButton icon={X} label="Dismiss" size={20} onClick={() => setCrash(null)} />
      </div>

      {/* Error detail */}
      <div className="px-3 py-2.5">
        <p className="text-caption text-text-secondary font-medium mb-1">
          {crash.label}
        </p>
        <p className="text-caption text-text-muted leading-relaxed line-clamp-3">
          {crash.message}
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 px-3 pb-2.5">
        <Button size="sm" icon={copied ? Check : Copy} onClick={copyDetails}>
          {copied ? 'Copied' : 'Copy details'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setCrash(null)}>Dismiss</Button>
      </div>
    </div>
  )
}
