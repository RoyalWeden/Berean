import { SegmentedControl, type SegmentOption } from '@/components/ui/SegmentedControl'

export type { SegmentOption }

/** @deprecated Use `SegmentedControl` from '@/components/ui'. Thin wrapper kept for migration. */
export default function HeaderSegmentedToggle<T extends string>({
  value, options, onChange, title,
}: { value: T; options: SegmentOption<T>[]; onChange: (value: T) => void; title?: string }) {
  return <SegmentedControl value={value} options={options} onChange={onChange} size="sm" aria-label={title} />
}
