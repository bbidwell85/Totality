import { useState, useCallback, useMemo } from 'react'
import { Bot, User, Database, Loader2, Star } from 'lucide-react'
import type { ChatMessage as ChatMessageType, ActionableItem } from '../../hooks/useChat'
import { useWishlist } from '../../contexts/WishlistContext'

/** Human-readable labels for tool names */
const TOOL_LABELS: Record<string, string> = {
  search_library: 'Searching library',
  get_media_items: 'Querying media items',
  get_tv_shows: 'Querying TV shows',
  get_library_stats: 'Loading library stats',
  get_quality_distribution: 'Loading quality data',
  get_series_completeness: 'Checking series completeness',
  get_collection_completeness: 'Checking collections',
  get_music_stats: 'Loading music stats',
  get_source_list: 'Loading sources',
  get_wishlist: 'Loading wishlist',
  search_tmdb: 'Searching TMDB',
  discover_titles: 'Discovering titles',
  get_similar_titles: 'Finding similar titles',
  check_ownership: 'Checking ownership',
  get_item_details: 'Getting item details',
  add_to_wishlist: 'Adding to wishlist',
}

interface ChatMessageProps {
  message: ChatMessageType
  activeTools: string[]
}

export function ChatMessage({ message, activeTools }: ChatMessageProps) {
  const isUser = message.role === 'user'

  return (
    <div className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar */}
      <div
        className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${
          isUser ? 'bg-primary/20 text-primary' : 'bg-accent/20 text-accent-foreground'
        }`}
      >
        {isUser ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
      </div>

      {/* Content */}
      <div className={`flex-1 min-w-0 ${isUser ? 'text-right' : 'text-left'}`}>
        <div
          className={`inline-block max-w-full rounded-lg px-3 py-2 text-sm ${
            isUser
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted/50'
          }`}
        >
          {message.isLoading && !message.content ? (
            <div className="space-y-1.5">
              {activeTools.length > 0 ? (
                activeTools.map((tool, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Database className="w-3 h-3 animate-pulse" />
                    <span>{TOOL_LABELS[tool] || tool}...</span>
                  </div>
                ))
              ) : (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Thinking...</span>
                </div>
              )}
            </div>
          ) : (
            <div className="prose prose-sm prose-invert max-w-none wrap-break-word whitespace-pre-wrap [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
              <SimpleMarkdown text={message.content} />
            </div>
          )}

          {/* Actionable items — add to wishlist buttons */}
          {!isUser && message.actionableItems && message.actionableItems.length > 0 && (
            <div className="mt-2 pt-2 border-t border-border/20">
              <p className="text-[10px] text-muted-foreground mb-1.5">Add to wishlist:</p>
              <div className="flex flex-col gap-1">
                {message.actionableItems.map((item, i) => (
                  <ChatWishlistButton key={`${item.tmdb_id || item.title}-${i}`} item={item} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Tool usage badges */}
        {message.toolsUsed && message.toolsUsed.length > 0 && (
          <div className={`flex flex-wrap gap-1 mt-1 ${isUser ? 'justify-end' : 'justify-start'}`}>
            {message.toolsUsed.map((tool, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-muted-foreground bg-muted/30 rounded"
              >
                <Database className="w-2.5 h-2.5" />
                {TOOL_LABELS[tool] || tool}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Simple markdown renderer for chat messages.
 * Handles: bold, italic, code blocks, inline code, lists, headings, and line breaks.
 */
function SimpleMarkdown({ text }: { text: string }) {
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []
  let inCodeBlock = false
  let codeBlockContent: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Code block start/end
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

    // Empty line = paragraph break
    if (line.trim() === '') {
      elements.push(<br key={`br-${i}`} />)
      continue
    }

    // Headings
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

    // List items
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

    // Regular paragraph
    elements.push(
      <p key={`p-${i}`} className="my-0.5">
        <InlineMarkdown text={line} />
      </p>,
    )
  }

  // Handle unclosed code block
  if (inCodeBlock && codeBlockContent.length > 0) {
    elements.push(
      <pre key="code-unclosed" className="bg-background/50 rounded p-2 text-xs overflow-x-auto my-1">
        <code>{codeBlockContent.join('\n')}</code>
      </pre>,
    )
  }

  return <>{elements}</>
}

/** Render inline markdown: bold, italic, inline code */
function InlineMarkdown({ text }: { text: string }) {
  // Process inline elements: **bold**, *italic*, `code`
  const parts: React.ReactNode[] = []
  let remaining = text
  let key = 0

  while (remaining.length > 0) {
    // Inline code
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

    // Bold
    const boldMatch = remaining.match(/^\*\*(.+?)\*\*/)
    if (boldMatch) {
      parts.push(<strong key={key++}>{boldMatch[1]}</strong>)
      remaining = remaining.slice(boldMatch[0].length)
      continue
    }

    // Italic
    const italicMatch = remaining.match(/^\*(.+?)\*/)
    if (italicMatch) {
      parts.push(<em key={key++}>{italicMatch[1]}</em>)
      remaining = remaining.slice(italicMatch[0].length)
      continue
    }

    // Regular text until next special char
    const nextSpecial = remaining.search(/[`*]/)
    if (nextSpecial === -1) {
      parts.push(remaining)
      break
    } else if (nextSpecial === 0) {
      // Single special char, just output it
      parts.push(remaining[0])
      remaining = remaining.slice(1)
    } else {
      parts.push(remaining.slice(0, nextSpecial))
      remaining = remaining.slice(nextSpecial)
    }
  }

  return <>{parts}</>
}

/** Compact wishlist button for actionable items in chat messages */
function ChatWishlistButton({ item }: { item: ActionableItem }) {
  const { addItem, removeItem, items } = useWishlist()
  const [loading, setLoading] = useState(false)

  const effectiveMediaType = item.media_type === 'tv' ? 'season' : 'movie'
  const wishlistMatch = useMemo(() => {
    if (item.tmdb_id) {
      return items.find(w => w.tmdb_id === item.tmdb_id && w.media_type === (effectiveMediaType as string))
    }
    return items.find(w => w.title === item.title && w.media_type === (effectiveMediaType as string))
  }, [items, item.tmdb_id, item.title, effectiveMediaType])

  const inWishlist = !!wishlistMatch

  const handleToggle = useCallback(async () => {
    if (loading) return
    setLoading(true)
    try {
      if (inWishlist && wishlistMatch) {
        await removeItem(wishlistMatch.id)
      } else {
        await addItem({
          title: item.title,
          year: item.year,
          tmdb_id: item.tmdb_id,
          media_type: effectiveMediaType,
          reason: 'missing',
          priority: 3,
          status: 'active',
        })
      }
    } finally {
      setLoading(false)
    }
  }, [loading, inWishlist, wishlistMatch, removeItem, addItem, item, effectiveMediaType])

  return (
    <button
      onClick={handleToggle}
      disabled={loading}
      className={`flex items-center gap-1.5 py-0.5 text-xs transition-colors cursor-pointer ${
        inWishlist
          ? 'text-foreground'
          : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      <Star className={`w-3 h-3 shrink-0 ${inWishlist ? 'fill-amber-400 text-amber-400' : ''}`} />
      <span className="text-left">{item.title}{item.year ? ` (${item.year})` : ''}</span>
    </button>
  )
}
