/**
 * Shared on/off toggle switch (track + knob) — macOS-proportioned (26×16). One component
 * backs every boolean setting so the visual and click target stay identical everywhere.
 */
export default function Switch({
  checked, onCheckedChange, disabled = false, checkedColorClass = 'bg-accent', label,
}: {
  checked: boolean
  onCheckedChange: () => void
  disabled?: boolean
  /** Override the "on" track color — e.g. `bg-warning` for a risk-flagged setting like beta updates. */
  checkedColorClass?: string
  /** Accessible name when no visible label is associated. */
  label?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onCheckedChange}
      className={`focus-ring no-drag relative flex-shrink-0 w-[26px] h-4 rounded-control transition-colors duration-base ease-mac ${disabled ? 'opacity-40 cursor-default' : 'cursor-pointer'} ${
        checked ? checkedColorClass : 'bg-surface-4 hover:bg-surface-pressed'
      }`}
    >
      <span className={`absolute top-[2px] left-[2px] w-3 h-3 rounded-control bg-white shadow-[0_1px_2px_rgba(0,0,0,0.35)] transition-transform duration-base ease-mac ${checked ? 'translate-x-[10px]' : ''}`} />
    </button>
  )
}
