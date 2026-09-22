import React from 'react'
import { useAppStore } from '@/store'
import WordReplacerSection from '@/components/settings/sections/WordReplacerSection'
import { Page, ListSection } from '../primitives/Page'
import './settings.css'

/** Settings → Reading → Word replacer (R087). Same shared component and store keys as desktop's
 *  Reading section (SettingsModal.tsx) — divine-name / archaic-name substitution in scripture
 *  text, applies wherever verse text renders. */
export function WordReplacerPage({ onBack }: { onBack?: () => void }) {
  const wordReplacerEnabled = useAppStore((s) => s.wordReplacerEnabled)
  const wordReplacerRules = useAppStore((s) => s.wordReplacerRules)
  const setWordReplacerEnabled = useAppStore((s) => s.setWordReplacerEnabled)
  const toggleWordReplacerRule = useAppStore((s) => s.toggleWordReplacerRule)
  return (
    <Page title="Word replacer" onBack={onBack}>
      <ListSection>
        <div className="mobile-embedded-section">
          <WordReplacerSection
            enabled={wordReplacerEnabled}
            rules={wordReplacerRules}
            onToggleEnabled={setWordReplacerEnabled}
            onToggleRule={toggleWordReplacerRule}
          />
        </div>
      </ListSection>
    </Page>
  )
}
