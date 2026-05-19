// Phase 1: plain textarea placeholder
// Phase 3 will replace this with CodeMirror 6

interface NoteEditorProps {
  content: string
  onChange: (content: string) => void
  placeholder?: string
}

export default function NoteEditor({ content, onChange, placeholder }: NoteEditorProps) {
  return (
    <textarea
      value={content}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder ?? 'Start writing...'}
      className="
        w-full h-full bg-transparent text-[rgb(var(--color-text-primary))]
        placeholder:text-[rgb(var(--color-text-muted))] resize-none outline-none
        font-mono text-sm leading-relaxed p-4
      "
      spellCheck
    />
  )
}
