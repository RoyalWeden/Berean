import { useState } from 'react'
import type { TrailConnection } from '@/types/studyTrail'

// Shared tier-3 "why did you jump here?" prompt — modeled as a small centered modal rather
// than an anchored popover, since it needs to work identically whether it's opened from the
// Study Trail window's Map (this file's only current host) or, per the plan, inline in the
// main Bible reader (not yet wired — see the plan's Phase 1 "auto-prompt in the main window").
// Also doubles as the tier-2 "quiet edit" affordance on an already-explained connection: pass
// any connection here (reason optional either way) and it just prefills what's there.
//
// Verse-pin fields are deliberately never pre-filled (plan requirement — the pin is the user's
// own read on which verse(s) mattered, not a guess). "Not now" calls dismissPrompt, which is
// permanent for this connection — the only way back is the "?" icon staying clickable forever.

const QUICK_TAGS = ['Key insight', 'Cross-reference', 'Tangent only']

export default function ReasonPromptPopover({
  connection, onClose, onSaved,
}: {
  connection: TrailConnection
  onClose: () => void
  onSaved: () => void
}) {
  const [text, setText] = useState(connection.reasonText ?? '')
  const [tags, setTags] = useState<string[]>(connection.reasonTags ?? [])
  const [vFrom, setVFrom] = useState(connection.versePinFrom != null ? String(connection.versePinFrom) : '')
  const [vTo, setVTo] = useState(connection.versePinTo != null ? String(connection.versePinTo) : '')
  const [saving, setSaving] = useState(false)

  function toggleTag(t: string) {
    setTags((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t])
  }

  async function save() {
    setSaving(true)
    try {
      await window.studyTrail.updateConnectionReason(connection.id, {
        reasonText: text.trim() || undefined,
        reasonTags: tags,
        versePinFrom: vFrom.trim() ? Number(vFrom) : undefined,
        versePinTo: vTo.trim() ? Number(vTo) : undefined,
      })
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  async function notNow() {
    await window.studyTrail.dismissPrompt(connection.id).catch(() => {})
    onSaved()
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(10,9,12,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ width: 340, background: '#211f27', border: '1px solid #423d49', borderRadius: 12, padding: 16, boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#ece6d8', marginBottom: 4 }}>Why did you jump here?</div>
        <div style={{ fontSize: 11, color: '#7d7869', marginBottom: 12 }}>
          Optional — this is just for your own recall later.
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 10, color: '#7d7869', display: 'block', marginBottom: 3 }}>Verse (from)</label>
            <input
              value={vFrom} onChange={(e) => setVFrom(e.target.value.replace(/\D/g, ''))}
              placeholder="—"
              style={{ width: '100%', background: '#17151a', border: '1px solid #423d49', borderRadius: 6, padding: '5px 7px', color: '#ece6d8', fontSize: 12 }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 10, color: '#7d7869', display: 'block', marginBottom: 3 }}>Verse (to)</label>
            <input
              value={vTo} onChange={(e) => setVTo(e.target.value.replace(/\D/g, ''))}
              placeholder="—"
              style={{ width: '100%', background: '#17151a', border: '1px solid #423d49', borderRadius: 6, padding: '5px 7px', color: '#ece6d8', fontSize: 12 }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10 }}>
          {QUICK_TAGS.map((t) => (
            <button
              key={t}
              onClick={() => toggleTag(t)}
              style={{
                fontSize: 10.5, padding: '4px 8px', borderRadius: 999, cursor: 'pointer',
                border: `1px solid ${tags.includes(t) ? '#d7ab52' : '#423d49'}`,
                background: tags.includes(t) ? 'rgba(215,171,82,0.14)' : 'transparent',
                color: tags.includes(t) ? '#d7ab52' : '#b7b0a0',
              }}
            >{t}</button>
          ))}
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="A word or two about the connection…"
          rows={2}
          style={{ width: '100%', background: '#17151a', border: '1px solid #423d49', borderRadius: 6, padding: '6px 8px', color: '#ece6d8', fontSize: 12, resize: 'none', marginBottom: 12, fontFamily: 'inherit' }}
        />

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <button
            onClick={notNow}
            style={{ fontSize: 11.5, color: '#7d7869', background: 'transparent', border: 'none', cursor: 'pointer' }}
          >Not now</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onClose}
              style={{ fontSize: 11.5, color: '#b7b0a0', background: 'transparent', border: '1px solid #423d49', borderRadius: 7, padding: '5px 12px', cursor: 'pointer' }}
            >Cancel</button>
            <button
              onClick={save}
              disabled={saving}
              style={{ fontSize: 11.5, fontWeight: 600, color: '#17151a', background: '#d7ab52', border: 'none', borderRadius: 7, padding: '5px 12px', cursor: 'pointer', opacity: saving ? 0.6 : 1 }}
            >Save</button>
          </div>
        </div>
      </div>
    </div>
  )
}
