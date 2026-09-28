import React, { useEffect } from 'react'
import { Cloud } from 'lucide-react'
import ICloudSection from '@/components/settings/sections/ICloudSection'
import { useSyncUi, wireSyncUi, presentSync } from '@/lib/syncUi'
import { Page } from '../primitives/Page'
import { Toggle } from './SettingsControls'

/**
 * iCloud on the iPhone (DATA-UX-001): the Settings list shows only a compact row — iCloud, a
 * one-line status, the toggle — and the detail lives on its own page. Both toggles drive the SAME
 * shared state (lib/syncUi), so they always agree and update together. Turning sync on from the
 * row opens the page, where the first-sync progress is shown (it continues in the background).
 */
export function ICloudRow({ onOpen }: { onOpen: () => void }) {
  useEffect(() => { wireSyncUi() }, [])
  const { config, status, busy, setupInProgress, setEnabled } = useSyncUi()
  const pres = presentSync(config, status, { setupInProgress, busy })
  const on = !!config?.enabled
  return (
    <div className="mobile-row m-icloud-row">
      <button type="button" className="m-icloud-row-main" onClick={onOpen} aria-label={`iCloud, ${pres.short}`}>
        <span className="mobile-row-leading"><Cloud size={20} aria-hidden /></span>
        <span className="mobile-row-text">
          <span className="mobile-row-title">iCloud</span>
          <span className="mobile-row-subtitle" aria-live="polite">{pres.short}</span>
        </span>
      </button>
      <Toggle checked={on} label="iCloud Sync" onChange={(v) => { void setEnabled(v); if (v) onOpen() }} />
    </div>
  )
}

export function ICloudSettingsPage({ onBack }: { onBack: () => void }) {
  return (
    <Page title="iCloud" onBack={onBack} backLabel="Settings">
      <div className="mobile-embedded-section m-icloud-page"><ICloudSection variant="mobile" /></div>
    </Page>
  )
}
