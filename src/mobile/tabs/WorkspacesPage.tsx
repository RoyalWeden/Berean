import React, { useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import { useAppStore } from '@/store'
import { buildWorkspaceState, parseWorkspaceState } from '@/lib/workspaceSnapshot'
import { Page, ListSection, Row } from '../primitives/Page'
import { useActionSheet } from '../primitives/ActionSheet'
import { haptic } from '../primitives/haptics'

/**
 * Saved workspaces (R072/R057): the same `workspaces` rows desktop saves from Settings →
 * Workspaces (v2 snapshots: tabs, active tabs, display order, icon). Open → the snapshot becomes
 * a session (`openWorkspaceSession`); the desktop mosaic layout is stored but not applied on the
 * phone. Save the current session as a workspace from here.
 */
export function WorkspacesPage({ onBack }: { onBack: () => void }) {
  const saved = useAppStore((s) => s.savedWorkspaces)
  const setSaved = useAppStore((s) => s.setSavedWorkspaces)
  const openWorkspaceSession = useAppStore((s) => s.openWorkspaceSession)
  const actions = useActionSheet()
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  useEffect(() => { window.workspaces.list().then(setSaved).catch(() => {}) }, [setSaved])

  const save = async () => {
    const n = name.trim()
    if (!n) return
    const st = useAppStore.getState()
    const stateJson = JSON.stringify(buildWorkspaceState({ tabs: st.tabs, activeTabId: st.activeTabId, displayOrder: st.sessionDisplayOrders[st.currentSessionId], icon: st.sessions.find((x) => x.id === st.currentSessionId)?.icon }))
    const ws = await window.workspaces.save(n, JSON.stringify(st.panelLayout), stateJson)
    setSaved([ws, ...saved]); setName(''); setNaming(false); void haptic.success()
  }
  const open = async (id: string) => {
    const ws = await window.workspaces.load(id).catch(() => null)
    if (!ws) return
    openWorkspaceSession({ id: ws.id, name: ws.name }, parseWorkspaceState(ws.state_json))
    void haptic.selection()
    onBack()
  }

  return (
    <Page title="Workspaces" onBack={onBack}>
      {naming ? (
        <form className="mobile-inline-form" onSubmit={(e) => { e.preventDefault(); void save() }}>
          <input className="mobile-input" autoFocus placeholder="Workspace name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Workspace name" />
          <button type="submit" className="mobile-button is-primary">Save</button>
        </form>
      ) : (
        <ListSection>
          <Row leading={<Save size={18} aria-hidden />} title="Save current tabs as a workspace" onClick={() => setNaming(true)} />
        </ListSection>
      )}
      <ListSection title="Saved">
        {saved.length === 0 && <div className="mobile-empty">No saved workspaces yet.</div>}
        {saved.map((w) => (
          <Row key={w.id} title={w.name} subtitle={new Date(w.created_at).toLocaleDateString()} chevron onClick={() => actions(`ws-${w.id}`, w.name, [
            { id: 'open', label: 'Open as a session', onSelect: () => void open(w.id) },
            { id: 'rename', label: 'Rename…', onSelect: () => { const n = prompt('Workspace name', w.name); if (n?.trim()) window.workspaces.rename(w.id, n.trim()).then(() => setSaved(saved.map((x) => (x.id === w.id ? { ...x, name: n.trim() } : x)))) } },
            { id: 'delete', label: 'Delete', destructive: true, onSelect: () => { if (confirm(`Delete workspace "${w.name}"?`)) window.workspaces.delete(w.id).then(() => setSaved(saved.filter((x) => x.id !== w.id))) } },
          ])} />
        ))}
      </ListSection>
    </Page>
  )
}
