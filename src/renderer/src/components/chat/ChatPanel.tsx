import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Bot, X, Send, Trash2, AlertCircle, Settings } from 'lucide-react'
import { useChat, type ViewContext } from '../../hooks/useChat'
import { ChatMessage } from './ChatMessage'

interface ChatPanelProps {
  isOpen: boolean
  onClose: () => void
  onOpenSettings?: () => void
  viewContext?: ViewContext
}

export function ChatPanel({ isOpen, onClose, onOpenSettings, viewContext }: ChatPanelProps) {
  const { messages, isLoading, activeTools, rateLimit, error, sendMessage, clearHistory } = useChat(viewContext)
  const [input, setInput] = useState('')
  const [isConfigured, setIsConfigured] = useState<boolean | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Check if AI is configured
  useEffect(() => {
    if (isOpen) {
      window.electronAPI.aiIsConfigured().then(setIsConfigured).catch(() => setIsConfigured(false))
    }
  }, [isOpen])

  // Listen for settings changes to re-check configuration
  useEffect(() => {
    const cleanup = window.electronAPI.onSettingsChanged((data) => {
      if (data.key === 'gemini_api_key' || data.key === 'ai_enabled') {
        window.electronAPI.aiIsConfigured().then(setIsConfigured).catch(() => setIsConfigured(false))
      }
    })
    return cleanup
  }, [])

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, activeTools])

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen && isConfigured) {
      setTimeout(() => inputRef.current?.focus(), 300)
    }
  }, [isOpen, isConfigured])

  const handleSubmit = useCallback(() => {
    if (!input.trim() || isLoading || rateLimit.limited) return
    sendMessage(input)
    setInput('')
  }, [input, isLoading, rateLimit.limited, sendMessage])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit],
  )

  const suggestedPrompts = useMemo(() => {
    if (viewContext?.currentView === 'library') {
      switch (viewContext.libraryTab) {
        case 'movies':
          return [
            'What 4K upgrades am I missing?',
            'Which Marvel movies am I missing?',
            'Find me some great sci-fi I don\'t have',
          ]
        case 'tv':
          return [
            'Which shows are incomplete?',
            'What are my lowest quality TV shows?',
            'Recommend some shows similar to what I have',
          ]
        case 'music':
          return [
            'How\'s my audio quality overall?',
            'Which artists am I missing albums from?',
            'What lossless albums do I have?',
          ]
      }
    }
    return [
      'How\'s my library quality overall?',
      'What should I upgrade next?',
      'What movies am I missing from popular franchises?',
    ]
  }, [viewContext?.currentView, viewContext?.libraryTab])

  return (
    <aside
      className={`fixed top-[88px] bottom-4 right-4 w-80 bg-sidebar-gradient rounded-2xl shadow-xl z-40 flex flex-col overflow-hidden transition-[transform,opacity] duration-300 ease-out will-change-[transform,opacity] ${
        isOpen ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0 pointer-events-none'
      }`}
      role="complementary"
      aria-label="AI Chat"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold">AI Assistant</h2>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button
              onClick={clearHistory}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              title="Clear chat history"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            title="Close chat"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Not configured state */}
      {isConfigured === false && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <Bot className="w-10 h-10 text-muted-foreground mb-3" />
          <p className="text-sm font-medium mb-1">Gemini AI not configured</p>
          <p className="text-xs text-muted-foreground mb-4">
            Get a free Gemini API key from Google AI Studio in Settings &gt; Services.
          </p>
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              className="flex items-center gap-2 px-3 py-2 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            >
              <Settings className="w-3.5 h-3.5" />
              Open Settings
            </button>
          )}
        </div>
      )}

      {/* Messages area */}
      {isConfigured !== false && (
        <>
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.length === 0 && !isLoading && (
              <div className="flex flex-col items-center justify-center h-full text-center px-4">
                <Bot className="w-8 h-8 text-muted-foreground mb-3" />
                <p className="text-xs text-muted-foreground mb-3">
                  Ask me about your media library
                </p>
                <div className="space-y-1.5 w-full">
                  {suggestedPrompts.map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => {
                        setInput(suggestion)
                        setTimeout(() => inputRef.current?.focus(), 0)
                      }}
                      className="w-full text-left px-3 py-2 text-xs bg-muted/30 hover:bg-muted/50 rounded-lg transition-colors text-muted-foreground hover:text-foreground"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground/50 mt-4">
                  Messages are processed by Google Gemini using your API key. Chat history is not saved to disk.
                </p>
              </div>
            )}

            {messages.map((message) => (
              <ChatMessage
                key={message.id}
                message={message}
                activeTools={message.isLoading ? activeTools : []}
              />
            ))}

            <div ref={messagesEndRef} />
          </div>

          {/* Error display */}
          {error && (
            <div className="px-3 pb-2">
              <div className="flex items-center gap-2 px-3 py-2 text-xs bg-destructive/10 text-destructive rounded-lg">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="truncate">{error}</span>
              </div>
            </div>
          )}


          {/* Input area */}
          <div className="px-3 pb-3 pt-2 border-t border-border/30">
            <div className="flex gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about your library..."
                disabled={isLoading || rateLimit.limited}
                rows={1}
                className="flex-1 px-3 py-2 bg-background border border-border/30 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 min-h-[36px] max-h-[100px]"
                style={{ height: 'auto' }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement
                  target.style.height = 'auto'
                  target.style.height = Math.min(target.scrollHeight, 100) + 'px'
                }}
              />
              <button
                onClick={handleSubmit}
                disabled={!input.trim() || isLoading || rateLimit.limited}
                className="flex-shrink-0 p-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
                title="Send message"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </>
      )}
    </aside>
  )
}
