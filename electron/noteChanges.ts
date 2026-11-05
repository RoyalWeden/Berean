// For writes that bypass the services (the vault importing an external edit). Without the event
// sync doesn't see the change, and the next remote edit overwrites it with no conflict copy.
let notify: ((id: string) => void) | null = null

export function onExternalNoteChange(fn: (id: string) => void): void {
  notify = fn
}

export function notifyNoteChanged(id: string): void {
  notify?.(id)
}
