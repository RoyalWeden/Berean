import { useCallback, useEffect, useState } from 'react'
import { Copy, Plus, Trash2, X } from 'lucide-react'
import { AlertSheet, Button, Checkbox, IconButton, SectionLabel, Select, Switch, TextArea, TextField } from '@/components/ui'
import { useAppStore } from '@/store'
import { COLLECTIONS } from '@/lib/research/collections'
import { chatModels } from '@/lib/research/modelChoice'
import { DEFAULT_PROFILE_ID, type StudyProfile, type StudyProfileConfig } from '@/lib/research/studyProfile'
import type { SavedResearchContext } from '@/platform/services/savedContextsService'
import { activateProfile } from '@/components/ailookup/profileActivation'
import type { AiCloudSettings } from '@/types/electron'
import LocalModelsSettings from './LocalModelsSettings'

/**
 * Optional bring-your-own-key cloud model (spec §7.3, §8.5). Desktop only: the key goes to the main
 * process and only "a key is saved" ever comes back. Off until the user turns it on; turning it on
 * needs a saved key and a model, and removing the key turns it off.
 */
function CloudModelSettings() {
  const api = window.aiLookup
  const [settings, setSettings] = useState<AiCloudSettings | null>(null)
  const [hasKey, setHasKey] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  const [message, setMessage] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)

  useEffect(() => {
    void Promise.all([api.getCloudSettings?.(), api.hasProviderKey?.('anthropic')]).then(([s, k]) => { setSettings(s ?? null); setHasKey(!!k) })
  }, [api])
  if (!settings || !api.setCloudSettings) return null

  const update = async (patch: Partial<AiCloudSettings>) => { const next = await api.setCloudSettings?.(patch); if (next) setSettings(next) }
  const saveKey = async () => {
    const res = await api.saveProviderKey?.('anthropic', keyDraft)
    setKeyDraft('')
    if (res?.ok) { setHasKey(true); setMessage('Key saved.') } else setMessage(res?.reason ?? 'The key was not saved.')
  }
  const checkKey = async () => {
    setMessage('Checking…')
    const res = await api.checkProviderKey?.()
    setMessage(res?.ok ? 'Anthropic accepted this key.' : res?.reason ?? 'The key could not be checked.')
  }
  const removeKey = async () => {
    await api.removeProviderKey?.('anthropic')
    setHasKey(false)
    setMessage('Key removed.')
    setSettings(await api.getCloudSettings?.() ?? settings)
  }
  const row = 'flex items-start justify-between gap-4'
  return (
    <div className="space-y-3">
      <SectionLabel>Cloud model (optional)</SectionLabel>
      <p className="s-desc text-caption text-text-muted">
        Ask Berean runs on this device. With your own Anthropic API key it can use a cloud model instead. Your question
        and the verses found are sent to Anthropic, and usage is billed to your key. This is separate from a Claude subscription.
      </p>
      <div className="flex items-center gap-2">
        <TextField aria-label="Anthropic API key" type="password" size="sm" autoComplete="off" value={keyDraft}
          placeholder={hasKey ? 'A key is saved — enter a new one to replace it' : 'Anthropic API key'}
          onChange={(e) => setKeyDraft(e.target.value)} />
        <Button size="sm" variant="ghost" disabled={!keyDraft.trim()} onClick={() => void saveKey()}>{hasKey ? 'Replace' : 'Save'}</Button>
        {hasKey && <Button size="sm" variant="ghost" onClick={() => void checkKey()}>Check key</Button>}
        {hasKey && <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setConfirmRemove(true)}>Remove</Button>}
      </div>
      {message && <p role="status" className="s-desc text-caption text-text-muted">{message}</p>}
      <TextField aria-label="Cloud model ID" size="sm" key={`cloud-model-${settings.cloudModel}`} defaultValue={settings.cloudModel}
        placeholder="Model ID from your Anthropic account"
        onBlur={(e) => { if (e.currentTarget.value.trim() !== settings.cloudModel) void update({ cloudModel: e.currentTarget.value }) }} />
      <div className={row}>
        <div>
          <p className="text-subhead font-medium text-text-primary">Use the cloud model</p>
          <p className="s-desc text-caption text-text-muted mt-0.5">Applies to every question until turned off. If the local model fails, Ask Berean never switches to the cloud by itself.</p>
        </div>
        <Switch label="Use the cloud model" checked={settings.cloudEnabled} disabled={!hasKey || !settings.cloudModel}
          onCheckedChange={() => void update({ cloudEnabled: !settings.cloudEnabled })} />
      </div>
      <div className={row}>
        <div>
          <p className="text-subhead font-medium text-text-primary">Also send notes and conversation</p>
          <p className="s-desc text-caption text-text-muted mt-0.5">Off: your notes, earlier messages, open tab and profile instructions stay on this device. Notes marked “Exclude from AI” are never sent.</p>
        </div>
        <Switch label="Also send notes and conversation" checked={settings.cloudPrivateContext} disabled={!settings.cloudEnabled}
          onCheckedChange={() => void update({ cloudPrivateContext: !settings.cloudPrivateContext })} />
      </div>
      <AlertSheet open={confirmRemove} onOpenChange={setConfirmRemove} title="Remove the API key?"
        message="Ask Berean goes back to your local model." confirmLabel="Remove" destructive defaultIsCancel
        onConfirm={() => { setConfirmRemove(false); void removeKey() }} />
    </div>
  )
}

/**
 * Settings → Ask Berean (spec §7.1–7.2): study profiles and saved research. One small surface —
 * advanced options stay here, not in the composer. A profile shapes search and Berean's own
 * wording; it never changes Scripture, lexicon text or Strong's numbers, and its interpretive
 * approach is only used with Commentary on.
 */
export default function AskBereanSection() {
  const activeId = useAppStore((s) => s.aiLookupProfileId)
  const [profiles, setProfiles] = useState<StudyProfile[]>([])
  const [saved, setSaved] = useState<SavedResearchContext[]>([])
  const [confirmDelete, setConfirmDelete] = useState<StudyProfile | null>(null)
  const [aliasFrom, setAliasFrom] = useState('')
  const [aliasTo, setAliasTo] = useState('')
  const [models, setModels] = useState<string[]>([])

  useEffect(() => { void Promise.resolve().then(() => window.aiLookup.checkAvailable()).then((r) => setModels(chatModels(r.models))).catch(() => {}) }, [])

  const reload = useCallback(async () => {
    const [p, c] = await Promise.all([window.aiLookup.listProfiles().catch(() => []), window.aiLookup.listSavedContexts().catch(() => [])])
    setProfiles(p)
    setSaved(c)
  }, [])
  useEffect(() => { void reload() }, [reload])

  const profile = profiles.find((p) => p.id === activeId) ?? profiles.find((p) => p.id === DEFAULT_PROFILE_ID)
  if (!profile) return <p className="s-desc text-caption text-text-muted">Loading…</p>
  const cfg = profile.config

  const save = async (patch: { name?: string; config?: Partial<StudyProfileConfig> }) => {
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

  const row = 'flex items-start justify-between gap-4'
  return (
    <div className="space-y-6">
      <p className="s-desc text-caption text-text-muted -mt-2">
        A study profile sets what Ask Berean searches and how it words its own replies. It never changes
        Scripture text, lexicon entries or Strong&apos;s numbers.
      </p>

      <div className="space-y-3">
        <SectionLabel>Study profile</SectionLabel>
        <div className="flex items-center gap-2">
          <Select aria-label="Active study profile" value={profile.id} onChange={switchTo}
            options={profiles.map((p) => ({ value: p.id, label: p.name }))} className="min-w-[200px]" />
          <Button size="sm" variant="ghost" icon={Plus} onClick={() => void add()}>New</Button>
          <Button size="sm" variant="ghost" icon={Copy} onClick={() => void duplicate()}>Duplicate</Button>
          {profile.id !== DEFAULT_PROFILE_ID && (
            <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setConfirmDelete(profile)}>Delete</Button>
          )}
        </div>
        {profile.id !== DEFAULT_PROFILE_ID && (
          <TextField aria-label="Profile name" size="sm" defaultValue={profile.name} key={`name-${profile.id}`}
            onBlur={(e) => { if (e.currentTarget.value.trim() && e.currentTarget.value !== profile.name) void save({ name: e.currentTarget.value }) }} />
        )}
      </div>

      <div className="space-y-3">
        <SectionLabel>New chats start with</SectionLabel>
        <div className={row}>
          <div>
            <p className="text-subhead font-medium text-text-primary">Commentary</p>
            <p className="s-desc text-caption text-text-muted mt-0.5">Off: research only — verses, lexicon facts, occurrences, no interpretation.</p>
          </div>
          <Switch checked={cfg.defaultCommentary} onCheckedChange={() => void save({ config: { defaultCommentary: !cfg.defaultCommentary } })} />
        </div>
        <div className={row}>
          <div>
            <p className="text-subhead font-medium text-text-primary">Deep Search</p>
            <p className="s-desc text-caption text-text-muted mt-0.5">Researches more thoroughly. Slower. Never adds interpretation by itself.</p>
          </div>
          <Switch checked={cfg.defaultDeepSearch} onCheckedChange={() => void save({ config: { defaultDeepSearch: !cfg.defaultDeepSearch } })} />
        </div>
      </div>

      {models.length > 0 && (
        <div className="space-y-2">
          <SectionLabel>Local model</SectionLabel>
          <p className="s-desc text-caption text-text-muted">Automatic uses the recommended model you have installed.</p>
          <Select aria-label="Local model" value={models.includes(cfg.model) ? cfg.model : 'auto'} onChange={(model) => void save({ config: { model } })}
            options={[{ value: 'auto', label: 'Automatic' }, ...models.map((m) => ({ value: m, label: m }))]} className="min-w-[200px]" />
        </div>
      )}

      <LocalModelsSettings />

      <div className="space-y-2">
        <SectionLabel>Search in</SectionLabel>
        <p className="s-desc text-caption text-text-muted">A scope in your question (“only the Apocrypha”) always wins.</p>
        {COLLECTIONS.map((c) => {
          const on = cfg.collections.includes(c.id)
          return (
            <Checkbox key={c.id} label={c.label} checked={on} disabled={on && cfg.collections.length === 1}
              onChange={() => void save({ config: { collections: on ? cfg.collections.filter((x) => x !== c.id) : [...cfg.collections, c.id] } })} />
          )
        })}
      </div>

      <div className="space-y-3">
        <SectionLabel>Your notes</SectionLabel>
        <div className={row}>
          <div>
            <p className="text-subhead font-medium text-text-primary">Use verse notes to find related verses</p>
            <p className="s-desc text-caption text-text-muted mt-0.5">Notes attached to a verse help rank related passages. They are never shown as Scripture.</p>
          </div>
          <Switch checked={cfg.useVerseNotes} onCheckedChange={() => void save({ config: { useVerseNotes: !cfg.useVerseNotes } })} />
        </div>
        <div className={row}>
          <div>
            <p className="text-subhead font-medium text-text-primary">Search standalone notes during research</p>
            <p className="s-desc text-caption text-text-muted mt-0.5">When off, other notes are searched only when you ask about your notes. Notes marked “Exclude from AI” are never used.</p>
          </div>
          <Switch checked={cfg.useStandaloneNotes} onCheckedChange={() => void save({ config: { useStandaloneNotes: !cfg.useStandaloneNotes } })} />
        </div>
      </div>

      <div className="space-y-2">
        <SectionLabel>Names in Berean&apos;s replies</SectionLabel>
        <p className="s-desc text-caption text-text-muted">Used in Berean&apos;s own sentences only — quoted verses keep their translation&apos;s wording. Replaced names are marked.</p>
        {cfg.displayAliases.map((a, i) => (
          <div key={`${a.from}-${i}`} className="flex items-center gap-2 text-caption">
            <span className="text-text-secondary">{a.from}</span><span className="text-text-muted">→</span><span className="text-text-primary font-medium">{a.to}</span>
            <IconButton icon={X} label={`Remove ${a.from} → ${a.to}`} size={20} variant="ghost"
              onClick={() => void save({ config: { displayAliases: cfg.displayAliases.filter((_, j) => j !== i) } })} />
          </div>
        ))}
        <div className="flex items-center gap-2">
          <TextField aria-label="Name as written" placeholder="As written (e.g. Jesus)" size="sm" value={aliasFrom} onChange={(e) => setAliasFrom(e.target.value)} />
          <TextField aria-label="Preferred name" placeholder="Preferred (e.g. Yeshua)" size="sm" value={aliasTo} onChange={(e) => setAliasTo(e.target.value)} />
          <Button size="sm" variant="ghost" icon={Plus} disabled={!aliasFrom.trim() || !aliasTo.trim()}
            onClick={() => { void save({ config: { displayAliases: [...cfg.displayAliases, { from: aliasFrom.trim(), to: aliasTo.trim() }] } }); setAliasFrom(''); setAliasTo('') }}>Add</Button>
        </div>
      </div>

      <div className="space-y-2">
        <SectionLabel>Research focus</SectionLabel>
        <TextArea aria-label="Research focus" key={`focus-${profile.id}`} defaultValue={cfg.researchInstructions} rows={2}
          placeholder="e.g. Prefer Torah passages; show LXX wording where it differs"
          onBlur={(e) => { if (e.currentTarget.value !== cfg.researchInstructions) void save({ config: { researchInstructions: e.currentTarget.value } }) }} />
      </div>

      <div className="space-y-2">
        <SectionLabel>Interpretive approach</SectionLabel>
        <p className="s-desc text-caption text-text-muted">Only used when Commentary is on, and always labelled as interpretation.</p>
        <TextArea aria-label="Interpretive approach" key={`approach-${profile.id}`} defaultValue={cfg.interpretiveApproach} rows={2}
          placeholder="e.g. Read from a Torah-observant perspective"
          onBlur={(e) => { if (e.currentTarget.value !== cfg.interpretiveApproach) void save({ config: { interpretiveApproach: e.currentTarget.value } }) }} />
      </div>

      <div className="space-y-2">
        <SectionLabel>Saved research</SectionLabel>
        {saved.length === 0
          ? <p className="s-desc text-caption text-text-muted">Nothing saved. Use “Save research” on an Ask Berean reply to keep its passages and Strong&apos;s numbers for another chat.</p>
          : saved.map((c) => (
            <div key={c.id} className="flex items-start justify-between gap-3 px-3 py-2 rounded-row bg-surface-elevated">
              <div className="min-w-0">
                <p className="text-caption font-medium text-text-primary truncate">{c.title}</p>
                <p className="text-caption2 text-text-muted truncate">
                  {[c.content.refs.length ? `${c.content.refs.length} passage${c.content.refs.length === 1 ? '' : 's'}` : '', c.content.strongs.join(' · ')].filter(Boolean).join(' · ')}
                </p>
              </div>
              <IconButton icon={Trash2} label={`Delete saved research ${c.title}`} size={24} variant="ghost"
                onClick={() => { void window.aiLookup.deleteSavedContext(c.id).then(reload) }} />
            </div>
          ))}
      </div>

      <CloudModelSettings />

      <AlertSheet open={!!confirmDelete} onOpenChange={(o) => { if (!o) setConfirmDelete(null) }}
        title={`Delete “${confirmDelete?.name ?? ''}”?`} message="Chats that used it keep their answers. This device switches to the Default profile."
        confirmLabel="Delete" destructive defaultIsCancel
        onConfirm={() => { const p = confirmDelete; setConfirmDelete(null); if (p) void remove(p) }} />
    </div>
  )
}
