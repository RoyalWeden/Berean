import { useState } from 'react'
import type { TrailConnection } from '@/types/studyTrail'

// Shared "why did you jump here?" prompt — modeled as a small centered modal rather than an
// anchored popover, since it needs to work identically across all three of its hosts: the
// Study Trail window's Map (manually opened via the tier-3 "?" badge), and — via
// pendingArrivalPrompt in studyTrailSlice.ts — the opt-in arrival popover mounted in the main
// Bible reader (src/App.tsx) for any tier-2/3 chapter jump. Also doubles as the tier-2 "quiet
// edit" affordance on an already-explained connection: pass any connection here (reason
// optional either way) and it just prefills what's there.
//
// Verse-pin fields are deliberately never pre-filled (plan requirement — the pin is the user's
// own read on which verse(s) mattered, not a guess).
//
// "Not now" behavior differs by host, via `permanentDismiss`:
//  - Manually opened from the "?" badge (default, permanentDismiss=true): calls dismissPrompt,
//    which is permanent for this connection — the "?" icon is the only way back in.
//  - The arrival popover (permanentDismiss=false): just closes. Nothing is written, so this
//    exact connection could in principle be reopened via its own row later, and — more to the
//    point — a LATER jump between a different pair of chapters gets its own fresh prompt
//    rather than this one dismissal silencing the feature going forward.

const QUICK_TAGS = ['Key insight', 'Cross-reference', 'Tangent only']

export default function ReasonPromptPopover({
  connection, onClose, onSaved, showOriginPins, permanentDismiss = true, title,
}: {
  connection: TrailConnection
  onClose: () => void
  onSaved: () => void
  /** Also show a second pair of verse-pin inputs for the chapter the user LEFT (origin side),
   *  not just the destination — used by the arrival prompt, where "which verse(s) tied this
   *  jump together" naturally has two ends. */
  showOriginPins?: boolean
  /** See the file-level comment above for what this changes about "Not now". */
  permanentDismiss?: boolean
  title?: string
}) {
  const [text, setText] = useState(connection.reasonText ?? '')
  const [tags, setTags] = useState<string[]>(connection.reasonTags ?? [])
  const [vFrom, setVFrom] = useState(connection.versePinFrom != null ? String(connection.versePinFrom) : '')
  const [vTo, setVTo] = useState(connection.versePinTo != null ? String(connection.versePinTo) : '')
  const [oFrom, setOFrom] = useState(connection.originVersePinFrom != null ? String(connection.originVersePinFrom) : '')
  const [oTo, setOTo] = useState(connection.originVersePinTo != null ? String(connection.originVersePinTo) : '')
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
        ...(showOriginPins ? {
          originVersePinFrom: oFrom.trim() ? Number(oFrom) : undefined,
          originVersePinTo: oTo.trim() ? Number(oTo) : undefined,
        } : {}),
      })
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  async function notNow() {
    if (permanentDismiss) await window.studyTrail.dismissPrompt(connection.id).catch(() => {})
    onSaved()
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(10,9,12,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ width: 340, background: 'rgb(var(--color-surface-2))', border: '1px solid rgb(var(--color-surface-4))', borderRadius: 12, padding: 16, boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'rgb(var(--color-text-primary))', marginBottom: 4 }}>{title ?? 'Why did you jump here?'}</div>
        <div style={{ fontSize: 11, color: 'rgb(var(--color-text-muted))', marginBottom: 12 }}>
          Optional — this is just for your own recall later.
        </div>

        {showOriginPins && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, color: 'rgb(var(--color-text-muted))', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Verse(s) you came from</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <input
                  value={oFrom} onChange={(e) => setOFrom(e.target.value.replace(/\D/g, ''))}
                  placeholder="—"
                  style={{ width: '100%', background: 'rgb(var(--color-surface-1))', border: '1px solid rgb(var(--color-surface-4))', borderRadius: 6, padding: '5px 7px', color: 'rgb(var(--color-text-primary))', fontSize: 12 }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <input
                  value={oTo} onChange={(e) => setOTo(e.target.value.replace(/\D/g, ''))}
                  placeholder="—"
                  style={{ width: '100%', background: 'rgb(var(--color-surface-1))', border: '1px solid rgb(var(--color-surface-4))', borderRadius: 6, padding: '5px 7px', color: 'rgb(var(--color-text-primary))', fontSize: 12 }}
                />
              </div>
            </div>
          </div>
        )}

        <div style={{ marginBottom: 10 }}>
          {showOriginPins && (
            <div style={{ fontSize: 9.5, fontWeight: 700, color: 'rgb(var(--color-text-muted))', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Verse(s) you landed on</div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              {!showOriginPins && <label style={{ fontSize: 10, color: 'rgb(var(--color-text-muted))', display: 'block', marginBottom: 3 }}>Verse (from)</label>}
              <input
                value={vFrom} onChange={(e) => setVFrom(e.target.value.replace(/\D/g, ''))}
                placeholder="—"
                style={{ width: '100%', background: 'rgb(var(--color-surface-1))', border: '1px solid rgb(var(--color-surface-4))', borderRadius: 6, padding: '5px 7px', color: 'rgb(var(--color-text-primary))', fontSize: 12 }}
              />
            </div>
            <div style={{ flex: 1 }}>
              {!showOriginPins && <label style={{ fontSize: 10, color: 'rgb(var(--color-text-muted))', display: 'block', marginBottom: 3 }}>Verse (to)</label>}
              <input
                value={vTo} onChange={(e) => setVTo(e.target.value.replace(/\D/g, ''))}
                placeholder="—"
                style={{ width: '100%', background: 'rgb(var(--color-surface-1))', border: '1px solid rgb(var(--color-surface-4))', borderRadius: 6, padding: '5px 7px', color: 'rgb(var(--color-text-primary))', fontSize: 12 }}
              />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10 }}>
          {QUICK_TAGS.map((t) => (
            <button
              key={t}
              onClick={() => toggleTag(t)}
              style={{
                fontSize: 10.5, padding: '4px 8px', borderRadius: 999, cursor: 'pointer',
                border: `1px solid ${tags.includes(t) ? 'rgb(var(--color-accent))' : 'rgb(var(--color-surface-4))'}`,
                background: tags.includes(t) ? 'rgb(var(--color-accent) / 0.14)' : 'transparent',
                color: tags.includes(t) ? 'rgb(var(--color-accent))' : 'rgb(var(--color-text-secondary))',
              }}
            >{t}</button>
          ))}
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="A word or two about the connection…"
          rows={2}
          style={{ width: '100%', background: 'rgb(var(--color-surface-1))', border: '1px solid rgb(var(--color-surface-4))', borderRadius: 6, padding: '6px 8px', color: 'rgb(var(--color-text-primary))', fontSize: 12, resize: 'none', marginBottom: 12, fontFamily: 'inherit' }}
        />

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <button
            onClick={notNow}
            style={{ fontSize: 11.5, color: 'rgb(var(--color-text-muted))', background: 'transparent', border: 'none', cursor: 'pointer' }}
          >Not now</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onClose}
              style={{ fontSize: 11.5, color: 'rgb(var(--color-text-secondary))', background: 'transparent', border: '1px solid rgb(var(--color-surface-4))', borderRadius: 7, padding: '5px 12px', cursor: 'pointer' }}
            >Cancel</button>
            <button
              onClick={save}
              disabled={saving}
              style={{ fontSize: 11.5, fontWeight: 600, color: 'rgb(var(--color-surface-1))', background: 'rgb(var(--color-accent))', border: 'none', borderRadius: 7, padding: '5px 12px', cursor: 'pointer', opacity: saving ? 0.6 : 1 }}
            >Save</button>
          </div>
        </div>
      </div>
    </div>
  )
}
