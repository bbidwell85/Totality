import { useState, useRef, useCallback, useEffect } from 'react'

export interface ActionableItem {
  title: string
  year?: number
  tmdb_id?: string
  media_type: 'movie' | 'tv'
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  toolsUsed?: string[]
  actionableItems?: ActionableItem[]
  isLoading?: boolean
  isRateLimited?: boolean
}

export interface ViewContext {
  currentView: 'dashboard' | 'library'
  libraryTab?: 'movies' | 'tv' | 'music'
  selectedItem?: { title: string; type?: string; id?: number }
  activeSourceId?: string
  activeFilters?: string
}

interface RateLimitState {
  limited: boolean
  retryAfterSeconds: number
  expiresAt?: number
}

export function useChat(viewContext?: ViewContext) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [activeTools, setActiveTools] = useState<string[]>([])
  const [rateLimit, setRateLimit] = useState<RateLimitState>({ limited: false, retryAfterSeconds: 0 })
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)
  const toolsForCurrentRequest = useRef<string[]>([])
  const rateLimitTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Clean up rate limit timer
  useEffect(() => {
    return () => {
      if (rateLimitTimerRef.current) {
        clearInterval(rateLimitTimerRef.current)
      }
    }
  }, [])

  // Listen for tool use events
  useEffect(() => {
    const cleanup = window.electronAPI.onAiToolUse?.((data) => {
      setActiveTools((prev) => [...prev, data.toolName])
      toolsForCurrentRequest.current.push(data.toolName)
    })
    return () => cleanup?.()
  }, [])

  // Listen for chat stream deltas (simulated streaming of final response)
  useEffect(() => {
    const cleanup = window.electronAPI.onAiChatStreamDelta?.((data) => {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.isLoading && m.role === 'assistant') {
            return { ...m, content: m.content + data.delta }
          }
          return m
        }),
      )
    })
    return () => cleanup?.()
  }, [])

  const startRateLimitCountdown = useCallback((seconds: number) => {
    const expiresAt = Date.now() + seconds * 1000
    setRateLimit({ limited: true, retryAfterSeconds: seconds, expiresAt })

    if (rateLimitTimerRef.current) {
      clearInterval(rateLimitTimerRef.current)
    }

    rateLimitTimerRef.current = setInterval(() => {
      const remaining = Math.ceil((expiresAt - Date.now()) / 1000)
      if (remaining <= 0) {
        setRateLimit({ limited: false, retryAfterSeconds: 0 })
        if (rateLimitTimerRef.current) {
          clearInterval(rateLimitTimerRef.current)
          rateLimitTimerRef.current = null
        }
      } else {
        setRateLimit({ limited: true, retryAfterSeconds: remaining, expiresAt })
      }
    }, 1000)
  }, [])

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isLoading) return

    setError(null)
    const requestId = `chat-${++requestIdRef.current}`
    toolsForCurrentRequest.current = []

    // Add user message
    const userMessage: ChatMessage = {
      id: `user-${requestIdRef.current}`,
      role: 'user',
      content: content.trim(),
      timestamp: new Date(),
    }

    // Add placeholder assistant message
    const assistantId = `assistant-${requestIdRef.current}`
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isLoading: true,
    }

    setMessages((prev) => [...prev, userMessage, assistantMessage])
    setIsLoading(true)
    setActiveTools([])

    try {
      // Build conversation history for API (only completed messages, bounded to save tokens)
      const allCompleted = [...messages, userMessage].filter((m) => !m.isLoading)
      const bounded = allCompleted.length > 20 ? allCompleted.slice(-20) : allCompleted
      const history = bounded.map((m) => ({ role: m.role, content: m.content }))

      const result = await window.electronAPI.aiChatMessage({
        messages: history,
        requestId,
        viewContext,
      })

      // Check if result is a rate limit response (returned, not thrown)
      if (result.rateLimited && result.retryAfterSeconds) {
        startRateLimitCountdown(result.retryAfterSeconds)
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: `I've hit the API rate limit for the free tier. Please try again later!`,
                  isLoading: false,
                  isRateLimited: true,
                }
              : m,
          ),
        )
      } else {
        // Update assistant message with response (guard against empty text)
        const responseText = result.text || 'Sorry, I wasn\'t able to generate a response. Please try rephrasing your question.'
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: responseText,
                  isLoading: false,
                  toolsUsed: toolsForCurrentRequest.current.length > 0
                    ? [...new Set(toolsForCurrentRequest.current)]
                    : undefined,
                  actionableItems: result.actionableItems,
                }
              : m,
          ),
        )
      }
    } catch (err: unknown) {
      const errorObj = err as { error?: string }
      setError(errorObj.error || 'Failed to send message')
      // Remove the placeholder assistant message on error
      setMessages((prev) => prev.filter((m) => m.id !== assistantId))
    } finally {
      setIsLoading(false)
      setActiveTools([])
    }
  }, [isLoading, messages, startRateLimitCountdown, viewContext])

  const clearHistory = useCallback(() => {
    setMessages([])
    setError(null)
  }, [])

  return {
    messages,
    isLoading,
    activeTools,
    rateLimit,
    error,
    sendMessage,
    clearHistory,
  }
}
