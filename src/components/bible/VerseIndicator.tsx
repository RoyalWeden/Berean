interface VerseIndicatorProps {
  hasNote?: boolean
  hasHighlight?: boolean
  count?: number
  color?: string
}

export default function VerseIndicator({ hasNote, hasHighlight, count = 1, color = 'blue' }: VerseIndicatorProps) {
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-400',
    red: 'bg-red-400',
    green: 'bg-green-400',
    yellow: 'bg-yellow-400',
    purple: 'bg-purple-400'
  }

  const dotColor = hasNote ? colorMap[color] ?? colorMap.blue : 'bg-[rgb(var(--color-accent))]'

  if (count > 1) {
    return (
      <span className={`flex-shrink-0 text-[10px] font-medium px-1 py-0.5 rounded-full ${dotColor} text-white leading-none mt-1`}>
        {count}
      </span>
    )
  }

  return (
    <span
      className={`flex-shrink-0 w-1.5 h-1.5 rounded-full ${dotColor} mt-2`}
      title={hasNote ? 'Has note' : 'Has highlight'}
    />
  )
}
