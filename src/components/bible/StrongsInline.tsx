interface StrongsInlineProps {
  word: string
  strongsNum: string | null
}

export default function StrongsInline({ word, strongsNum }: StrongsInlineProps) {
  return (
    <span className="inline-flex flex-col items-start mr-1">
      <span>{word}</span>
      {strongsNum && (
        <span className="text-[10px] text-[rgb(var(--color-accent))] font-mono opacity-70 leading-none">
          {strongsNum}
        </span>
      )}
    </span>
  )
}
