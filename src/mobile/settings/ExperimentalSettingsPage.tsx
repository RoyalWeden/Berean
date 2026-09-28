import React from 'react'
import { useAppStore } from '@/store'
import { Page, ListSection, Row } from '../primitives/Page'
import { Toggle } from './SettingsControls'
import './settings.css'

/**
 * Settings → Experimental (R087). Only `pdfFeatureEnabled` carries over from desktop's
 * ExperimentalSection.tsx — the store key is real and shared (`window.pdf` exists on iOS,
 * src/platform/ios/bridgeExtras.ts), so this toggle genuinely enables/disables PDF import.
 * "Pull to change chapter" is left out: `chapterPullNavEnabled` is read only by the desktop
 * `BiblePanel.tsx` (a trackpad/mouse-wheel gesture disambiguation problem that doesn't exist on
 * a touchscreen); the phone's own reader (mobile/reader/ReaderPage.tsx) doesn't consult it.
 *
 * FOLLOW-UP FOR WHOEVER OWNS MobileApp.tsx: the "PDF library" row in `MorePage` (MobileApp.tsx)
 * is currently unconditional — it doesn't check `pdfFeatureEnabled` the way desktop's sidebar
 * gates the PDF space on this flag. Turning this toggle off here won't hide that row yet. Lane A
 * doesn't own MobileApp.tsx so isn't wiring that gate itself; flagging it so the toggle becomes
 * fully effective once someone adds `{pdfFeatureEnabled && <Row .../>}` there.
 */
export function ExperimentalSettingsPage({ onBack }: { onBack?: () => void }) {
  const pdfFeatureEnabled = useAppStore((s) => s.pdfFeatureEnabled)
  const setPdfFeatureEnabled = useAppStore((s) => s.setPdfFeatureEnabled)
  return (
    <Page title="Experimental" onBack={onBack}>
      <div className="settings-section-note">Opt-in features that are off by default.</div>
      <ListSection>
        <Row
          title="PDF library & viewer"
          subtitle="Import and read PDF documents inside Berean. Long PDFs can use significant memory since viewed pages aren't released yet."
          right={<Toggle checked={pdfFeatureEnabled} onChange={setPdfFeatureEnabled} label="PDF library & viewer" />}
        />
      </ListSection>
    </Page>
  )
}
