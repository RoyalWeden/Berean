import React, { useEffect, useState } from 'react'
import type { Note } from '@/types'
import { useAppStore } from '@/store'
import { Page, ListSection, Row } from '../primitives/Page'
import { useActionSheet } from '../primitives/ActionSheet'

/** Notes trash on the phone: restore or delete permanently; empty trash. */
export function TrashPage({ onBack }: { onBack: () => void }) {
  const [items, setItems] = useState<Note[]>([])
  const token = useAppStore((s) => s.noteChangeToken)
  const bump = useAppStore((s) => s.bumpNoteToken)
  const actions = useActionSheet()
  useEffect(() => { window.notes.listTrash().then(setItems).catch(() => setItems([])) }, [token])
  return (
    <Page title="Trash" onBack={onBack} right={items.length > 0 ? <button type="button" className="mobile-link-button" onClick={() => { if (confirm('Delete every note in the trash permanently?')) window.notes.emptyTrash().then(() => bump()) }}>Empty</button> : undefined}>
      <ListSection>
        {items.length === 0 && <div className="mobile-empty">Trash is empty.</div>}
        {items.map((n) => (
          <Row key={n.id} title={n.title || 'Untitled'} subtitle={n.deletedAt ? `Deleted ${new Date(n.deletedAt).toLocaleString()}` : undefined} chevron onClick={() => actions(`trash-${n.id}`, n.title || 'Untitled', [
            { id: 'restore', label: 'Restore', onSelect: () => { window.notes.restoreNote(n.id).then(() => bump()) } },
            { id: 'purge', label: 'Delete permanently', destructive: true, onSelect: () => { if (confirm('Delete this note permanently?')) window.notes.purgeTrashItem(n.id).then(() => bump()) } },
          ])} />
        ))}
      </ListSection>
    </Page>
  )
}
