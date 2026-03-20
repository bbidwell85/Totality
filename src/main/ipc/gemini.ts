import { ipcMain, BrowserWindow } from 'electron'
import { z } from 'zod'
import { getGeminiService, RateLimitError } from '../services/GeminiService'
import { LIBRARY_TOOLS, executeTool, type ActionableItem } from '../services/GeminiTools'
import { LIBRARY_CHAT_SYSTEM_PROMPT } from '../services/ai-system-prompts'
import { getGeminiAnalysisService } from '../services/GeminiAnalysisService'
import { validateInput, AiSendMessageSchema, AiStreamMessageSchema, AiTestApiKeySchema } from '../validation/schemas'

const AiChatMessageSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1).max(100000),
  })).min(1),
  requestId: z.string().min(1).max(100),
  viewContext: z.object({
    currentView: z.enum(['dashboard', 'library']),
    libraryTab: z.enum(['movies', 'tv', 'music']).optional(),
    selectedItem: z.object({
      title: z.string(),
      type: z.string().optional(),
      id: z.number().optional(),
    }).optional(),
    activeSourceId: z.string().optional(),
    activeFilters: z.string().optional(),
  }).optional(),
})

/**
 * Format errors for IPC responses, with special handling for rate limits
 */
function formatError(error: unknown): { error: string; rateLimited?: boolean; retryAfterSeconds?: number } {
  if (error instanceof RateLimitError) {
    return {
      error: error.message,
      rateLimited: true,
      retryAfterSeconds: error.retryAfterSeconds,
    }
  }
  return { error: error instanceof Error ? error.message : String(error) }
}

/**
 * Register all Gemini AI IPC handlers
 */
export function registerGeminiHandlers() {
  ipcMain.handle('ai:isConfigured', async () => {
    return getGeminiService().isConfigured()
  })

  ipcMain.handle('ai:getRateLimitInfo', async () => {
    return getGeminiService().getRateLimitInfo()
  })

  ipcMain.handle('ai:testApiKey', async (_event, apiKey: unknown) => {
    try {
      const validKey = validateInput(AiTestApiKeySchema, apiKey, 'ai:testApiKey')
      return await getGeminiService().testApiKey(validKey)
    } catch (error) {
      console.error('Error testing Gemini API key:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  ipcMain.handle('ai:sendMessage', async (_event, params: unknown) => {
    try {
      const validated = validateInput(AiSendMessageSchema, params, 'ai:sendMessage')
      return await getGeminiService().sendMessage(validated)
    } catch (error) {
      console.error('Error in ai:sendMessage:', error)
      throw formatError(error)
    }
  })

  ipcMain.handle('ai:streamMessage', async (event, params: unknown) => {
    try {
      const validated = validateInput(AiStreamMessageSchema, params, 'ai:streamMessage')
      const win = BrowserWindow.fromWebContents(event.sender)

      const result = await getGeminiService().streamMessage(
        {
          messages: validated.messages,
          system: validated.system,
          maxTokens: validated.maxTokens,
        },
        (delta) => {
          win?.webContents.send('ai:streamDelta', {
            requestId: validated.requestId,
            delta,
          })
        },
      )

      win?.webContents.send('ai:streamComplete', {
        requestId: validated.requestId,
        usage: result.usage,
      })

      return result
    } catch (error) {
      console.error('Error in ai:streamMessage:', error)
      throw formatError(error)
    }
  })

  /**
   * Chat message handler with tool use.
   */
  ipcMain.handle('ai:chatMessage', async (event, params: unknown) => {
    try {
      const validated = validateInput(AiChatMessageSchema, params, 'ai:chatMessage')
      console.log('[IPC ai:chatMessage] Chat message received, history length:', validated.messages.length)
      const win = BrowserWindow.fromWebContents(event.sender)
      const actionableItems: ActionableItem[] = []

      // Inject view context into the last user message if provided
      const messages = validated.messages.map((m, i) => {
        if (validated.viewContext && i === validated.messages.length - 1 && m.role === 'user') {
          const ctx = validated.viewContext
          const parts: string[] = []
          if (ctx.currentView === 'dashboard') parts.push('Viewing: Dashboard')
          else if (ctx.libraryTab) parts.push(`Viewing: ${ctx.libraryTab} library`)
          if (ctx.selectedItem) parts.push(`Selected: "${ctx.selectedItem.title}"`)
          if (ctx.activeFilters) parts.push(`Filters: ${ctx.activeFilters}`)
          if (parts.length > 0) {
            return { ...m, content: `[${parts.join(' | ')}]\n${m.content}` }
          }
        }
        return m
      })

      const result = await getGeminiService().sendMessageWithTools({
        messages,
        system: LIBRARY_CHAT_SYSTEM_PROMPT,
        tools: LIBRARY_TOOLS,
        maxTokens: 4096,
        executeTool: async (name, input) => {
          win?.webContents.send('ai:toolUse', {
            requestId: validated.requestId,
            toolName: name,
            input,
          })
          return await executeTool(name, input, actionableItems)
        },
      })

      // Stream the final response word-by-word for perceived responsiveness
      if (win && result.text) {
        const words = result.text.split(/(\s+)/)
        const chunkSize = 3 // Send ~3 tokens at a time
        for (let i = 0; i < words.length; i += chunkSize) {
          const chunk = words.slice(i, i + chunkSize).join('')
          win.webContents.send('ai:chatStreamDelta', {
            requestId: validated.requestId,
            delta: chunk,
          })
          // Small delay between chunks for streaming effect
          if (i + chunkSize < words.length) {
            await new Promise((r) => setTimeout(r, 15))
          }
        }
        win.webContents.send('ai:chatStreamComplete', {
          requestId: validated.requestId,
        })
      }

      return {
        text: result.text,
        actionableItems: actionableItems.length > 0 ? actionableItems : undefined,
        usage: result.usage,
        requestId: validated.requestId,
      }
    } catch (error) {
      console.error('Error in ai:chatMessage:', error)
      const formatted = formatError(error)
      if (formatted.rateLimited) {
        console.log('[IPC ai:chatMessage] Rate limited, retry after', formatted.retryAfterSeconds, 'seconds')
        return formatted
      }
      throw formatted
    }
  })

  /**
   * Analysis report handlers — stream AI-generated reports to the renderer.
   */

  ipcMain.handle('ai:qualityReport', async (event, params: unknown) => {
    try {
      const { requestId } = validateInput(
        z.object({ requestId: z.string().min(1).max(100) }),
        params,
        'ai:qualityReport',
      )
      const win = BrowserWindow.fromWebContents(event.sender)

      console.log('[IPC ai:qualityReport] Generating quality report')
      const result = await getGeminiAnalysisService().generateQualityReport(
        (delta) => {
          win?.webContents.send('ai:analysisStreamDelta', { requestId, delta })
        },
      )

      win?.webContents.send('ai:analysisStreamComplete', { requestId })
      return { text: result.text, requestId }
    } catch (error) {
      console.error('Error in ai:qualityReport:', error)
      throw formatError(error)
    }
  })

  ipcMain.handle('ai:upgradePriorities', async (event, params: unknown) => {
    try {
      const { requestId } = validateInput(
        z.object({ requestId: z.string().min(1).max(100) }),
        params,
        'ai:upgradePriorities',
      )
      const win = BrowserWindow.fromWebContents(event.sender)

      console.log('[IPC ai:upgradePriorities] Generating upgrade priorities report')
      const result = await getGeminiAnalysisService().generateUpgradePriorities(
        (delta) => {
          win?.webContents.send('ai:analysisStreamDelta', { requestId, delta })
        },
      )

      win?.webContents.send('ai:analysisStreamComplete', { requestId })
      return { text: result.text, requestId }
    } catch (error) {
      console.error('Error in ai:upgradePriorities:', error)
      throw formatError(error)
    }
  })

  ipcMain.handle('ai:completenessInsights', async (event, params: unknown) => {
    try {
      const { requestId } = validateInput(
        z.object({ requestId: z.string().min(1).max(100) }),
        params,
        'ai:completenessInsights',
      )
      const win = BrowserWindow.fromWebContents(event.sender)

      console.log('[IPC ai:completenessInsights] Generating completeness report')
      const result = await getGeminiAnalysisService().generateCompletenessInsights(
        (delta) => {
          win?.webContents.send('ai:analysisStreamDelta', { requestId, delta })
        },
      )

      win?.webContents.send('ai:analysisStreamComplete', { requestId })
      return { text: result.text, requestId }
    } catch (error) {
      console.error('Error in ai:completenessInsights:', error)
      throw formatError(error)
    }
  })

  ipcMain.handle('ai:wishlistAdvice', async (event, params: unknown) => {
    try {
      const { requestId } = validateInput(
        z.object({ requestId: z.string().min(1).max(100) }),
        params,
        'ai:wishlistAdvice',
      )
      const win = BrowserWindow.fromWebContents(event.sender)

      console.log('[IPC ai:wishlistAdvice] Generating wishlist advice report')
      const result = await getGeminiAnalysisService().generateWishlistAdvice(
        (delta) => {
          win?.webContents.send('ai:analysisStreamDelta', { requestId, delta })
        },
      )

      win?.webContents.send('ai:analysisStreamComplete', { requestId })
      return { text: result.text, requestId }
    } catch (error) {
      console.error('Error in ai:wishlistAdvice:', error)
      throw formatError(error)
    }
  })

  ipcMain.handle('ai:explainQuality', async (_event, params: unknown) => {
    try {
      const validated = validateInput(
        z.object({
          title: z.string().min(1).max(500),
          resolution: z.string().optional(),
          videoCodec: z.string().optional(),
          videoBitrate: z.number().optional(),
          audioCodec: z.string().optional(),
          audioChannels: z.number().optional(),
          hdrFormat: z.string().optional(),
          qualityTier: z.string().optional(),
          tierQuality: z.string().optional(),
          tierScore: z.number().optional(),
        }),
        params,
        'ai:explainQuality',
      )
      const explanation = await getGeminiService().explainQualityScore(validated)
      return { text: explanation }
    } catch (error) {
      console.error('Error in ai:explainQuality:', error)
      throw formatError(error)
    }
  })
}
