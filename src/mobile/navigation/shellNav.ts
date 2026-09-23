import { useEffect } from 'react'
import type { MoreRoute } from '../commands/staticCommands'

/**
 * Pages ask the shell to open a More destination (Settings, History, Study trail, …) without
 * importing the shell — the bottom space bar that used to be the way there is gone (TEST-030).
 */
const EVENT = 'berean:openMoreRoute'
export function requestMore(route: MoreRoute): void {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: route }))
}
export function useMoreRouteRequests(open: (route: MoreRoute) => void): void {
  useEffect(() => {
    const h = (e: Event) => open((e as CustomEvent<MoreRoute>).detail)
    window.addEventListener(EVENT, h)
    return () => window.removeEventListener(EVENT, h)
  }, [open])
}
