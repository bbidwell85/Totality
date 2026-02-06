import { Component, ErrorInfo, ReactNode } from 'react'
import { AlertTriangle, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react'

interface Props {
  children: ReactNode
  /** Section name for logging and display */
  section: string
  /** Custom fallback UI - if not provided, uses default inline error */
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode)
  /** Callback when error occurs */
  onError?: (error: Error, errorInfo: ErrorInfo) => void
  /** Show detailed error info (default: false in production, true in dev) */
  showDetails?: boolean
  /** Allow retry/reset (default: true) */
  allowRetry?: boolean
  /** Compact mode for smaller sections (default: false) */
  compact?: boolean
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
  showDetails: boolean
}

/**
 * SectionErrorBoundary - Granular error boundary for component sections
 *
 * Features:
 * - Configurable fallback UI
 * - Section-specific error messages
 * - Retry/reset capability
 * - Error logging
 * - Compact mode for smaller sections
 *
 * Usage:
 * ```tsx
 * <SectionErrorBoundary section="Media Browser">
 *   <MediaBrowser />
 * </SectionErrorBoundary>
 * ```
 */
export class SectionErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
    }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[SectionErrorBoundary:${this.props.section}]`, error, errorInfo)
    this.setState({ errorInfo })

    // Call optional error callback
    this.props.onError?.(error, errorInfo)
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
    })
  }

  toggleDetails = () => {
    this.setState(prev => ({ showDetails: !prev.showDetails }))
  }

  render() {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        if (typeof this.props.fallback === 'function') {
          return this.props.fallback(this.state.error!, this.handleReset)
        }
        return this.props.fallback
      }

      const { compact = false, allowRetry = true } = this.props
      const isDev = process.env.NODE_ENV === 'development'
      const showDetails = this.props.showDetails ?? isDev

      // Compact inline error
      if (compact) {
        return (
          <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm">
            <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0" />
            <span className="text-destructive">
              {this.props.section} failed to load
            </span>
            {allowRetry && (
              <button
                onClick={this.handleReset}
                className="ml-auto text-destructive hover:text-destructive/80 underline"
              >
                Retry
              </button>
            )}
          </div>
        )
      }

      // Full error display
      return (
        <div className="flex flex-col items-center justify-center p-6 bg-muted/50 border border-border rounded-lg">
          <AlertTriangle className="w-12 h-12 text-destructive mb-4" />

          <h3 className="text-lg font-semibold text-foreground mb-2">
            {this.props.section} Error
          </h3>

          <p className="text-muted-foreground text-center mb-4 max-w-md">
            Something went wrong while loading this section.
            {allowRetry && ' You can try again or reload the app.'}
          </p>

          <div className="flex gap-3 mb-4">
            {allowRetry && (
              <button
                onClick={this.handleReset}
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Try Again
              </button>
            )}
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-muted text-foreground rounded-md hover:bg-muted/80 transition-colors"
            >
              Reload App
            </button>
          </div>

          {showDetails && this.state.error && (
            <div className="w-full max-w-2xl">
              <button
                onClick={this.toggleDetails}
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2"
              >
                {this.state.showDetails ? (
                  <>
                    <ChevronUp className="w-4 h-4" />
                    Hide Details
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-4 h-4" />
                    Show Details
                  </>
                )}
              </button>

              {this.state.showDetails && (
                <div className="space-y-2">
                  <div className="bg-background rounded p-3 overflow-auto max-h-32 border border-border">
                    <pre className="text-xs text-destructive whitespace-pre-wrap">
                      {this.state.error.toString()}
                    </pre>
                  </div>
                  {this.state.errorInfo?.componentStack && (
                    <div className="bg-background rounded p-3 overflow-auto max-h-48 border border-border">
                      <pre className="text-xs text-muted-foreground whitespace-pre-wrap">
                        {this.state.errorInfo.componentStack}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )
    }

    return this.props.children
  }
}

/**
 * Higher-order component for adding error boundary to a component
 */
export function withErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  section: string,
  options?: Omit<Props, 'children' | 'section'>
) {
  return function WithErrorBoundary(props: P) {
    return (
      <SectionErrorBoundary section={section} {...options}>
        <WrappedComponent {...props} />
      </SectionErrorBoundary>
    )
  }
}
