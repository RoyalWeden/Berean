/**
 * Shared on/off toggle switch (track + knob) — was previously hand-rolled
 * per call site with slightly different sizing each time (PresenterControls'
 * own local Switch, three copy-pasted instances in SettingsModal). One
 * component now backs all of them so the visual and click target stay
 * identical everywhere a boolean setting is toggled.
 */
export default function Switch({
  checked, onCheckedChange, disabled = false, checkedColorClass = 'bg-[rgb(var(--color-accent))]',
}: { checked: boolean; onCheckedChange: () => void; disabled?: boolean; /** Override the "on" track color — e.g. amber for a risk-flagged setting like beta updates. */ checkedColorClass?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onCheckedChange}
      className={`relative flex-shrink-0 w-10 h-5 rounded-full transition-colors ${disabled ? 'opacity-40 cursor-default' : 'cursor-pointer'} ${
        checked ? checkedColorClass : 'bg-[rgb(var(--color-surface-4))]'
      }`}
    >
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
    </button>
  )
}
