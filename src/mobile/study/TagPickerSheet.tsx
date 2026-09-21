import React, { useMemo, useState } from 'react'
import { Plus, Check } from 'lucide-react'
import { useAppStore } from '@/store'
import { resolveTagColor } from '@/lib/tagPalette'
import type { VerseTagRange } from '@/types'
import type { SheetApi } from '../primitives/Sheet'
import { haptic } from '../primitives/haptics'

/**
 * Tag picker (R075): the phone form of TagPickPopover — same data flow (`verseTags` from the
 * store, `window.verseTags.addMembers`, `setVerseTags`), presented as a sheet with a filter /
 * create field and ≥44 pt rows.
 */
export function TagPickerSheet({ ranges, label, kind, api }: { ranges: VerseTagRange[]; label: string; kind: 'verses' | 'chapter'; api: SheetApi }) {
  const tags = useAppStore((s) => s.verseTags)
  const setVerseTags = useAppStore((s) => s.setVerseTags)
  const openTagsGraph = useAppStore((s) => s.openTagsGraph)
  const [query, setQuery] = useState('')
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [created, setCreated] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const q = query.trim().toLowerCase()
  const filtered = useMemo(() => tags.filter((t) => !q || t.name.toLowerCase().includes(q)), [tags, q])
  const exactExists = tags.some((t) => t.name.toLowerCase() === q) || created.some((c) => c.toLowerCase() === q)
  const canApply = checked.size > 0 || created.length > 0

  const toggle = (id: string) => { void haptic.selection(); setChecked((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n }) }
  const addCreated = () => { const name = query.trim(); if (!name || exactExists) return; setCreated((c) => [...c, name]); setQuery('') }
  const apply = async () => {
    if (!canApply || busy) return
    setBusy(true)
    try {
      const res = await window.verseTags.addMembers({ tagIds: [...checked], newTagNames: created, ranges, label, kind })
      setVerseTags(res)
      void haptic.success()
      api.close()
    } finally { setBusy(false) }
  }

  return (
    <div className="mobile-tag-picker">
      <div className="mobile-verse-actions-ref">Tag {label}</div>
      <form onSubmit={(e) => { e.preventDefault(); exactExists ? void apply() : addCreated() }}>
        <input className="mobile-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter or create…" aria-label="Filter or create tag" autoCorrect="off" autoCapitalize="none" />
      </form>
      <div className="mobile-list-group" style={{ marginTop: 8 }}>
        {created.map((name) => (
          <div key={`new-${name}`} className="mobile-row"><span className="mobile-tag-dot" /><span className="mobile-row-text"><span className="mobile-row-title">{name}</span></span><span className="mobile-muted">new</span></div>
        ))}
        {filtered.map((t) => (
          <button key={t.id} type="button" className="mobile-row" onClick={() => toggle(t.id)} aria-pressed={checked.has(t.id)}>
            <span className="mobile-tag-dot" style={{ backgroundColor: resolveTagColor(t) }} />
            <span className="mobile-row-text"><span className="mobile-row-title">{t.name}</span></span>
            <span className="mobile-muted">{t.verseCount + t.chapterCount}</span>
            {checked.has(t.id) && <Check size={18} aria-hidden />}
          </button>
        ))}
        {q && !exactExists && (
          <button type="button" className="mobile-row" onClick={addCreated}><Plus size={18} aria-hidden /><span className="mobile-row-text"><span className="mobile-row-title">Create “{query.trim()}”</span></span></button>
        )}
        {filtered.length === 0 && !q && <div className="mobile-empty">No tags yet — type a name to create one.</div>}
      </div>
      <div className="mobile-tag-picker-actions">
        <button type="button" className="mobile-button" onClick={() => { api.close(); openTagsGraph() }}>Manage</button>
        <button type="button" className="mobile-button is-primary" onClick={() => void apply()} disabled={!canApply || busy}>Apply</button>
      </div>
    </div>
  )
}
