import React, { useEffect, useState } from 'react'
import { useAppStore } from '@/store'
import { NOTE_STATUSES } from '@/lib/noteStatus'
import { BULLET_STYLE_DEFS } from '@/lib/noteTextBlocks'
import PrintExportSection from '@/components/settings/sections/PrintExportSection'
import { Page, ListSection, Row } from '../primitives/Page'
import { useNavigation } from '../navigation/NavigationStack'
import { Segmented, Toggle, Disclosure, RateStepper } from './SettingsControls'
import './settings.css'

/**
 * Settings → Notes (R087). Every toggle here is the same store key the desktop Notes section
 * (SettingsModal.tsx `section === 'notes'`) writes — the phone's note editor is the identical
 * shared component (`src/components/notes/pm/NoteEditorPM.tsx`, see NoteEditorPage.tsx), so these
 * take effect immediately, not just on desktop. "Manage tags" is reachable from More → Verse
 * tags already (MobileApp.tsx), so it isn't duplicated here. "Open note alongside scripture"
 * (desktop's `noteTransformLayout`, a panel-split concept) has no phone equivalent — omitted.
 */
export function NotesSettingsPage({ onBack }: { onBack?: () => void }) {
  const nav = useNavigation()
  const noteVerseRefsEnabled = useAppStore((s) => s.noteVerseRefsEnabled)
  const setNoteVerseRefsEnabled = useAppStore((s) => s.setNoteVerseRefsEnabled)
  const noteLexiconRefsEnabled = useAppStore((s) => s.noteLexiconRefsEnabled)
  const setNoteLexiconRefsEnabled = useAppStore((s) => s.setNoteLexiconRefsEnabled)
  const autoEmDash = useAppStore((s) => s.autoEmDash)
  const setAutoEmDash = useAppStore((s) => s.setAutoEmDash)
  const noteScriptureBlock = useAppStore((s) => s.noteScriptureBlock)
  const setNoteScriptureBlock = useAppStore((s) => s.setNoteScriptureBlock)
  const noteScriptureBlockThreshold = useAppStore((s) => s.noteScriptureBlockThreshold)
  const setNoteScriptureBlockThreshold = useAppStore((s) => s.setNoteScriptureBlockThreshold)
  const sidePanelScriptureBlock = useAppStore((s) => s.sidePanelScriptureBlock)
  const setSidePanelScriptureBlock = useAppStore((s) => s.setSidePanelScriptureBlock)
  const noteStrongsBlockSuggest = useAppStore((s) => s.noteStrongsBlockSuggest)
  const setNoteStrongsBlockSuggest = useAppStore((s) => s.setNoteStrongsBlockSuggest)
  const noteVerseBlockSuggest = useAppStore((s) => s.noteVerseBlockSuggest)
  const setNoteVerseBlockSuggest = useAppStore((s) => s.setNoteVerseBlockSuggest)
  const noteSpellCheck = useAppStore((s) => s.noteSpellCheck)
  const setNoteSpellCheck = useAppStore((s) => s.setNoteSpellCheck)
  const autoCopyOnHighlight = useAppStore((s) => s.autoCopyOnHighlight)
  const setAutoCopyOnHighlight = useAppStore((s) => s.setAutoCopyOnHighlight)
  const defaultNoteEditorMode = useAppStore((s) => s.defaultNoteEditorMode)
  const setDefaultNoteEditorMode = useAppStore((s) => s.setDefaultNoteEditorMode)
  const confirmNoteDelete = useAppStore((s) => s.confirmNoteDelete)
  const setConfirmNoteDelete = useAppStore((s) => s.setConfirmNoteDelete)
  const continuousDailyScroll = useAppStore((s) => s.continuousDailyScroll)
  const setContinuousDailyScroll = useAppStore((s) => s.setContinuousDailyScroll)
  const noteHeadingDivider = useAppStore((s) => s.noteHeadingDivider)
  const setNoteHeadingDivider = useAppStore((s) => s.setNoteHeadingDivider)
  const noteBulletStyle = useAppStore((s) => s.noteBulletStyle)
  const setNoteBulletStyle = useAppStore((s) => s.setNoteBulletStyle)

  const [defaultNoteStatus, setDefaultNoteStatus] = useState('none')
  useEffect(() => {
    window.settings.get('defaultNoteStatus').then((v) => { if (typeof v === 'string') setDefaultNoteStatus(v) }).catch(() => {})
  }, [])
  const saveDefaultNoteStatus = async (value: string) => {
    setDefaultNoteStatus(value)
    await window.settings.set('defaultNoteStatus', value)
  }

  return (
    <Page title="Notes" onBack={onBack}>
      <ListSection title="Reference detection">
        <Row title="Auto-detect verse references" subtitle="Make Bible references (e.g. Genesis 1:1) clickable" right={<Toggle checked={noteVerseRefsEnabled} onChange={setNoteVerseRefsEnabled} label="Auto-detect verse references" />} />
        <Row title="Auto-detect lexicon references" subtitle="Make Strong's numbers (e.g. H7225) clickable" right={<Toggle checked={noteLexiconRefsEnabled} onChange={setNoteLexiconRefsEnabled} label="Auto-detect lexicon references" />} />
        <Row title="Auto-format verse blocks" subtitle="A reference followed by its text becomes a styled scripture block" right={<Toggle checked={noteScriptureBlock} onChange={setNoteScriptureBlock} label="Auto-format verse blocks" />} />
        <Row title="Verse block suggestion" subtitle="Offer to expand a typed reference into a scripture block" right={<Toggle checked={noteVerseBlockSuggest} onChange={setNoteVerseBlockSuggest} label="Verse block suggestion" />} />
        <Row title="Strong's block suggestion" subtitle="Offer to expand a typed Strong's number into a lexicon block" right={<Toggle checked={noteStrongsBlockSuggest} onChange={setNoteStrongsBlockSuggest} label="Strong's block suggestion" />} />
      </ListSection>
      <ListSection>
        <Disclosure title="Advanced">
          <div className="settings-section-note" style={{ padding: '0 0 8px' }}>Fine-tuning for the block-suggestion system above.</div>
          <div className="mobile-list-group" style={{ marginBottom: 12 }}>
            <Row title="Suggest blocks in side panel" subtitle="Scripture tab's side-panel note editor — no phone equivalent yet, kept for parity" right={<Toggle checked={sidePanelScriptureBlock} onChange={setSidePanelScriptureBlock} label="Suggest blocks in side panel" />} />
          </div>
          {noteScriptureBlock && (
            <>
              <p className="mobile-row-title" style={{ padding: '0 2px 6px' }}>Verse-text match sensitivity</p>
              <RateStepper value={Math.round(noteScriptureBlockThreshold * 100)} min={50} max={100} step={5} format={(v) => `${v}%`} onChange={(v) => setNoteScriptureBlockThreshold(v / 100)} />
              <p className="settings-field-hint" style={{ padding: '8px 0 0' }}>A line only formats when at least this much of the actual verse text is present.</p>
            </>
          )}
        </Disclosure>
      </ListSection>

      <ListSection title="Writing">
        <Row title="Auto em dash" subtitle="Typing -- converts it to an em dash (—)" right={<Toggle checked={autoEmDash} onChange={setAutoEmDash} label="Auto em dash" />} />
        <Row title="Spell check" subtitle="Underline misspelled words in the notes editor" right={<Toggle checked={noteSpellCheck} onChange={setNoteSpellCheck} label="Spell check" />} />
        <Row title="Copy verse on highlight" subtitle="Copy verse text to clipboard when a highlight color is applied" right={<Toggle checked={autoCopyOnHighlight} onChange={setAutoCopyOnHighlight} label="Copy verse on highlight" />} />
        <Row title="Heading divider lines" subtitle="Show a subtle separator below each heading" right={<Toggle checked={noteHeadingDivider} onChange={setNoteHeadingDivider} label="Heading divider lines" />} />
      </ListSection>

      <ListSection title="Bullet list style">
        <div className="settings-option-grid">
          {Object.entries(BULLET_STYLE_DEFS).map(([id, def]) => (
            <button
              key={id}
              type="button"
              className={`settings-option-card${noteBulletStyle === id ? ' is-selected' : ''}`}
              onClick={() => setNoteBulletStyle(id)}
            >
              <span className="settings-option-card-title">{def.label}</span>
              <span className="settings-option-card-desc">{def.symbols.slice(0, 3).join('  ')}</span>
            </button>
          ))}
        </div>
      </ListSection>

      <ListSection title="Editor behaviour">
        <Row title="Default editor mode" subtitle="Starting view when opening a note" right={
          <Segmented value={defaultNoteEditorMode} options={[['edit', 'Edit'], ['view', 'View']]} onChange={(v) => setDefaultNoteEditorMode(v as 'edit' | 'view')} />
        } />
        <Row title="Confirm before deleting notes" subtitle="Show a prompt when deleting a note that has content" right={<Toggle checked={confirmNoteDelete} onChange={setConfirmNoteDelete} label="Confirm before deleting notes" />} />
        <Row title="Default status for new notes" subtitle={defaultNoteStatus === 'none' ? 'No status' : NOTE_STATUSES.find((s) => s.id === defaultNoteStatus)?.label ?? defaultNoteStatus} chevron onClick={() => nav.push('settings-note-status', (
          <Page title="Default status" onBack={nav.pop}>
            <ListSection>
              <Row title="No status" right={defaultNoteStatus === 'none' ? '✓' : undefined} onClick={() => { saveDefaultNoteStatus('none'); nav.pop() }} />
              {NOTE_STATUSES.map((s) => (
                <Row key={s.id} title={s.label} right={defaultNoteStatus === s.id ? '✓' : undefined} onClick={() => { saveDefaultNoteStatus(s.id); nav.pop() }} />
              ))}
            </ListSection>
          </Page>
        ))} />
      </ListSection>

      <ListSection title="Daily notes">
        <Row title="Continuous daily notes scroll" subtitle="Scroll through consecutive days as a journal in the Daily filter" right={<Toggle checked={continuousDailyScroll} onChange={setContinuousDailyScroll} label="Continuous daily notes scroll" />} />
      </ListSection>

      <ListSection title="Print & export defaults">
        <div className="mobile-embedded-section"><PrintExportSection /></div>
        <p className="settings-field-hint">The "Choose folder" button for a default download location needs a folder picker that isn't available on iPhone — type a path manually, or leave it blank to be asked each time exports save to Files.</p>
      </ListSection>
    </Page>
  )
}
