import type React from 'react'
import { Component } from 'react'

interface Props {
  children: React.ReactNode
  fallback?: (error: Error, retry: () => void) => React.ReactElement
  label?: string
}

interface State {
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error(`[ErrorBoundary:${this.props.label ?? 'unknown'}]`, error, info.componentStack)
    try {
      // Log error to console only - pushRecent signature doesn't match
    } catch {
      // ignore
    }
  }

  retry = (): void => {
    this.setState({ error: null })
  }

  render(): React.ReactNode {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.retry)
      }
      return (
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
          <p className="font-semibold mb-2">This section could not be rendered</p>
          <p className="text-xs text-muted-dark mb-3">{this.state.error.message}</p>
          <button
            type="button"
            className="px-3 py-1 bg-red-500/20 border border-red-500/30 rounded text-xs hover:bg-red-500/30"
            onClick={this.retry}
          >
            Retry
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
