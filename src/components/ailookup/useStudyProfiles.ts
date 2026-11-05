import { useCallback, useEffect, useState } from 'react'
import { useAppStore } from '@/store'
import { chatModels } from '@/lib/research/modelChoice'
import { DEFAULT_PROFILE_ID, type StudyProfile, type StudyProfileConfig } from '@/lib/research/studyProfile'
import type { SavedResearchContext } from '@/platform/services/savedContextsService'
import { activateProfile } from './profileActivation'

/** Installed chat models, or none (the iPhone has no local model yet, so Commentary and Deep
 *  Search are not available there). `checked` stays false until the first answer arrives. */
export function useAskModels(): { checked: boolean; models: string[] } {
  const [state, setState] = useState<{ checked: boolean; models: string[] }>({ checked: false, models: [] })
  useEffect(() => {
    let live = true
    void Promise.resolve().then(() => window.aiLookup.checkAvailable())
      .then((r) => { if (live) setState({ checked: true, models: chatModels(r.models) }) })
      .catch(() => { if (live) setState({ checked: true, models: [] }) })
    return () => { live = false }
  }, [])
  return state
}

/**
 * Study profiles and saved research (spec §7.1–7.2) for a settings surface: the list, the active
 * profile for this device, and the edit/switch/create/duplicate/delete actions. Shared by the
 * desktop Ask Berean section and the iPhone page so both reach the same fields the same way.
 */
export function useStudyProfiles() {
  const activeId = useAppStore((s) => s.aiLookupProfileId)
  const [profiles, setProfiles] = useState<StudyProfile[]>([])
  const [saved, setSaved] = useState<SavedResearchContext[]>([])

  const reload = useCallback(async () => {
    const [p, c] = await Promise.all([
      Promise.resolve().then(() => window.aiLookup.listProfiles()).catch(() => []),
      Promise.resolve().then(() => window.aiLookup.listSavedContexts()).catch(() => []),
    ])
    setProfiles(p)
    setSaved(c)
  }, [])
  useEffect(() => { void reload() }, [reload])

  const profile = profiles.find((p) => p.id === activeId) ?? profiles.find((p) => p.id === DEFAULT_PROFILE_ID)

  const save = async (patch: { name?: string; config?: Partial<StudyProfileConfig> }) => {
    if (!profile) return
    const next = await window.aiLookup.updateProfile(profile.id, patch)
    if (next) {
      setProfiles((list) => list.map((p) => (p.id === next.id ? next : p)))
      if (patch.config?.collections) useAppStore.getState().setAiLookupCollections(next.config.collections)
      if (patch.config?.displayAliases) useAppStore.getState().setAiLookupDisplayAliases(next.config.displayAliases)
    }
  }
  const switchTo = (id: string) => {
    const p = profiles.find((x) => x.id === id)
    if (p) activateProfile(p)
  }
  const add = async () => {
    const p = await window.aiLookup.createProfile('New profile')
    await reload()
    activateProfile(p)
  }
  const duplicate = async () => {
    if (!profile) return
    const p = await window.aiLookup.duplicateProfile(profile.id)
    await reload()
    if (p) activateProfile(p)
  }
  const remove = async (p: StudyProfile) => {
    await window.aiLookup.deleteProfile(p.id)
    const list = await window.aiLookup.listProfiles()
    setProfiles(list)
    const fallback = list.find((x) => x.id === DEFAULT_PROFILE_ID)
    if (fallback && activeId === p.id) activateProfile(fallback)
  }
  const removeSaved = async (id: string) => { await window.aiLookup.deleteSavedContext(id); await reload() }

  return { activeId, profiles, saved, profile, save, switchTo, add, duplicate, remove, removeSaved }
}
