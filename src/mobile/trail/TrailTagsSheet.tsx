import React, { useCallback, useEffect, useState } from 'react'
import { Check, Plus } from 'lucide-react'
import type { TrailTag } from '@/types/studyTrail'
import type { SheetApi } from '../primitives/Sheet'
import { useActionSheet } from '../primitives/ActionSheet'
import { haptic } from '../primitives/haptics'

/**
 * Session tags (R042): toggle any existing trail tag on the session, create a new one, and rename
 * / delete a tag from its long-press ("…") actions. `window.studyTrail.listTags/createTag/
 * updateTag/deleteTag/setSessionTags` — the desktop rail's tag editor uses the same calls.
 */
export function TrailTagsSheet({ sessionId, api }: { sessionId: string; api: SheetApi }) {
  const [tags, setTags] = useState<TrailTag[]>([])
  const [name, setName] = useState('')
  const actions = useActionSheet()
  const load = useCallback(() => window.studyTrail.listTags().then(setTags).catch(() => setTags([])), [])
  useEffect(() => { void load() }, [load])
  useEffect(() => window.studyTrail.onDataChanged(() => void load()), [load])

  const mine = tags.filter((t) => t.sessionIds.includes(sessionId)).map((t) => t.id)
  const toggle = async (tag: TrailTag) => {
    void haptic.selection()
    const next = mine.includes(tag.id) ? mine.filter((id) => id !== tag.id) : [...mine, tag.id]
    await window.studyTrail.setSessionTags(sessionId, next)
    await load()
  }
  const create = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    const { id } = await window.studyTrail.createTag(trimmed)
    await window.studyTrail.setSessionTags(sessionId, [...mine, id])
    setName('')
    await load()
  }
  const more = (tag: TrailTag) => actions('trail-tag-actions', tag.name, [
    { id: 'rename', label: 'Rename…', onSelect: () => { const n = prompt('Tag name', tag.name); if (n?.trim()) void window.studyTrail.updateTag(tag.id, { name: n.trim() }).then(load) } },
    { id: 'delete', label: 'Delete tag', destructive: true, onSelect: () => { if (confirm(`Delete tag "${tag.name}" from every session?`)) void window.studyTrail.deleteTag(tag.id).then(load) } },
  ])

  return (
    <div className="m-trail-tags">
      <form className="m-trail-tags-new" onSubmit={(e) => { e.preventDefault(); void create() }}>
        <input className="mobile-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="New tag" aria-label="New tag name" />
        <button type="submit" className="mobile-chip is-on" disabled={!name.trim()}><Plus size={16} aria-hidden /> Add</button>
      </form>
      {tags.length === 0 && <div className="mobile-empty">No trail tags yet.</div>}
      <div className="mobile-list-group">
        {tags.map((t) => {
          const on = mine.includes(t.id)
          return (
            <div key={t.id} className="mobile-row m-trail-tag-row">
              <button type="button" className="m-trail-tag-toggle" role="checkbox" aria-checked={on} onClick={() => void toggle(t)}>
                <span className="m-trail-tag-swatch" style={{ background: t.color ?? 'rgb(var(--color-accent))' }} aria-hidden />
                <span className="mobile-row-title">{t.name}</span>
                {on && <Check size={18} aria-hidden className="m-trail-tag-check" />}
              </button>
              <button type="button" className="mobile-icon-tap" aria-label={`More for ${t.name}`} onClick={() => more(t)}>…</button>
            </div>
          )
        })}
      </div>
      <button type="button" className="mobile-button" onClick={api.close}>Done</button>
    </div>
  )
}
