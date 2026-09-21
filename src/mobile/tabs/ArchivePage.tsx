import React from 'react'
import { useAppStore } from '@/store'
import { Page, ListSection, Row } from '../primitives/Page'
import { useActionSheet } from '../primitives/ActionSheet'

/** Archived tab groups (same store data as the desktop sidebar's archive): restore or discard. */
export function ArchivePage({ onBack }: { onBack: () => void }) {
  const groups = useAppStore((s) => s.archivedGroups)
  const restore = useAppStore((s) => s.restoreArchivedGroup)
  const actions = useActionSheet()
  return (
    <Page title="Archived tabs" onBack={onBack}>
      <ListSection>
        {groups.length === 0 && <div className="mobile-empty">Nothing archived. Long-press a tab in the tab grid → Archive.</div>}
        {groups.map((g) => (
          <Row key={g.id} title={g.label} subtitle={`${g.tabs.length} tab${g.tabs.length === 1 ? '' : 's'} · ${new Date(g.archivedAt).toLocaleString()}`} chevron onClick={() => actions(`arch-${g.id}`, g.label, [
            { id: 'restore', label: 'Restore tabs', onSelect: () => { restore(g.id); onBack() } },
            { id: 'discard', label: 'Discard', destructive: true, onSelect: () => { if (confirm('Discard this archived group?')) useAppStore.setState((s) => ({ archivedGroups: s.archivedGroups.filter((x) => x.id !== g.id) })) } },
          ])} />
        ))}
      </ListSection>
    </Page>
  )
}
