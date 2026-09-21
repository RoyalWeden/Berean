import React, { useState } from 'react'
import { Plus, Check } from 'lucide-react'
import { useAppStore } from '@/store'
import { haptic } from '../primitives/haptics'
import { Row, ListSection } from '../primitives/Page'

/** Workspaces (sessions) on the phone (R072): switch, create, rename, delete — same store actions as the desktop sidebar. */
export function SessionSwitcher({ close, onActions }: { close: () => void; onActions: (sessionId: string) => void }) {
  const sessions = useAppStore((s) => s.sessions)
  const currentId = useAppStore((s) => s.currentSessionId)
  const switchSession = useAppStore((s) => s.switchSession)
  const createSession = useAppStore((s) => s.createSession)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const total = (s: (typeof sessions)[number]) => Object.values(s.tabs).reduce((n, arr) => n + arr.length, 0)
  return (
    <div className="mobile-session-switcher">
      <ListSection title="Workspaces">
        {sessions.map((s) => (
          <Row key={s.id}
            leading={<span className="mobile-session-icon" aria-hidden>{s.icon ?? '◻︎'}</span>}
            title={s.name}
            subtitle={`${total(s)} tab${total(s) === 1 ? '' : 's'}`}
            right={s.id === currentId ? <Check size={18} aria-label="Current" /> : undefined}
            onClick={() => { if (s.id !== currentId) { void haptic.selection(); switchSession(s.id) } close() }}
          />
        ))}
      </ListSection>
      {naming ? (
        <form className="mobile-inline-form" onSubmit={(e) => { e.preventDefault(); const n = name.trim(); if (!n) return; createSession(n); void haptic.success(); close() }}>
          <input className="mobile-input" autoFocus placeholder="Workspace name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Workspace name" />
          <button type="submit" className="mobile-button is-primary">Create</button>
        </form>
      ) : (
        <ListSection>
          <Row leading={<Plus size={18} aria-hidden />} title="New workspace" onClick={() => setNaming(true)} />
          {sessions.length > 0 && <Row title="Manage current workspace…" onClick={() => { close(); onActions(currentId) }} chevron />}
        </ListSection>
      )}
    </div>
  )
}
