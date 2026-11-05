import { useAppStore } from '@/store'
import type { StudyProfile } from '@/lib/research/studyProfile'

/** Makes a study profile active on this device: its search collections and default modes become
 *  the composer's current state (the profile row itself is unchanged and keeps syncing). */
export function activateProfile(p: StudyProfile): void {
  const st = useAppStore.getState()
  st.setAiLookupProfileId(p.id)
  st.setAiLookupCollections(p.config.collections)
  st.setAiLookupCommentaryOn(p.config.defaultCommentary)
  st.setAiLookupAgenticOn(p.config.defaultDeepSearch)
  st.setAiLookupDisplayAliases(p.config.displayAliases)
}
