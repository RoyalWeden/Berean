import React, { useState } from 'react'
import { Plus, Check } from 'lucide-react'
import { useAppStore, type Session } from '@/store'
import { haptic } from '../primitives/haptics'
import { Row, ListSection } from '../primitives/Page'
import { SESSION_ICONS } from '@/components/shell/Sidebar'

/**
 * iPhone terminology (NEW-004): the store's `sessions` (live tab groups — the desktop sidebar calls
 * them "sessions") are the ONE user-facing concept called "Workspaces" on the phone. Stored names
 * (e.g. an old "Session 1") are data and are shown as-is; only new ones created here default to
 * "Workspace N". The separate `savedWorkspaces` rows are frozen tab snapshots and are labelled
 * "Saved snapshots" on the phone (see WorkspacesPage).
 */

/** Total open tabs across all spaces in a workspace (session). */
export function workspaceTabCount(s: Pick<Session, 'tabs'>): number {
  return Object.values(s.tabs).reduce((n, arr) => n + arr.length, 0)
}

/** Leading icon for a workspace row (the session's chosen icon, or the default). */
export function WorkspaceIcon({ icon, size = 18 }: { icon?: string; size?: number }) {
  const I = (SESSION_ICONS.find((i) => i.name === icon) ?? SESSION_ICONS[0]).Icon
  return <I size={size} aria-hidden />
}

/** Default name for a workspace created on the phone: "Workspace N", skipping names already taken. */
export function nextWorkspaceName(sessions: ReadonlyArray<Pick<Session, 'name'>>): string {
  const taken = new Set(sessions.map((s) => s.name.trim().toLowerCase()))
  let n = Math.max(1, sessions.length) + 1
  while (taken.has(`session ${n}`)) n++
  return `Session ${n}`
}

/** Workspaces (sessions) on the phone (R072): switch, create, rename, delete — same store actions as the desktop sidebar. */
export function SessionSwitcher({ close, onActions }: { close: () => void; onActions: (sessionId: string) => void }) {
  const sessions = useAppStore((s) => s.sessions)
  const currentId = useAppStore((s) => s.currentSessionId)
  const switchSession = useAppStore((s) => s.switchSession)
  const createSession = useAppStore((s) => s.createSession)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  return (
    <div className="mobile-session-switcher">
      <ListSection title="Sessions">
        {sessions.map((s) => (
          <Row key={s.id}
            leading={<WorkspaceIcon icon={s.icon} />}
            title={s.name}
            subtitle={`${workspaceTabCount(s)} tab${workspaceTabCount(s) === 1 ? '' : 's'}`}
            right={s.id === currentId ? <Check size={18} aria-label="Current" /> : undefined}
            onClick={() => { if (s.id !== currentId) { void haptic.selection(); switchSession(s.id) } close() }}
          />
        ))}
      </ListSection>
      {naming ? (
        <form className="mobile-inline-form" onSubmit={(e) => { e.preventDefault(); const n = name.trim(); if (!n) return; createSession(n); void haptic.success(); close() }}>
          <input className="mobile-input" autoFocus placeholder="Session name" value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.currentTarget.select()} aria-label="Workspace name" />
          <button type="submit" className="mobile-button is-primary">Create</button>
        </form>
      ) : (
        <ListSection>
          <Row leading={<Plus size={18} aria-hidden />} title="New session" onClick={() => { setName(nextWorkspaceName(sessions)); setNaming(true) }} />
          {sessions.length > 0 && <Row title="Manage current session…" onClick={() => { close(); onActions(currentId) }} chevron />}
        </ListSection>
      )}
    </div>
  )
}
