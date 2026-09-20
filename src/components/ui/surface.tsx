import { createContext, useContext } from 'react'

/**
 * Which resting material a control should use when its `variant` prop is left unset.
 * `Toolbar` provides 'glass' so every IconButton/Button inside a bar is a visible glass
 * control at rest (macOS 26/27 toolbars); everywhere else the default is 'ghost'.
 */
export type ControlSurface = 'ghost' | 'glass'
export const ControlSurfaceContext = createContext<ControlSurface>('ghost')
export function useControlSurface(explicit?: ControlSurface): ControlSurface {
  const ctx = useContext(ControlSurfaceContext)
  return explicit ?? ctx
}

/**
 * Control geometry (§17/§53): NOT everything is a capsule.
 *   'round'  — capsule; standalone ghost icon buttons (row actions, rail, inline).
 *   'square' — rounded square (--radius-compact); glass toolbar icon buttons and anything
 *              inside a ControlGroup / Toolbar, so grouped controls read as one Mac control.
 * Capsules remain the shape of text buttons, search fields, chips and segmented controls.
 */
export type ControlShape = 'round' | 'square'
export const ControlShapeContext = createContext<ControlShape | undefined>(undefined)

/**
 * True inside a `ControlGroup`: the group owns the material, border, radius and dividers, so
 * each child renders FLAT (no own background/border/shadow/radius, no press scale) and only
 * paints its hover/pressed/selected fill. Children read this and branch their own classes —
 * no `!important` overrides from the parent (the old ActionPillGroup footgun).
 */
export const ControlGroupContext = createContext(false)
export function useInControlGroup(): boolean { return useContext(ControlGroupContext) }
