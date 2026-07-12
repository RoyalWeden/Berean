import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useAppStore } from '@/store'

export default function HistorySection() {
  const tabNavMaxStack    = useAppStore((s) => s.tabNavMaxStack)
  const setTabNavMaxStack = useAppStore((s) => s.setTabNavMaxStack)
  const historyMaxEntries    = useAppStore((s) => s.historyMaxEntries)
  const setHistoryMaxEntries = useAppStore((s) => s.setHistoryMaxEntries)
  const clearAllTabNavStacks = useAppStore((s) => s.clearAllTabNavStacks)
  const tabNavStacks = useAppStore((s) => s.tabNavStacks)
  const stackCount = Object.values(tabNavStacks).reduce((acc, s) => acc + s.stack.length, 0)
  const [cleared, setCleared] = useState(false)

  return (
    <div className="space-y-5">
      {/* Tab navigation history */}
      <div>
        <p className="text-sm font-semibold text-[rgb(var(--color-text-primary))] mb-1">Tab navigation (back / forward)</p>
        <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] mb-3">How many pages to remember per tab for the back / forward buttons.</p>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-[rgb(var(--color-text-secondary))]">
            Max entries per tab
            <input
              type="number" min={10} max={1000} step={10}
              value={tabNavMaxStack}
              onChange={(e) => setTabNavMaxStack(parseInt(e.target.value) || 100)}
              className="w-20 text-center px-2 py-1 rounded bg-[rgb(var(--color-surface-3))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] text-xs outline-none"
            />
          </label>
          <span className="text-xs text-[rgb(var(--color-text-muted))]">{stackCount} total entries stored</span>
        </div>
        <div className="mt-3">
          <button
            onClick={() => { clearAllTabNavStacks(); setCleared(true); setTimeout(() => setCleared(false), 2000) }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))] hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
          >
            <Trash2 size={12} />
            {cleared ? 'Cleared ✓' : 'Clear all tab nav history'}
          </button>
        </div>
      </div>

      {/* App history */}
      <div>
        <p className="text-sm font-semibold text-[rgb(var(--color-text-primary))] mb-1">App history log</p>
        <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] mb-3">Maximum number of entries kept in the history sidebar (older entries are pruned automatically).</p>
        <label className="flex items-center gap-2 text-xs text-[rgb(var(--color-text-secondary))]">
          Max entries
          <input
            type="number" min={50} max={10000} step={50}
            value={historyMaxEntries}
            onChange={(e) => setHistoryMaxEntries(parseInt(e.target.value) || 500)}
            className="w-24 text-center px-2 py-1 rounded bg-[rgb(var(--color-surface-3))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] text-xs outline-none"
          />
        </label>
      </div>
    </div>
  )
}
