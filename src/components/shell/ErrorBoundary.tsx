import { Component, type ReactNode } from 'react'
import { Button } from '@/components/ui'

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
          <p className="font-semibold text-destructive">{this.props.label ?? 'Component error'}</p>
          <pre className="text-text-muted whitespace-pre-wrap break-all leading-relaxed max-h-48 overflow-y-auto">
            {this.state.error.message}
          </pre>
          <div className="flex gap-2 mt-1">
            <Button size="sm" onClick={() => this.setState({ error: null })}>Retry</Button>
            <Button size="sm" variant="destructive" onClick={() => window.location.reload()}>Reload app</Button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
