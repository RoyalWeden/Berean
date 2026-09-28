import type { SettingsTabState } from '@/types'
import type { NavStep } from '../search/searchHistory'

/** Settings subsections that are history steps in a Settings tab (SEP25 per-tab history). */
export const SETTINGS_ROUTE_TITLES = {
  'preset': 'Color preset',
  'translation': 'Default translation',
  'hermas': 'Hermas translation',
  'font-scripture': 'Scripture font',
  'font-notes': 'Notes font',
  'font-ui': 'UI font',
  'word-replacer': 'Word replacer',
  'notes': 'Notes',
  'audio': 'Read Aloud',
  'youtube': 'YouTube',
  'data': 'Data',
  'icloud': 'iCloud',
  'experimental': 'Experimental',
} as const
export type SettingsRoute = keyof typeof SETTINGS_ROUTE_TITLES

export function isSettingsRoute(v: unknown): v is SettingsRoute {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(SETTINGS_ROUTE_TITLES, v)
}

/** The open subsection of a Settings tab (unknown / missing → the root). */
export function settingsRouteOf(st: Partial<SettingsTabState> | undefined): SettingsRoute | null {
  return isSettingsRoute(st?.settingsRoute) ? st!.settingsRoute as SettingsRoute : null
}

/** The history step for a route (null = the Settings root). */
export function settingsStep(route: SettingsRoute | null): NavStep {
  return { type: 'settings', title: route ? `Settings · ${SETTINGS_ROUTE_TITLES[route]}` : 'Settings', state: { settingsRoute: route } }
}
