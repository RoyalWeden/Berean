import React from 'react'
import { useAppStore } from '@/store'
import HistorySection from '@/components/settings/sections/HistorySection'
import WorkspacesSection from '@/components/settings/sections/WorkspacesSection'
import SessionsSection from '@/components/settings/sections/SessionsSection'
import { Page, ListSection } from '../primitives/Page'
import { DangerActionCard, type DangerAction } from './SettingsControls'
import './settings.css'

/**
 * Settings → Data (R087). History/Workspaces/Sessions are the same shared components desktop
 * uses (self-wired via useAppStore + window.workspaces/window.appHistory, both real on the
 * phone — src/platform/ios/bridge.ts). Import (e-Sword / BibleGateway) is NOT here: both go
 * through `window.bgImport` / `window.eSwordImport`, which bridge.ts deliberately does not
 * install on iOS (network-scraping + folder-dialog flows that don't have a phone story yet) —
 * a hosted ImportSection would throw on every action, which is exactly the "no fake
 * implementations" case Lane A was told to leave out and list here instead.
 *
 * Danger zone is rebuilt natively (not an embed of DangerSection.tsx) so its confirmation step
 * is a native confirm() instead of typing a confirm word on the software keyboard — same
 * underlying calls (clearHistory / window.notes.deleteByTag / window.notes.deleteAllNotes).
 */
export function DataSettingsPage({ onBack }: { onBack?: () => void }) {
  const clearHistory = useAppStore((s) => s.clearHistory)
  const bumpNoteToken = useAppStore((s) => s.bumpNoteToken)

  const actions: DangerAction[] = [
    {
      id: 'clear-history',
      title: 'Clear browsing history',
      description: 'Removes the navigation history log. Notes and highlights are not affected.',
      buttonLabel: 'Clear history',
      onConfirm: async () => { clearHistory() },
    },
    {
      id: 'delete-bg-notes',
      title: 'Delete all BibleGateway notes',
      description: 'Permanently deletes every note imported from BibleGateway.',
      buttonLabel: 'Delete BibleGateway notes',
      onConfirm: async () => { await window.notes.deleteByTag('biblegateway'); bumpNoteToken() },
    },
    {
      id: 'delete-esword-notes',
      title: 'Delete all e-Sword notes',
      description: 'Permanently deletes every note imported from e-Sword.',
      buttonLabel: 'Delete e-Sword notes',
      onConfirm: async () => { await window.notes.deleteByTag('esword'); bumpNoteToken() },
    },
    {
      id: 'delete-all-notes',
      title: 'Delete all notes',
      description: 'Permanently deletes every note — verse notes, general notes, and daily notes — on this device and, with iCloud sync on, on every device and in iCloud. Export your notes first if you may want them back.',
      buttonLabel: 'Delete all notes',
      onConfirm: async () => { await window.notes.deleteAllNotes(); bumpNoteToken() },
    },
  ]

  return (
    <Page title="Data" onBack={onBack}>
      <ListSection title="Navigation & app history">
        <div className="mobile-embedded-section"><HistorySection /></div>
      </ListSection>
      <ListSection title="Saved sessions">
        <div className="mobile-embedded-section"><WorkspacesSection /></div>
      </ListSection>
      <ListSection>
        <div className="mobile-embedded-section"><SessionsSection /></div>
      </ListSection>
      <ListSection title="Danger zone">
        {actions.map((a) => <DangerActionCard key={a.id} action={a} />)}
      </ListSection>
    </Page>
  )
}
