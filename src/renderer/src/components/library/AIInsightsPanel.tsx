import { useState, useEffect, useRef, useCallback } from 'react'
import { Bot, X, Sparkles, BarChart3, ArrowUpCircle, Library, Star, Loader2, AlertCircle, Clock } from 'lucide-react'

type ReportType = 'quality' | 'upgrades' | 'completeness' | 'wishlist'

interface AIInsightsPanelProps {
  isOpen: boolean
  onClose: () => void
  onOpenSettings?: () => void
  initialReport?: ReportType
}

const REPORT_OPTIONS: { type: ReportType; label: string; description: string; icon: typeof BarChart3 }[] = [
  { type: 'quality', label: 'Quality Report', description: 'Overall library quality health assessment', icon: BarChart3 },
  { type: 'upgrades', label: 'Upgrade Priorities', description: 'Ranked list of items most worth upgrading', icon: ArrowUpCircle },
  { type: 'completeness', label: 'Completeness Insights', description: 'Collection gaps and what to acquire next', icon: Library },
  { type: 'wishlist', label: 'Wishlist Advice', description: 'Shopping strategy for your wishlist items', icon: Star },
]

export function AIInsightsPanel({ isOpen, onClose, onOpenSettings, initialReport }: AIInsightsPanelProps) {
  const [isConfigured, setIsConfigured] = useState<boolean | null>(null)
  const [selectedReport, setSelectedReport] = useState<ReportType | null>(null)
  const [reportContent, setReportContent] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rateLimited, setRateLimited] = useState<{ limited: boolean; retryAfterSeconds: number }>({ limited: false, retryAfterSeconds: 0 })
  const contentRef = useRef<HTMLDivElement>(null)
  const requestIdRef = useRef(0)
  const activeRequestId = useRef<string | null>(null)

  // Check if AI is configured and auto-start if initialReport specified
  useEffect(() => {
    if (isOpen) {
      window.electronAPI.aiIsConfigured().then((configured) => {
        setIsConfigured(configured)
        if (configured && initialReport && !selectedReport && !isGenerating) {
          generateReport(initialReport)
        }
      }).catch(() => setIsConfigured(false))
    } else {
      // Reset state when panel closes
      setSelectedReport(null)
      setReportContent('')
      setError(null)
    }
  }, [isOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for settings changes
  useEffect(() => {
    const cleanup = window.electronAPI.onSettingsChanged((data) => {
      if (data.key === 'gemini_api_key' || data.key === 'ai_enabled') {
        window.electronAPI.aiIsConfigured().then(setIsConfigured).catch(() => setIsConfigured(false))
      }
    })
    return cleanup
  }, [])

  // Listen for streaming deltas
  useEffect(() => {
    const cleanupDelta = window.electronAPI.onAiAnalysisStreamDelta((data) => {
      if (data.requestId === activeRequestId.current) {
        setReportContent((prev) => prev + data.delta)
      }
    })
    const cleanupComplete = window.electronAPI.onAiAnalysisStreamComplete((data) => {
      if (data.requestId === activeRequestId.current) {
        setIsGenerating(false)
        activeRequestId.current = null
      }
    })
    return () => {
      cleanupDelta()
      cleanupComplete()
    }
  }, [])

  // Auto-scroll while streaming
  useEffect(() => {
    if (isGenerating && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight
    }
  }, [reportContent, isGenerating])

  // Rate limit countdown
  useEffect(() => {
    if (!rateLimited.limited) return
    const interval = setInterval(() => {
      setRateLimited((prev) => {
        const remaining = prev.retryAfterSeconds - 1
        if (remaining <= 0) return { limited: false, retryAfterSeconds: 0 }
        return { limited: true, retryAfterSeconds: remaining }
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [rateLimited.limited])

  const generateReport = useCallback(async (type: ReportType) => {
    setSelectedReport(type)
    setReportContent('')
    setError(null)
    setIsGenerating(true)

    const requestId = `analysis-${++requestIdRef.current}`
    activeRequestId.current = requestId

    try {
      const apiMethods: Record<ReportType, (params: { requestId: string }) => Promise<unknown>> = {
        quality: window.electronAPI.aiQualityReport,
        upgrades: window.electronAPI.aiUpgradePriorities,
        completeness: window.electronAPI.aiCompletenessInsights,
        wishlist: window.electronAPI.aiWishlistAdvice,
      }
      const apiMethod = apiMethods[type]

      await apiMethod({ requestId })
    } catch (err: unknown) {
      const errorObj = err as { error?: string; rateLimited?: boolean; retryAfterSeconds?: number }
      if (errorObj.rateLimited && errorObj.retryAfterSeconds) {
        setRateLimited({ limited: true, retryAfterSeconds: errorObj.retryAfterSeconds })
        setError(`Rate limit reached. Try again in ${errorObj.retryAfterSeconds}s`)
      } else {
        setError(errorObj.error || 'Failed to generate report')
      }
      setIsGenerating(false)
      activeRequestId.current = null
    }
  }, [])

  const handleBack = () => {
    setSelectedReport(null)
    setReportContent('')
    setError(null)
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-150 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-2xl max-h-[80vh] mx-4 bg-sidebar-gradient rounded-xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/30">
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-5 h-5 text-primary" />
            <h2 className="text-base font-semibold">AI Insights</h2>
            {selectedReport && (
              <span className="text-xs text-muted-foreground">
                — {REPORT_OPTIONS.find((r) => r.type === selectedReport)?.label}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Not configured */}
        {isConfigured === false && (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <Bot className="w-12 h-12 text-muted-foreground/30 mb-4" />
            <p className="text-sm font-medium mb-1">Gemini AI not configured</p>
            <p className="text-xs text-muted-foreground mb-4">
              Get a free Gemini API key from Google AI Studio in Settings &gt; Services.
            </p>
            {onOpenSettings && (
              <button
                onClick={onOpenSettings}
                className="flex items-center gap-2 px-4 py-2 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
              >
                Open Settings
              </button>
            )}
          </div>
        )}

        {/* Report selection */}
        {isConfigured !== false && !selectedReport && (
          <div className="flex-1 p-5 space-y-3">
            <p className="text-xs text-muted-foreground mb-1">
              Generate AI-powered reports about your media library. Select a report type below.
            </p>
            <p className="text-[10px] text-muted-foreground/50 mb-4">
              Reports send library data to Google Gemini using your API key.
            </p>
            {REPORT_OPTIONS.map((option) => {
              const Icon = option.icon
              return (
                <button
                  key={option.type}
                  onClick={() => generateReport(option.type)}
                  disabled={rateLimited.limited}
                  className="w-full flex items-center gap-4 p-4 bg-muted/30 hover:bg-muted/50 rounded-xl transition-colors text-left disabled:opacity-50"
                >
                  <div className="shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Icon className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{option.label}</div>
                    <div className="text-xs text-muted-foreground">{option.description}</div>
                  </div>
                </button>
              )
            })}

            {rateLimited.limited && (
              <div className="flex items-center gap-2 px-3 py-2 text-xs bg-amber-500/10 text-amber-400 rounded-lg">
                <Clock className="w-3.5 h-3.5 shrink-0" />
                <span>Available again in {rateLimited.retryAfterSeconds}s</span>
              </div>
            )}
          </div>
        )}

        {/* Report content */}
        {isConfigured !== false && selectedReport && (
          <>
            <div ref={contentRef} className="flex-1 overflow-y-auto p-5">
              {isGenerating && !reportContent && (
                <div className="flex items-center justify-center gap-3 py-12 text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span className="text-sm">Analyzing your library...</span>
                </div>
              )}

              {reportContent && (
                <div className="prose prose-sm prose-invert max-w-none wrap-break-word whitespace-pre-wrap [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                  <SimpleMarkdown text={reportContent} />
                </div>
              )}

              {isGenerating && reportContent && (
                <div className="flex items-center gap-2 mt-3 text-muted-foreground">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span className="text-xs">Generating...</span>
                </div>
              )}

              {error && (
                <div className="flex items-center gap-2 px-3 py-2 mt-3 text-xs bg-destructive/10 text-destructive rounded-lg">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-border/30 flex items-center justify-between">
              <button
                onClick={handleBack}
                disabled={isGenerating}
                className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground rounded-md hover:bg-muted/50 transition-colors disabled:opacity-50"
              >
                Back to reports
              </button>
              {!isGenerating && reportContent && (
                <button
                  onClick={() => generateReport(selectedReport)}
                  disabled={rateLimited.limited}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  <Sparkles className="w-3 h-3" />
                  Regenerate
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Simple markdown renderer (same approach as ChatMessage).
 */
function SimpleMarkdown({ text }: { text: string }) {
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []
  let inCodeBlock = false
  let codeBlockContent: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.startsWith('```')) {
      if (inCodeBlock) {
        elements.push(
          <pre key={`code-${i}`} className="bg-background/50 rounded p-2 text-xs overflow-x-auto my-1">
            <code>{codeBlockContent.join('\n')}</code>
          </pre>,
        )
        codeBlockContent = []
        inCodeBlock = false
      } else {
        inCodeBlock = true
      }
      continue
    }

    if (inCodeBlock) {
      codeBlockContent.push(line)
      continue
    }

    if (line.trim() === '') {
      elements.push(<br key={`br-${i}`} />)
      continue
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)/)
    if (headingMatch) {
      const level = headingMatch[1].length
      const content = headingMatch[2]
      const Tag = `h${level + 2}` as 'h3' | 'h4' | 'h5'
      elements.push(
        <Tag key={`h-${i}`} className="font-semibold mt-2 mb-1">
          <InlineMarkdown text={content} />
        </Tag>,
      )
      continue
    }

    const listMatch = line.match(/^(\s*)([-*]|\d+\.)\s+(.+)/)
    if (listMatch) {
      const content = listMatch[3]
      elements.push(
        <div key={`li-${i}`} className="flex gap-1.5 ml-2">
          <span className="text-muted-foreground shrink-0">•</span>
          <span><InlineMarkdown text={content} /></span>
        </div>,
      )
      continue
    }

    elements.push(
      <p key={`p-${i}`} className="my-0.5">
        <InlineMarkdown text={line} />
      </p>,
    )
  }

  if (inCodeBlock && codeBlockContent.length > 0) {
    elements.push(
      <pre key="code-unclosed" className="bg-background/50 rounded p-2 text-xs overflow-x-auto my-1">
        <code>{codeBlockContent.join('\n')}</code>
      </pre>,
    )
  }

  return <>{elements}</>
}

function InlineMarkdown({ text }: { text: string }) {
  const parts: React.ReactNode[] = []
  let remaining = text
  let key = 0

  while (remaining.length > 0) {
    const codeMatch = remaining.match(/^`([^`]+)`/)
    if (codeMatch) {
      parts.push(
        <code key={key++} className="bg-background/50 px-1 py-0.5 rounded text-xs">
          {codeMatch[1]}
        </code>,
      )
      remaining = remaining.slice(codeMatch[0].length)
      continue
    }

    const boldMatch = remaining.match(/^\*\*(.+?)\*\*/)
    if (boldMatch) {
      parts.push(<strong key={key++}>{boldMatch[1]}</strong>)
      remaining = remaining.slice(boldMatch[0].length)
      continue
    }

    const italicMatch = remaining.match(/^\*(.+?)\*/)
    if (italicMatch) {
      parts.push(<em key={key++}>{italicMatch[1]}</em>)
      remaining = remaining.slice(italicMatch[0].length)
      continue
    }

    const nextSpecial = remaining.search(/[`*]/)
    if (nextSpecial === -1) {
      parts.push(remaining)
      break
    } else if (nextSpecial === 0) {
      parts.push(remaining[0])
      remaining = remaining.slice(1)
    } else {
      parts.push(remaining.slice(0, nextSpecial))
      remaining = remaining.slice(nextSpecial)
    }
  }

  return <>{parts}</>
}
