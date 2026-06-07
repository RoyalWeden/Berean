import { Component, type ReactNode } from 'react'

interface Props { children: ReactNode; label?: string }
interface State { error: Error | null }

function saveCrashInfo(error: Error, label?: string) {
  try {
    localStorage.setItem('berean-crash', JSON.stringify({
      message: error.message,
      stack: error.stack ?? '',
      label: label ?? 'Unknown component',
      timestamp: Date.now(),
    }))
  } catch { /* ignore */ }
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    saveCrashInfo(error, this.props.label)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-start gap-2 p-4 text-xs">
          <p className="font-semibold text-red-400">{this.props.label ?? 'Component error'}</p>
          <pre className="text-[rgb(var(--color-text-muted))] whitespace-pre-wrap break-all leading-relaxed max-h-48 overflow-y-auto">
            {this.state.error.message}
          </pre>
          <div className="flex gap-2 mt-1">
            <button
              onClick={() => this.setState({ error: null })}
              className="text-[10px] px-2 py-0.5 rounded bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer"
            >
              Retry
            </button>
            <button
              onClick={() => window.location.reload()}
              className="text-[10px] px-2 py-0.5 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 cursor-pointer"
            >
              Reload app
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
