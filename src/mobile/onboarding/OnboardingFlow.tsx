import React, { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { BookOpen, Palette, Cloud, Check, ChevronRight } from 'lucide-react'
import { useAppStore } from '@/store'
import { TRANSLATIONS } from '@/lib/bibleTexts'
import { Segmented } from '../settings/SettingsControls'
import { haptic } from '../primitives/haptics'
import './onboarding.css'

/**
 * First-launch flow on the phone (R086) — the phone's counterpart of the desktop walkthrough
 * (`src/components/shell/Onboarding.tsx`): four short pages (welcome → default text → theme →
 * iCloud sync opt-in) instead of the desktop's ten feature pages, because the shell itself is
 * the tour (bottom navigation, verse hints). It shares the desktop's gate: the `onboardingCompleted`
 * setting + store `onboardingOpen` / `completeOnboarding()`, so About → "Replay getting started
 * walkthrough" re-opens it here too, and a Mac that already completed onboarding (setting
 * synced through iCloud is NOT the case — settings are per device) does not suppress it.
 */
const PAGES = ['welcome', 'text', 'theme', 'icloud'] as const
type PageId = typeof PAGES[number]

export function useOnboardingGate(): boolean {
  const open = useAppStore((s) => s.onboardingOpen)
  useEffect(() => {
    window.settings?.get('onboardingCompleted').then((completed) => {
      if (completed !== true) useAppStore.getState().openOnboarding()
    }).catch(() => {})
  }, [])
  return open
}

export function OnboardingFlow() {
  const [index, setIndex] = useState(0)
  const page: PageId = PAGES[index]
  const complete = useAppStore((s) => s.completeOnboarding)
  const translation = useAppStore((s) => s.defaultBibleTranslation)
  const setTranslation = useAppStore((s) => s.setDefaultBibleTranslation)
  const theme = useAppStore((s) => s.theme)
  const setTheme = useAppStore((s) => s.setTheme)
  const [cloudBusy, setCloudBusy] = useState(false)
  const [cloudMessage, setCloudMessage] = useState<string | null>(null)
  const [cloudOn, setCloudOn] = useState<boolean | null>(null)
  useEffect(() => { window.sync?.getConfig().then((c) => setCloudOn(!!c?.enabled)).catch(() => setCloudOn(false)) }, [])

  const next = () => { void haptic.selection(); if (index < PAGES.length - 1) setIndex(index + 1); else complete() }
  const back = () => { void haptic.selection(); setIndex(Math.max(0, index - 1)) }
  const enableCloud = async () => {
    if (!window.sync) return
    setCloudBusy(true); setCloudMessage(null)
    try {
      const r = await window.sync.enable()
      if (r.ok) { setCloudOn(true); void haptic.success() } else setCloudMessage(r.reason ?? 'Could not enable iCloud sync.')
    } finally { setCloudBusy(false) }
  }

  return (
    <div className="mobile-onboarding" role="dialog" aria-modal="true" aria-label="Welcome to Berean">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={page} className="mobile-onboarding-page" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} transition={{ type: 'spring', stiffness: 380, damping: 34 }}>
          {page === 'welcome' && (
            <>
              <div className="mobile-onboarding-art"><BookOpen size={56} aria-hidden /></div>
              <h1>Welcome to Berean</h1>
              <p>Read the KJV with Apocrypha, Brenton's Septuagint, 1 Enoch, Jubilees and more — all offline — with Strong's numbers, cross references, notes, highlights and verse tags.</p>
              <p className="mobile-onboarding-hint">Tap a verse for its study view and actions; press and hold to select words. Swipe, or tap the far left or right edge, to change chapters. At the bottom: your tabs, + to open or search, and ⌃ for everything you can do here.</p>
            </>
          )}
          {page === 'text' && (
            <>
              <div className="mobile-onboarding-art"><BookOpen size={56} aria-hidden /></div>
              <h1>Default text</h1>
              <p>Which text should new Scripture tabs open in? You can switch per tab any time.</p>
              <div className="mobile-onboarding-list">
                {TRANSLATIONS.map((t) => (
                  <button key={t.id} type="button" className={`mobile-onboarding-option${translation === t.id ? ' is-on' : ''}`} onClick={() => { setTranslation(t.id); void haptic.selection() }}>
                    <span><strong>{t.label}</strong>{t.description ? <small>{t.description}</small> : null}</span>
                    {translation === t.id && <Check size={18} aria-hidden />}
                  </button>
                ))}
              </div>
            </>
          )}
          {page === 'theme' && (
            <>
              <div className="mobile-onboarding-art"><Palette size={56} aria-hidden /></div>
              <h1>Appearance</h1>
              <p>Follow the system, or pick light or dark. Color presets, fonts and text size live in Settings.</p>
              <Segmented value={theme} options={[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]} onChange={(v) => setTheme(v as 'system' | 'light' | 'dark')} />
            </>
          )}
          {page === 'icloud' && (
            <>
              <div className="mobile-onboarding-art"><Cloud size={56} aria-hidden /></div>
              <h1>iCloud sync</h1>
              <p>Keep notes, highlights, verse tags, tabs, sessions and workspaces the same on every device signed into your iCloud account. Bible texts never sync — they ship with the app. Everything works offline; changes upload when iCloud can.</p>
              {cloudOn ? (
                <p className="mobile-onboarding-ok"><Check size={16} aria-hidden /> iCloud sync is on.</p>
              ) : (
                <button type="button" className="mobile-button is-primary" disabled={cloudBusy || cloudOn === null} onClick={() => { void enableCloud() }}>{cloudBusy ? 'Turning on…' : 'Turn on iCloud sync'}</button>
              )}
              {cloudMessage && <p className="mobile-onboarding-error">{cloudMessage}</p>}
              <p className="mobile-onboarding-hint">You can turn this on or off later in Settings → iCloud.</p>
            </>
          )}
        </motion.div>
      </AnimatePresence>
      <div className="mobile-onboarding-footer">
        <div className="mobile-onboarding-dots" aria-hidden>{PAGES.map((p, i) => <span key={p} className={i === index ? 'is-on' : ''} />)}</div>
        <div className="mobile-onboarding-buttons">
          {index > 0 ? <button type="button" className="mobile-button" onClick={back}>Back</button> : <button type="button" className="mobile-button" onClick={() => complete()}>Skip</button>}
          <button type="button" className="mobile-button is-primary" onClick={next}>{index === PAGES.length - 1 ? 'Start studying' : <>Next <ChevronRight size={16} aria-hidden /></>}</button>
        </div>
      </div>
    </div>
  )
}
