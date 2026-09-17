/**
 * Shared on/off toggle switch (track + knob) — macOS-proportioned (26×16). One component
 * backs every boolean setting so the visual and click target stay identical everywhere.
 * States: off (field material) → hover (lift) → on (accent) → on-hover (raised accent) →
 * pressed (knob squashes) → focus ring → disabled.
 */
export default function Switch({
  checked, onCheckedChange, disabled = false, checkedColorClass = 'bg-accent hover:bg-accent-raised active:bg-accent-pressed', label,
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
      className={`focus-ring no-drag group/sw relative flex-shrink-0 w-[26px] h-4 rounded-control transition-colors duration-base ease-mac ${disabled ? 'opacity-40 cursor-default' : 'cursor-pointer'} ${
        checked ? checkedColorClass : 'control-field bg-field hover:bg-lift-3 active:bg-lift-4'
      }`}
    >
      <span className={`absolute top-[2px] left-[2px] w-3 h-3 rounded-control bg-white shadow-[0_1px_2px_rgb(0_0_0/0.35),0_0_0_0.5px_rgb(0_0_0/0.08)] transition-[transform,width] duration-base ease-mac-out group-active/sw:w-[14px] ${checked ? 'translate-x-[10px] group-active/sw:translate-x-[8px]' : ''}`} />
    </button>
  )
}
