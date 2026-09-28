import React, { useEffect, useState } from 'react'
import { Plus, Check, Camera, History } from 'lucide-react'
import { useAppStore } from '@/store'
import { buildWorkspaceState, parseWorkspaceState, workspaceSessionId } from '@/lib/workspaceSnapshot'
import { SESSION_ICONS } from '@/components/shell/Sidebar'
import { Page, ListSection, Row } from '../primitives/Page'
import { actionListView, useActionSheet, type SheetAction } from '../primitives/ActionSheet'
import { haptic } from '../primitives/haptics'
import { WorkspaceIcon, workspaceTabCount, nextWorkspaceName } from './SessionSwitcher'

/**
 * Workspaces on the phone (NEW-004). ONE user-facing concept: the live tab groups — the store's
 * `sessions`, the same list as the tab-cards "Workspaces" chip and the desktop sidebar's session
 * switcher. Switch / new / rename / icon / archive all / delete use the same store actions.
 *
 * The desktop's Settings → Workspaces rows (`savedWorkspaces`, SQLite `workspaces` table, synced
 * as the `workspace` entity) are a different thing: frozen, named SNAPSHOTS of a tab set (+ the
 * desktop mosaic layout, not applied on the phone). They used to be this page's only content,
 * which is why it "showed different data than the workspaces". They stay reachable — nothing is
 * dropped — one level down as "Saved snapshots": save a workspace as a snapshot, open a snapshot
 * as a workspace (`openWorkspaceSession`, id `ws:<snapshotId>`), rename, delete.
 */
export function WorkspacesPage({ onBack }: { onBack: () => void }) {
  const [view, setView] = useState<'workspaces' | 'snapshots'>('workspaces')
  if (view === 'snapshots') return <SnapshotsView onBack={() => setView('workspaces')} onOpened={onBack} />
  return <LiveWorkspacesView onBack={onBack} onSnapshots={() => setView('snapshots')} />
}

/** Save a live workspace (session) as a named snapshot — the same v2 state desktop Settings writes. */
async function saveSnapshot(sessionId: string, name: string) {
  const st = useAppStore.getState()
  const session = st.sessions.find((x) => x.id === sessionId)
  const isCurrent = sessionId === st.currentSessionId
  const stateJson = JSON.stringify(buildWorkspaceState({
    tabs: isCurrent ? st.tabs : (session?.tabs ?? st.tabs),
    activeTabId: isCurrent ? st.activeTabId : (session?.activeTabId ?? st.activeTabId),
    displayOrder: st.sessionDisplayOrders[sessionId],
    icon: session?.icon,
  }))
  const ws = await window.workspaces.save(name, JSON.stringify(st.panelLayout), stateJson)
  st.setSavedWorkspaces([ws, ...useAppStore.getState().savedWorkspaces])
  void haptic.success()
}

function LiveWorkspacesView({ onBack, onSnapshots }: { onBack: () => void; onSnapshots: () => void }) {
  const sessions = useAppStore((s) => s.sessions)
  const currentId = useAppStore((s) => s.currentSessionId)
  const snapshotCount = useAppStore((s) => s.savedWorkspaces.length)
  const setSaved = useAppStore((s) => s.setSavedWorkspaces)
  const actions = useActionSheet()
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  useEffect(() => { window.workspaces.list().then(setSaved).catch(() => {}) }, [setSaved])

  // The persisted list can be empty before the first switch (the live tabs are the implicit
  // current workspace); show that one row so the page is never blank.
  const rows = sessions.length ? sessions : [{ id: currentId, name: 'Session 1', icon: undefined, tabs: useAppStore.getState().tabs, activeTabId: useAppStore.getState().activeTabId }]

  const switchTo = (id: string) => {
    const st = useAppStore.getState()
    if (id !== st.currentSessionId) { void haptic.selection(); st.switchSession(id) }
    onBack()
  }

  const openActions = (id: string) => {
    const st = useAppStore.getState()
    const s = st.sessions.find((x) => x.id === id)
    const label = s?.name ?? 'Session'
    const isCurrent = id === st.currentSessionId
    const list: SheetAction[] = [
      ...(!isCurrent ? [{ id: 'switch', label: 'Switch to this session', onSelect: () => switchTo(id) }] : []),
      { id: 'rename', label: 'Rename…', onSelect: () => { const n = prompt('Session name', label); if (n?.trim()) useAppStore.getState().renameSession(id, n.trim()) } },
      { id: 'icon', label: 'Change icon…', onSelect: () => {}, view: () => actionListView(`ws-icon-${id}`, 'Icon', SESSION_ICONS.map((i) => ({ id: i.name, label: i.name, icon: i.Icon, onSelect: () => useAppStore.getState().setSessionIcon(id, i.name) }))) },
      // archiveAllTabs acts on the live (current) tabs only.
      ...(isCurrent ? [{ id: 'archive-all', label: 'Archive all tabs in this session', onSelect: () => useAppStore.getState().archiveAllTabs(label) }] : []),
      { id: 'snapshot', label: 'Save as a saved session…', onSelect: () => { const n = prompt('Saved session name', label); if (n?.trim()) void saveSnapshot(id, n.trim()).catch(() => {}) } },
      { id: 'delete', label: 'Delete session', destructive: true, disabled: st.sessions.length <= 1, onSelect: () => { if (confirm(`Delete "${label}" and close its tabs?`)) useAppStore.getState().deleteSession(id) } },
    ]
    actions(`ws-${id}`, label, list)
  }

  return (
    <Page title="Sessions" onBack={onBack}>
      <ListSection title="Sessions">
        {rows.map((s) => {
          const n = workspaceTabCount(s)
          return (
            <Row key={s.id}
              leading={<WorkspaceIcon icon={s.icon} />}
              title={s.name}
              subtitle={`${n} tab${n === 1 ? '' : 's'}${s.id === currentId ? ' · Current' : ''}`}
              right={s.id === currentId ? <Check size={18} aria-label="Current" /> : undefined}
              onClick={() => (sessions.length ? openActions(s.id) : undefined)}
            />
          )
        })}
      </ListSection>
      {naming ? (
        <form className="mobile-inline-form" onSubmit={(e) => { e.preventDefault(); const n = name.trim(); if (!n) return; useAppStore.getState().createSession(n); void haptic.success(); setNaming(false); onBack() }}>
          <input className="mobile-input" autoFocus placeholder="Session name" value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.currentTarget.select()} aria-label="Workspace name" />
          <button type="submit" className="mobile-button is-primary">Create</button>
        </form>
      ) : (
        <ListSection>
          <Row leading={<Plus size={18} aria-hidden />} title="New session" onClick={() => { setName(nextWorkspaceName(sessions)); setNaming(true) }} />
        </ListSection>
      )}
      <ListSection title="Snapshots">
        <Row leading={<History size={18} aria-hidden />} title="Saved sessions"
          subtitle={snapshotCount ? `${snapshotCount} frozen cop${snapshotCount === 1 ? 'y' : 'ies'} of a session's tabs` : 'Frozen copies of a session’s tabs'}
          chevron onClick={onSnapshots} />
      </ListSection>
    </Page>
  )
}

function SnapshotsView({ onBack, onOpened }: { onBack: () => void; onOpened: () => void }) {
  const saved = useAppStore((s) => s.savedWorkspaces)
  const setSaved = useAppStore((s) => s.setSavedWorkspaces)
  const sessions = useAppStore((s) => s.sessions)
  const currentId = useAppStore((s) => s.currentSessionId)
  const openWorkspaceSession = useAppStore((s) => s.openWorkspaceSession)
  const actions = useActionSheet()
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  useEffect(() => { window.workspaces.list().then(setSaved).catch(() => {}) }, [setSaved])

  const save = async () => {
    const n = name.trim()
    if (!n) return
    await saveSnapshot(currentId, n).catch(() => {})
    setName(''); setNaming(false)
  }
  const open = async (id: string) => {
    const ws = await window.workspaces.load(id).catch(() => null)
    if (!ws) return
    openWorkspaceSession({ id: ws.id, name: ws.name }, parseWorkspaceState(ws.state_json))
    void haptic.selection()
    onOpened()
  }
  const currentName = sessions.find((s) => s.id === currentId)?.name ?? 'current session'

  return (
    <Page title="Saved sessions" onBack={onBack} backLabel="Sessions">
      <div className="mobile-empty">A snapshot is a frozen copy of a workspace&rsquo;s tabs (also saved from Settings &rarr; Workspaces on the Mac). Opening one adds it to your workspaces; later changes don&rsquo;t update the snapshot.</div>
      {naming ? (
        <form className="mobile-inline-form" onSubmit={(e) => { e.preventDefault(); void save() }}>
          <input className="mobile-input" autoFocus placeholder="Snapshot name" value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.currentTarget.select()} aria-label="Snapshot name" />
          <button type="submit" className="mobile-button is-primary">Save</button>
        </form>
      ) : (
        <ListSection>
          <Row leading={<Camera size={18} aria-hidden />} title={`Save “${currentName}” as a saved session`} onClick={() => { setName(currentName); setNaming(true) }} />
        </ListSection>
      )}
      <ListSection title="Snapshots">
        {saved.length === 0 && <div className="mobile-empty">No saved snapshots yet.</div>}
        {saved.map((w) => {
          const isOpen = sessions.some((s) => s.id === workspaceSessionId(w.id))
          return (
            <Row key={w.id} title={w.name} subtitle={`${new Date(w.created_at).toLocaleDateString()}${isOpen ? ' · Open as a session' : ''}`} chevron onClick={() => actions(`snap-${w.id}`, w.name, [
              { id: 'open', label: isOpen ? 'Switch to its session' : 'Open as a session', onSelect: () => void open(w.id) },
              { id: 'rename', label: 'Rename saved session…', onSelect: () => { const n = prompt('Saved session name', w.name); if (n?.trim()) window.workspaces.rename(w.id, n.trim()).then(() => setSaved(useAppStore.getState().savedWorkspaces.map((x) => (x.id === w.id ? { ...x, name: n.trim() } : x)))).catch(() => {}) } },
              { id: 'delete', label: 'Delete saved session', destructive: true, onSelect: () => { if (confirm(`Delete saved session "${w.name}"? Open sessions are not affected.`)) window.workspaces.delete(w.id).then(() => setSaved(useAppStore.getState().savedWorkspaces.filter((x) => x.id !== w.id))).catch(() => {}) } },
            ])} />
          )
        })}
      </ListSection>
    </Page>
  )
}
