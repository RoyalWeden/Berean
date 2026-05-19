// Phase 4 stub — wired into FloatingSearch in Phase 2+
interface SearchBarProps {
  query: string
  onChange: (q: string) => void
  onSubmit: (q: string) => void
}

export default function SearchBar({ query, onChange, onSubmit }: SearchBarProps) {
  return (
    <input
      type="text"
      value={query}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && onSubmit(query)}
      placeholder="Search..."
      className="w-full bg-transparent outline-none text-sm text-[rgb(var(--color-text-primary))] placeholder:text-[rgb(var(--color-text-muted))]"
    />
  )
}
