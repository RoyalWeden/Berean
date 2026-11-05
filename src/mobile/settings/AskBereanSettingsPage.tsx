import React, { useState } from 'react'
import { Plus, Copy, Trash2, X } from 'lucide-react'
import { Page, ListSection, Row } from '../primitives/Page'
import { Toggle } from './SettingsControls'
import { COLLECTIONS } from '@/lib/research/collections'
import { DEFAULT_PROFILE_ID } from '@/lib/research/studyProfile'
import { NO_MODEL_REASON } from '@/components/ailookup/chatModes'
import { useAskModels, useStudyProfiles } from '@/components/ailookup/useStudyProfiles'
import './settings.css'

/**
 * Settings → Ask Berean (spec §7.1–7.2) on iPhone: the same study-profile fields as the Mac's
 * Settings → Ask Berean, in a phone layout over the same logic (useStudyProfiles). The cloud
 * model and local-model picker are Mac-only and are left out: the iPhone has neither. Commentary
 * and Deep Search need an AI model, so without one they are shown disabled with the reason
 * rather than as switches that would promise something the iPhone can't do.
 */
export function AskBereanSettingsPage({ onBack }: { onBack?: () => void }) {
  const { profiles, saved, profile, save, switchTo, add, duplicate, remove, removeSaved } = useStudyProfiles()
  const { models } = useAskModels()
  const [aliasFrom, setAliasFrom] = useState('')
  const [aliasTo, setAliasTo] = useState('')
  if (!profile) return <Page title="Ask Berean" onBack={onBack}><div className="mobile-empty">Loading…</div></Page>
  const cfg = profile.config
  const isDefault = profile.id === DEFAULT_PROFILE_ID
  const hasModel = models.length > 0
  const toggleRow = (title: string, subtitle: string, checked: boolean, field: 'defaultCommentary' | 'defaultDeepSearch') => hasModel
    ? <Row title={title} subtitle={subtitle} right={<Toggle checked={checked} onChange={() => void save({ config: { [field]: !checked } })} label={title} />} />
    : <div className="m-ask-unavailable" aria-disabled="true"><Row title={title} subtitle={`${subtitle} ${NO_MODEL_REASON}`} /></div>
  const noteRow = (title: string, subtitle: string, checked: boolean, field: 'useVerseNotes' | 'useStandaloneNotes') => (
    <Row title={title} subtitle={subtitle} right={<Toggle checked={checked} onChange={() => void save({ config: { [field]: !checked } })} label={title} />} />
  )
  return (
    <Page title="Ask Berean" onBack={onBack}>
      <div className="settings-section-note">A study profile sets what Ask Berean searches and how it words its own replies. It never changes Scripture text, lexicon entries or Strong&apos;s numbers.</div>

      <ListSection title="Study Profile">
        {profiles.map((p) => <Row key={p.id} title={p.name} selected={p.id === profile.id} onClick={() => switchTo(p.id)} />)}
        <Row title="New Profile" leading={<Plus size={20} />} onClick={() => void add()} />
        <Row title="Duplicate Profile" leading={<Copy size={20} />} onClick={() => void duplicate()} />
        {!isDefault && <Row title="Delete Profile" leading={<Trash2 size={20} />} destructive
          onClick={() => { if (window.confirm(`Delete “${profile.name}”? Chats that used it keep their answers. This iPhone switches to the Default profile.`)) void remove(profile) }} />}
      </ListSection>
      {!isDefault && (
        <ListSection title="Name">
          <div className="mobile-embedded-section">
            <input className="mobile-input" aria-label="Profile name" key={`name-${profile.id}`} defaultValue={profile.name}
              onBlur={(e) => { if (e.currentTarget.value.trim() && e.currentTarget.value !== profile.name) void save({ name: e.currentTarget.value }) }} />
          </div>
        </ListSection>
      )}

      <ListSection title="New Chats Start With">
        {toggleRow('Commentary', 'Off: research only, with no interpretation.', cfg.defaultCommentary, 'defaultCommentary')}
        {toggleRow('Deep Search', 'Researches more thoroughly. Slower.', cfg.defaultDeepSearch, 'defaultDeepSearch')}
      </ListSection>

      <ListSection title="Search In">
        {COLLECTIONS.map((c) => {
          const on = cfg.collections.includes(c.id)
          return (
            <Row key={c.id} title={c.label}
              right={<Toggle checked={on} label={c.label} onChange={() => { if (on && cfg.collections.length === 1) return; void save({ config: { collections: on ? cfg.collections.filter((x) => x !== c.id) : [...cfg.collections, c.id] } }) }} />} />
          )
        })}
      </ListSection>
      <div className="settings-section-note">A scope in your question (“only the Apocrypha”) always wins.</div>

      <ListSection title="Your Notes">
        {noteRow('Use verse notes to find related verses', 'They are never shown as Scripture.', cfg.useVerseNotes, 'useVerseNotes')}
        {noteRow('Search standalone notes during research', 'Notes marked “Exclude from AI” are never used.', cfg.useStandaloneNotes, 'useStandaloneNotes')}
      </ListSection>

      <ListSection title="Names in Berean's Replies">
        {cfg.displayAliases.map((a, i) => (
          <Row key={`${a.from}-${i}`} title={`${a.from} → ${a.to}`}
            right={<button type="button" className="mobile-icon-tap" aria-label={`Remove ${a.from} → ${a.to}`}
              onClick={() => void save({ config: { displayAliases: cfg.displayAliases.filter((_, j) => j !== i) } })}><X size={18} aria-hidden /></button>} />
        ))}
        <div className="mobile-embedded-section m-ask-alias">
          <input className="mobile-input" aria-label="Name as written" placeholder="As written (e.g. Jesus)" value={aliasFrom} onChange={(e) => setAliasFrom(e.target.value)} />
          <input className="mobile-input" aria-label="Preferred name" placeholder="Preferred (e.g. Yeshua)" value={aliasTo} onChange={(e) => setAliasTo(e.target.value)} />
          <button type="button" className="mobile-chip" disabled={!aliasFrom.trim() || !aliasTo.trim()}
            onClick={() => { void save({ config: { displayAliases: [...cfg.displayAliases, { from: aliasFrom.trim(), to: aliasTo.trim() }] } }); setAliasFrom(''); setAliasTo('') }}>Add</button>
        </div>
      </ListSection>
      <div className="settings-section-note">Used in Berean&apos;s own sentences only. Quoted verses keep their translation&apos;s wording.</div>

      <ListSection title="Research Focus">
        <div className="mobile-embedded-section">
          <textarea className="mobile-input m-ask-text" aria-label="Research focus" key={`focus-${profile.id}`} defaultValue={cfg.researchInstructions} rows={3}
            placeholder="e.g. Prefer Torah passages; show LXX wording where it differs"
            onBlur={(e) => { if (e.currentTarget.value !== cfg.researchInstructions) void save({ config: { researchInstructions: e.currentTarget.value } }) }} />
        </div>
      </ListSection>

      <ListSection title="Interpretive Approach">
        <div className="mobile-embedded-section">
          <textarea className="mobile-input m-ask-text" aria-label="Interpretive approach" key={`approach-${profile.id}`} defaultValue={cfg.interpretiveApproach} rows={3}
            placeholder="e.g. Read from a Torah-observant perspective"
            onBlur={(e) => { if (e.currentTarget.value !== cfg.interpretiveApproach) void save({ config: { interpretiveApproach: e.currentTarget.value } }) }} />
        </div>
      </ListSection>
      <div className="settings-section-note">Only used when Commentary is on, and always labelled as interpretation.</div>

      <ListSection title="Saved Research">
        {saved.length === 0
          ? <div className="mobile-empty">Nothing saved. Use “Save research” on an Ask Berean reply to keep its passages and Strong&apos;s numbers for another chat.</div>
          : saved.map((c) => (
            <Row key={c.id} title={c.title} right={<Trash2 size={18} aria-hidden />}
              subtitle={[c.content.refs.length ? `${c.content.refs.length} passage${c.content.refs.length === 1 ? '' : 's'}` : '', c.content.strongs.join(' · ')].filter(Boolean).join(' · ') || undefined}
              onClick={() => { if (window.confirm(`Delete saved research “${c.title}”?`)) void removeSaved(c.id) }} />
          ))}
      </ListSection>
    </Page>
  )
}
