import { GoogleGenAI } from '@google/genai'
import type { Content, FunctionDeclaration, GenerateContentResponse } from '@google/genai'
import { getDatabase } from '../database/getDatabase'

/**
 * Google Gemini AI Service with rate limit tracking
 *
 * Wraps the @google/genai SDK for use in Totality's main process.
 * API key is read from settings (encrypted at rest via CredentialEncryptionService).
 * Rate limits are tracked from 429 responses and surfaced to the renderer.
 *
 * Free tier limits (gemini-2.5-flash): 10 RPM, 250 RPD — no credit card required.
 */

export interface GeminiMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface GeminiStreamDelta {
  requestId: string
  delta: string
}

export interface GeminiStreamComplete {
  requestId: string
  usage?: { input_tokens: number; output_tokens: number }
}

export interface GeminiToolDefinition {
  name: string
  description?: string
  parameters: Record<string, unknown>
}

export interface RateLimitInfo {
  limited: boolean
  retryAfterSeconds: number
}

export class RateLimitError extends Error {
  retryAfterSeconds: number

  constructor(message: string, retryAfterSeconds: number) {
    super(message)
    this.name = 'RateLimitError'
    this.retryAfterSeconds = retryAfterSeconds
  }
}

export class GeminiService {
  private static readonly DEFAULT_MODEL = 'gemini-2.5-flash'
  private static readonly FAST_MODEL = 'gemini-2.5-flash'

  private client: GoogleGenAI | null = null
  private apiKey: string | null = null
  private model: string = GeminiService.DEFAULT_MODEL
  private enabled: boolean = true
  private rateLimitedUntil: number | null = null
  private static readonly MAX_EXPLANATION_CACHE = 100
  private explanationCache = new Map<string, { text: string; timestamp: number }>()

  constructor() {
    const db = getDatabase()
    this.apiKey = db.getSetting('gemini_api_key') || null
    this.model = db.getSetting('gemini_model') || GeminiService.DEFAULT_MODEL
    this.enabled = db.getSetting('ai_enabled') !== 'false'

    if (this.apiKey && this.enabled) {
      this.client = new GoogleGenAI({ apiKey: this.apiKey })
    }
  }

  /**
   * Refresh API key, model, and enabled state from database (called when settings change)
   */
  refreshApiKey(): void {
    const db = getDatabase()
    this.apiKey = db.getSetting('gemini_api_key') || null
    this.model = db.getSetting('gemini_model') || GeminiService.DEFAULT_MODEL
    this.enabled = db.getSetting('ai_enabled') !== 'false'

    if (this.apiKey && this.enabled) {
      this.client = new GoogleGenAI({ apiKey: this.apiKey })
    } else {
      this.client = null
    }
  }

  /**
   * Check if the service is configured and enabled
   */
  isConfigured(): boolean {
    return !!this.apiKey && this.apiKey !== '' && this.enabled
  }

  /**
   * Get current rate limit status
   */
  getRateLimitInfo(): RateLimitInfo {
    if (this.rateLimitedUntil && Date.now() < this.rateLimitedUntil) {
      const retryAfterSeconds = Math.ceil((this.rateLimitedUntil - Date.now()) / 1000)
      return { limited: true, retryAfterSeconds }
    }
    return { limited: false, retryAfterSeconds: 0 }
  }

  /**
   * Extract retry-after seconds from HTTP headers (Fetch API Headers object).
   * Checks retry-after-ms (Gemini-specific), retry-after (seconds or HTTP-date).
   */
  private extractRetrySeconds(headers: unknown): number | null {
    if (!headers || typeof headers !== 'object') return null
    const h = headers as { get?: (name: string) => string | null }
    if (typeof h.get !== 'function') return null

    // 1. retry-after-ms — milliseconds (Gemini-specific, most precise)
    const msValue = h.get('retry-after-ms')
    if (msValue) {
      const ms = parseInt(msValue, 10)
      if (!isNaN(ms) && ms > 0) return Math.ceil(ms / 1000)
    }

    // 2. retry-after — seconds or HTTP-date
    const retryAfter = h.get('retry-after')
    if (retryAfter) {
      const secs = parseInt(retryAfter, 10)
      if (!isNaN(secs) && secs > 0) return secs
      // Try parsing as HTTP-date
      const date = new Date(retryAfter)
      if (!isNaN(date.getTime())) {
        const diff = Math.ceil((date.getTime() - Date.now()) / 1000)
        if (diff > 0) return diff
      }
    }

    return null
  }

  /**
   * Check rate limit before making a request
   */
  private checkRateLimit(): void {
    if (this.rateLimitedUntil && Date.now() < this.rateLimitedUntil) {
      const retryAfterSeconds = Math.ceil((this.rateLimitedUntil - Date.now()) / 1000)
      throw new RateLimitError(
        `Rate limit reached. Try again in ${retryAfterSeconds}s`,
        retryAfterSeconds,
      )
    }
  }

  /**
   * Get the initialized client or throw
   */
  private getClient(): GoogleGenAI {
    if (!this.client || !this.apiKey) {
      throw new Error('Gemini API key not configured. Please add your API key in Settings > Services.')
    }
    return this.client
  }

  /**
   * Handle API errors, tracking rate limits
   */
  private handleApiError(error: unknown): never {
    if (error && typeof error === 'object' && 'status' in error) {
      const apiError = error as { status: number; message?: string; headers?: unknown }
      if (apiError.status === 429) {
        const retryAfterSeconds = this.extractRetrySeconds(apiError.headers) ?? 15
        this.rateLimitedUntil = Date.now() + (retryAfterSeconds * 1000)
        throw new RateLimitError(
          `Rate limit reached. Try again in ${retryAfterSeconds}s`,
          retryAfterSeconds,
        )
      }
      if (apiError.status === 400 || apiError.status === 403) {
        throw new Error('Invalid Gemini API key. Please check your API key in Settings > Services.')
      }
      throw new Error(`Gemini API error (${apiError.status}): ${apiError.message || 'Unknown error'}`)
    }
    // Check for RESOURCE_EXHAUSTED in error message (Gemini rate limit pattern)
    if (error instanceof Error && error.message?.includes('RESOURCE_EXHAUSTED')) {
      // SDK APIError subclasses also have headers
      const headers = (error as { headers?: unknown }).headers
      const retryAfterSeconds = this.extractRetrySeconds(headers) ?? 15
      this.rateLimitedUntil = Date.now() + (retryAfterSeconds * 1000)
      throw new RateLimitError(
        `Rate limit reached. Try again in ${retryAfterSeconds}s`,
        retryAfterSeconds,
      )
    }
    throw error
  }

  /**
   * Convert our message format to Gemini Content format
   */
  private toGeminiContents(messages: GeminiMessage[]): Content[] {
    return messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }))
  }

  /**
   * Extract usage from response
   */
  private extractUsage(response: GenerateContentResponse): { input_tokens: number; output_tokens: number } {
    return {
      input_tokens: response.usageMetadata?.promptTokenCount || 0,
      output_tokens: response.usageMetadata?.candidatesTokenCount || 0,
    }
  }

  /**
   * Send a message and get a complete response
   */
  async sendMessage(params: {
    messages: GeminiMessage[]
    system?: string
    maxTokens?: number
  }): Promise<{ text: string; usage: { input_tokens: number; output_tokens: number } }> {
    this.checkRateLimit()
    const client = this.getClient()

    try {
      const response = await client.models.generateContent({
        model: this.model,
        contents: this.toGeminiContents(params.messages),
        config: {
          maxOutputTokens: params.maxTokens || 4096,
          systemInstruction: params.system,
        },
      })

      return {
        text: response.text || '',
        usage: this.extractUsage(response),
      }
    } catch (error) {
      this.handleApiError(error)
    }
  }

  /**
   * Send a message with tool definitions and handle the tool-use loop.
   * The caller provides an `executeTool` function to handle tool calls.
   */
  async sendMessageWithTools(params: {
    messages: GeminiMessage[]
    system?: string
    tools: GeminiToolDefinition[]
    executeTool: (name: string, input: Record<string, unknown>) => Promise<string>
    maxTokens?: number
    maxToolRounds?: number
  }): Promise<{ text: string; usage: { input_tokens: number; output_tokens: number } }> {
    this.checkRateLimit()
    const client = this.getClient()

    // Convert tool definitions to Gemini format
    const functionDeclarations: FunctionDeclaration[] = params.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }))

    const contents: Content[] = this.toGeminiContents(params.messages)
    const maxRounds = params.maxToolRounds || 10
    let totalUsage = { input_tokens: 0, output_tokens: 0 }
    const recentToolCalls: string[] = [] // Track recent tool call signatures for loop detection

    for (let round = 0; round < maxRounds; round++) {
      let response: GenerateContentResponse
      try {
        response = await client.models.generateContent({
          model: this.model,
          contents,
          config: {
            maxOutputTokens: params.maxTokens || 4096,
            systemInstruction: params.system,
            tools: [{ functionDeclarations }],
          },
        })
      } catch (error) {
        this.handleApiError(error)
      }

      const usage = this.extractUsage(response)
      totalUsage.input_tokens += usage.input_tokens
      totalUsage.output_tokens += usage.output_tokens

      // Check for function calls
      const functionCalls = response.functionCalls
      if (!functionCalls || functionCalls.length === 0) {
        // No tool use, return text
        return {
          text: response.text || '',
          usage: totalUsage,
        }
      }

      // Add the model's response (with function calls) to conversation
      if (response.candidates?.[0]?.content) {
        contents.push(response.candidates[0].content)
      }

      // Execute each function call and build responses
      const functionResponses: Content = {
        role: 'user',
        parts: [],
      }

      // Detect tool-use loops: same tool calls repeated 3+ times in a row
      const callSignature = functionCalls.map(fc => `${fc.name}:${JSON.stringify(fc.args)}`).join('|')
      recentToolCalls.push(callSignature)
      if (recentToolCalls.length >= 3) {
        const last3 = recentToolCalls.slice(-3)
        if (last3[0] === last3[1] && last3[1] === last3[2]) {
          console.warn('[GeminiService] Tool-use loop detected — same calls repeated 3 times, breaking')
          return {
            text: 'I encountered an issue processing your request. Please try rephrasing your question.',
            usage: totalUsage,
          }
        }
      }

      for (const fc of functionCalls) {
        try {
          const resultStr = await params.executeTool(
            fc.name || '',
            (fc.args as Record<string, unknown>) || {},
          )
          functionResponses.parts!.push({
            functionResponse: {
              name: fc.name,
              response: { output: resultStr },
            },
          })
        } catch (error) {
          functionResponses.parts!.push({
            functionResponse: {
              name: fc.name,
              response: { error: error instanceof Error ? error.message : String(error) },
            },
          })
        }
      }

      contents.push(functionResponses)
    }

    throw new Error('Tool use loop exceeded maximum rounds')
  }

  /**
   * Stream a message response, calling onDelta for each text chunk.
   * Returns the complete response text and usage when done.
   */
  async streamMessage(
    params: {
      messages: GeminiMessage[]
      system?: string
      maxTokens?: number
    },
    onDelta: (text: string) => void,
  ): Promise<{ text: string; usage: { input_tokens: number; output_tokens: number } }> {
    this.checkRateLimit()
    const client = this.getClient()

    try {
      const stream = await client.models.generateContentStream({
        model: this.model,
        contents: this.toGeminiContents(params.messages),
        config: {
          maxOutputTokens: params.maxTokens || 4096,
          systemInstruction: params.system,
        },
      })

      let fullText = ''
      let lastUsage = { input_tokens: 0, output_tokens: 0 }

      for await (const chunk of stream) {
        const text = chunk.text
        if (text) {
          fullText += text
          onDelta(text)
        }
        // Update usage from last chunk (Gemini sends it in final chunk)
        if (chunk.usageMetadata) {
          lastUsage = this.extractUsage(chunk)
        }
      }

      return {
        text: fullText,
        usage: lastUsage,
      }
    } catch (error) {
      this.handleApiError(error)
    }
  }

  /**
   * Disambiguate a filename against multiple TMDB results.
   * Uses Flash for cost efficiency since this may be called many times during scans.
   * Returns the index of the best match, or -1 if none is confident.
   */
  async disambiguateTitle(
    filename: string,
    year: number | undefined,
    candidates: Array<{ id: number; title: string; year?: number; overview?: string }>,
  ): Promise<number> {
    if (!this.isConfigured() || candidates.length <= 1) return 0

    try {
      this.checkRateLimit()
      const client = this.getClient()

      const candidateList = candidates.map((c, i) =>
        `${i + 1}. "${c.title}" (${c.year || 'unknown year'})${c.overview ? ` — ${c.overview.slice(0, 100)}` : ''}`
      ).join('\n')

      const response = await client.models.generateContent({
        model: GeminiService.FAST_MODEL,
        contents: `A media file named "${filename}"${year ? ` (year: ${year})` : ''} matched multiple TMDB results. Which is the best match? Reply with ONLY the number.\n\n${candidateList}`,
        config: {
          maxOutputTokens: 20,
        },
      })

      const text = (response.text || '').trim()
      const num = parseInt(text, 10)
      if (num >= 1 && num <= candidates.length) return num - 1
      return 0
    } catch {
      // On any error (rate limit, etc.), fall back to first result
      return 0
    }
  }

  /**
   * Explain a quality score for a media item.
   * Uses Flash for cost efficiency. Results are cached for 1 hour.
   */
  async explainQualityScore(params: {
    title: string
    resolution?: string
    videoCodec?: string
    videoBitrate?: number
    audioCodec?: string
    audioChannels?: number
    hdrFormat?: string
    qualityTier?: string
    tierQuality?: string
    tierScore?: number
  }): Promise<string> {
    const cacheKey = `${params.title}-${params.resolution}-${params.videoCodec}-${params.videoBitrate}`
    const cached = this.explanationCache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < 3600000) {
      return cached.text
    }

    this.checkRateLimit()
    const client = this.getClient()

    const details = [
      params.resolution && `Resolution: ${params.resolution}`,
      params.videoCodec && `Video codec: ${params.videoCodec}`,
      params.videoBitrate && `Video bitrate: ${params.videoBitrate} kbps`,
      params.audioCodec && `Audio codec: ${params.audioCodec}`,
      params.audioChannels && `Audio channels: ${params.audioChannels}`,
      params.hdrFormat && `HDR: ${params.hdrFormat}`,
      params.qualityTier && `Quality tier: ${params.qualityTier}`,
      params.tierQuality && `Quality level: ${params.tierQuality}`,
      params.tierScore != null && `Score: ${params.tierScore}/100`,
    ].filter(Boolean).join(', ')

    try {
      const response = await client.models.generateContent({
        model: GeminiService.FAST_MODEL,
        contents: `Briefly explain the quality of "${params.title}" in 2-3 sentences. Specs: ${details}. Focus on what's good/bad and if an upgrade would be worthwhile.`,
        config: {
          maxOutputTokens: 200,
        },
      })

      const text = response.text || ''
      // Evict oldest entry if cache is full
      if (this.explanationCache.size >= GeminiService.MAX_EXPLANATION_CACHE) {
        const firstKey = this.explanationCache.keys().next().value
        if (firstKey) this.explanationCache.delete(firstKey)
      }
      this.explanationCache.set(cacheKey, { text, timestamp: Date.now() })
      return text
    } catch (error) {
      this.handleApiError(error)
    }
  }

  /**
   * Test an API key by making a minimal request
   */
  async testApiKey(apiKey: string): Promise<{ success: boolean; error?: string }> {
    try {
      const testClient = new GoogleGenAI({ apiKey })

      await testClient.models.generateContent({
        model: GeminiService.FAST_MODEL,
        contents: 'Hi',
        config: {
          maxOutputTokens: 10,
        },
      })

      return { success: true }
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error) {
        const apiError = error as { status: number; message?: string }
        if (apiError.status === 400 || apiError.status === 403) {
          return { success: false, error: 'Invalid API key' }
        }
        return { success: false, error: `API error: ${apiError.message || 'Unknown'}` }
      }
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }
}

// Singleton instance
let geminiService: GeminiService | null = null

export function getGeminiService(): GeminiService {
  if (!geminiService) {
    geminiService = new GeminiService()
  }
  return geminiService
}
