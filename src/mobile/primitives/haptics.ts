import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics'

/** Thin wrappers — every call is best-effort (no-ops in the web preview / simulator without a Taptic engine). */
export const haptic = {
  light: () => Haptics.impact({ style: ImpactStyle.Light }).catch(() => {}),
  medium: () => Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {}),
  heavy: () => Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => {}),
  selection: () => Haptics.selectionChanged().catch(() => {}),
  success: () => Haptics.notification({ type: NotificationType.Success }).catch(() => {}),
  warning: () => Haptics.notification({ type: NotificationType.Warning }).catch(() => {}),
}
