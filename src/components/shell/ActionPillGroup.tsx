import type { ReactNode } from 'react'
import { ControlGroup } from '@/components/ui/ControlGroup'

/**
 * @deprecated Alias kept for one release — use `ControlGroup` from '@/components/ui'.
 * The old implementation forced its children flat with `!important` overrides; ControlGroup
 * provides a context the children read instead (no specificity fights).
 */
export default function ActionPillGroup({ children, className = '', align = 'center' }: { children: ReactNode; className?: string; align?: 'center' | 'stretch' }) {
  return <ControlGroup className={className} align={align}>{children}</ControlGroup>
}
