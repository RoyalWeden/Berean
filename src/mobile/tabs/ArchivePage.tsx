import React from 'react'
import { useAppStore } from '@/store'
import type { ArchivedGroup } from '@/store'
import { Page, ListSection, Row } from '../primitives/Page'
import { useActionSheet, actionListView, type SheetAction } from '../primitives/ActionSheet'
import type { SheetApi } from '../primitives/Sheet'

/** One archived group's actions — shared by the page (More → Archived tabs) and the tab-cards view. */
function groupActions(g: ArchivedGroup, onRestored: () => void): SheetAction[] {
  return [
    { id: 'restore', label: 'Restore tabs', onSelect: () => { useAppStore.getState().restoreArchivedGroup(g.id); onRestored() } },
    { id: 'discard', label: 'Discard', destructive: true, onSelect: () => { if (confirm('Discard this archived group?')) useAppStore.setState((s) => ({ archivedGroups: s.archivedGroups.filter((x) => x.id !== g.id) })) } },
  ]
}

function ArchiveRows({ onOpen }: { onOpen: (g: ArchivedGroup) => void }) {
  const groups = useAppStore((s) => s.archivedGroups)
  return (
    <ListSection>
      {groups.length === 0 && <div className="mobile-empty">Nothing archived. Hold a tab card → Archive tab, or Sessions → a session → Archive all tabs.</div>}
      {groups.map((g) => (
        <Row key={g.id} title={g.label} subtitle={`${g.tabs.length} tab${g.tabs.length === 1 ? '' : 's'} · ${new Date(g.archivedAt).toLocaleString()}`} chevron onClick={() => onOpen(g)} />
      ))}
    </ListSection>
  )
}

/** Archived tab groups (same store data as the desktop sidebar's archive): restore or discard. */
export function ArchivePage({ onBack }: { onBack: () => void }) {
  const actions = useActionSheet()
  return (
    <Page title="Archived tabs" onBack={onBack}>
      <ArchiveRows onOpen={(g) => actions(`arch-${g.id}`, g.label, groupActions(g, onBack))} />
    </Page>
  )
}

/** The archive as a view INSIDE the tab-cards sheet (NEW-016): the same sheet, same position, "‹ Tabs"
 *  at the top; a group's actions go one level deeper; restoring returns to the cards. */
export function ArchiveView({ api }: { api: SheetApi }) {
  return (
    <ArchiveRows onOpen={(g) => api.push(actionListView(`arch-${g.id}`, g.label,
      groupActions(g, () => api.popToRoot()).map((a) => ({ ...a, stay: true })),
    ))} />
  )
}
