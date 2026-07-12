interface VerseIndicatorProps {
  count?: number
  onClick?: () => void
}

export default function VerseIndicator({ count = 1, onClick }: VerseIndicatorProps) {
  return (
    <button
      onClick={onClick}
      className="
        flex-shrink-0 self-start mt-1.5 inline-flex items-center gap-0.5
        text-[10px] font-semibold leading-none rounded-full px-1.5 py-0.5
        bg-[rgb(var(--color-accent))/20] text-[rgb(var(--color-accent))] hover:bg-[rgb(var(--color-accent))/40]
        cursor-pointer select-none
      "
      title={`${count} note${count !== 1 ? 's' : ''} — click to view`}
    >
      <span className="text-sm font-black leading-none">:</span>
      {count > 1 && <span className="ml-px">{count}</span>}
    </button>
  )
}
