import { createContext, useContext } from 'react'

/**
 * Which resting material a control should use when its `variant` prop is left unset.
 * `Toolbar` provides 'glass' so every IconButton/Button inside a bar is a visible glass
 * capsule at rest (macOS 26/27 toolbars); everywhere else the default is 'ghost'.
 */
export type ControlSurface = 'ghost' | 'glass'
export const ControlSurfaceContext = createContext<ControlSurface>('ghost')
export function useControlSurface(explicit?: ControlSurface): ControlSurface {
  const ctx = useContext(ControlSurfaceContext)
  return explicit ?? ctx
}
