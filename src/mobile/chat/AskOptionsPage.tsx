import React from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { Page, ListSection, Row } from '../primitives/Page'
import { useNavigation } from '../navigation/NavigationStack'
import { Toggle } from '../settings/SettingsControls'
import { AskBereanSettingsPage } from '../settings/AskBereanSettingsPage'
import { useAppStore } from '@/store'
import { COLLECTIONS } from '@/lib/research/collections'
import { CHAT_MODE_TOGGLES, NO_MODEL_REASON } from '@/components/ailookup/chatModes'
import { useAskModels, useStudyProfiles } from '@/components/ailookup/useStudyProfiles'

/**
 * The Ask Berean options on iPhone, a full page like the Send To picker (the Mac's mode menu is a
 * popover): study profile, Search in, saved research, and the two modes. Commentary and Deep
 * Search need an AI model, so without one they are disabled rows that say why, never switches
 * that would suggest the reply can be written or researched in rounds. They light up when
 * `checkAvailable()` reports a model.
 */
/** The saved research chosen for the next Ask Berean send. Held by ChatPage (the page is a fixed
 *  stack entry, so it reads this through context rather than props). */
export const AskSavedContext = React.createContext<{ id: string | null; set: (id: string | null) => void }>({ id: null, set: () => {} })

export function AskOptionsPage() {
  const nav = useNavigation()
  const { id: savedContextId, set: onSavedContextChange } = React.useContext(AskSavedContext)
  const { profiles, saved, profile, switchTo } = useStudyProfiles()
  const { models } = useAskModels()
  const hasModel = models.length > 0
  const collections = useAppStore((s) => s.aiLookupCollections)
  const setCollections = useAppStore((s) => s.setAiLookupCollections)
  const flags = { commentary: useAppStore((s) => s.aiLookupCommentaryOn), deepSearch: useAppStore((s) => s.aiLookupAgenticOn) }
  const setFlag = { commentary: useAppStore((s) => s.setAiLookupCommentaryOn), deepSearch: useAppStore((s) => s.setAiLookupAgenticOn) }
  return (
    <Page title="Ask Berean" onBack={nav.pop} backLabel="Back">
      <ListSection title="Study Profile">
        {profiles.map((p) => <Row key={p.id} title={p.name} selected={p.id === profile?.id} onClick={() => switchTo(p.id)} />)}
        <Row title="Manage Profiles" leading={<SlidersHorizontal size={20} />} chevron onClick={() => nav.push(PROFILES_KEY, <AskBereanSettingsPage onBack={nav.pop} />)} />
      </ListSection>

      <ListSection title="Mode">
        {CHAT_MODE_TOGGLES.map((t) => hasModel
          ? <Row key={t.key} title={t.label} subtitle={t.hint} right={<Toggle checked={flags[t.key]} label={t.label} onChange={setFlag[t.key]} />} />
          : <div key={t.key} className="m-ask-unavailable" aria-disabled="true"><Row title={t.label} subtitle={NO_MODEL_REASON} /></div>)}
      </ListSection>

      <ListSection title="Search In">
        {COLLECTIONS.map((c) => {
          const on = collections.includes(c.id)
          return (
            <Row key={c.id} title={c.label}
              right={<Toggle checked={on} label={c.label} onChange={() => { if (on && collections.length === 1) return; setCollections(on ? collections.filter((x) => x !== c.id) : [...collections, c.id]) }} />} />
          )
        })}
      </ListSection>

      {saved.length > 0 && (
        <ListSection title="Use Saved Research">
          {saved.map((c) => (
            <Row key={c.id} title={c.title} selected={c.id === savedContextId} onClick={() => onSavedContextChange(c.id === savedContextId ? null : c.id)} />
          ))}
        </ListSection>
      )}
    </Page>
  )
}

const PROFILES_KEY = 'chat-ask-profiles'
export const ASK_OPTIONS_KEY = 'chat-ask-options'
