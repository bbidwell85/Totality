/**
 * IPC Handlers for Jellyfin-specific operations
 *
 * Handles server discovery, Quick Connect, and other Jellyfin features.
 */

import { ipcMain } from 'electron'
import { getJellyfinDiscoveryService } from '../services/JellyfinDiscoveryService'
import { getEmbyDiscoveryService } from '../services/EmbyDiscoveryService'
import { getSourceManager } from '../services/SourceManager'
import { JellyfinProvider } from '../providers/jellyfin-emby/JellyfinProvider'
import { getErrorMessage } from './utils'
import {
  validateInput,
  JellyfinApiKeyAuthSchema,
  SafeUrlSchema,
} from '../validation/schemas'

export function registerJellyfinHandlers(): void {
  const jellyfinDiscovery = getJellyfinDiscoveryService()
  const embyDiscovery = getEmbyDiscoveryService()
  const manager = getSourceManager()

  // ============================================================================
  // SERVER DISCOVERY
  // ============================================================================

  /**
   * Discover Jellyfin servers on the local network via UDP broadcast
   */
  ipcMain.handle('jellyfin:discoverServers', async () => {
    try {
      console.log('[IPC] Starting Jellyfin server discovery...')
      const servers = await jellyfinDiscovery.discoverServers()
      return servers
    } catch (error: unknown) {
      console.error('Error discovering Jellyfin servers:', error)
      throw error
    }
  })

  /**
   * Test a server URL to check if it's a valid Jellyfin server
   */
  ipcMain.handle('jellyfin:testServerUrl', async (_event, url: unknown) => {
    try {
      const validatedUrl = validateInput(SafeUrlSchema, url, 'jellyfin:testServerUrl')
      return await jellyfinDiscovery.testServerUrl(validatedUrl)
    } catch (error: unknown) {
      console.error('Error testing server URL:', error)
      throw error
    }
  })

  // ============================================================================
  // EMBY SERVER DISCOVERY
  // ============================================================================

  /**
   * Discover Emby servers on the local network via UDP broadcast
   */
  ipcMain.handle('emby:discoverServers', async () => {
    try {
      console.log('[IPC] Starting Emby server discovery...')
      const servers = await embyDiscovery.discoverServers()
      return servers
    } catch (error: unknown) {
      console.error('Error discovering Emby servers:', error)
      throw error
    }
  })

  /**
   * Test a server URL to check if it's a valid Emby server
   */
  ipcMain.handle('emby:testServerUrl', async (_event, url: unknown) => {
    try {
      const validatedUrl = validateInput(SafeUrlSchema, url, 'emby:testServerUrl')
      return await embyDiscovery.testServerUrl(validatedUrl)
    } catch (error: unknown) {
      console.error('Error testing Emby server URL:', error)
      throw error
    }
  })

  /**
   * Authenticate with Jellyfin using an API key and create source
   */
  ipcMain.handle('jellyfin:authenticateApiKey', async (
    _event,
    serverUrl: unknown,
    apiKey: unknown,
    displayName: unknown
  ) => {
    try {
      const validated = validateInput(JellyfinApiKeyAuthSchema, {
        serverUrl,
        apiKey,
        displayName,
      }, 'jellyfin:authenticateApiKey')

      const provider = new JellyfinProvider({
        sourceId: undefined, // Will be generated
        sourceType: 'jellyfin',
        displayName: validated.displayName,
        connectionConfig: { serverUrl: validated.serverUrl, apiKey: validated.apiKey },
      })

      // Test the connection with the API key
      const testResult = await provider.testConnection()
      if (!testResult.success) {
        return {
          success: false,
          error: testResult.error || 'Failed to connect with API key',
        }
      }

      // Add the source with the API key
      const source = await manager.addSource({
        sourceType: 'jellyfin',
        displayName: validated.displayName,
        connectionConfig: {
          serverUrl: validated.serverUrl,
          apiKey: validated.apiKey,
        },
      })

      return {
        success: true,
        source,
        serverName: testResult.serverName,
      }
    } catch (error: unknown) {
      console.error('Error authenticating with Jellyfin API key:', error)
      return {
        success: false,
        error: getErrorMessage(error) || 'Authentication failed',
      }
    }
  })

  /**
   * Authenticate with Emby using an API key and create source
   */
  ipcMain.handle('emby:authenticateApiKey', async (
    _event,
    serverUrl: string,
    apiKey: string,
    displayName: string
  ) => {
    try {
      const { EmbyProvider } = await import('../providers/jellyfin-emby/EmbyProvider')

      const provider = new EmbyProvider({
        sourceId: undefined, // Will be generated
        sourceType: 'emby',
        displayName,
        connectionConfig: { serverUrl, apiKey },
      })

      // Test the connection with the API key
      const testResult = await provider.testConnection()
      if (!testResult.success) {
        return {
          success: false,
          error: testResult.error || 'Failed to connect with API key',
        }
      }

      // Add the source with the API key
      const source = await manager.addSource({
        sourceType: 'emby',
        displayName,
        connectionConfig: {
          serverUrl,
          apiKey,
        },
      })

      return {
        success: true,
        source,
        serverName: testResult.serverName,
      }
    } catch (error: unknown) {
      console.error('Error authenticating with Emby API key:', error)
      return {
        success: false,
        error: getErrorMessage(error) || 'Authentication failed',
      }
    }
  })

  // ============================================================================
  // QUICK CONNECT
  // ============================================================================

  /**
   * Check if Quick Connect is enabled for a Jellyfin source
   */
  ipcMain.handle('jellyfin:isQuickConnectEnabled', async (_event, serverUrl: string) => {
    try {
      // Create a temporary provider to check Quick Connect
      const tempProvider = new JellyfinProvider({
        sourceId: 'temp-qc-check',
        sourceType: 'jellyfin',
        displayName: 'Temp',
        connectionConfig: { serverUrl },
      })

      return await tempProvider.isQuickConnectEnabled()
    } catch (error: unknown) {
      console.error('Error checking Quick Connect:', error)
      return false
    }
  })

  /**
   * Initiate Quick Connect - returns code for user to enter in another client
   */
  ipcMain.handle('jellyfin:initiateQuickConnect', async (_event, serverUrl: string) => {
    try {
      const tempProvider = new JellyfinProvider({
        sourceId: 'temp-qc-init',
        sourceType: 'jellyfin',
        displayName: 'Temp',
        connectionConfig: { serverUrl },
      })

      return await tempProvider.initiateQuickConnect()
    } catch (error: unknown) {
      console.error('Error initiating Quick Connect:', error)
      throw error
    }
  })

  /**
   * Check Quick Connect status - poll until authenticated
   */
  ipcMain.handle('jellyfin:checkQuickConnectStatus', async (_event, serverUrl: string, secret: string) => {
    try {
      const tempProvider = new JellyfinProvider({
        sourceId: 'temp-qc-check',
        sourceType: 'jellyfin',
        displayName: 'Temp',
        connectionConfig: { serverUrl },
      })

      return await tempProvider.checkQuickConnectStatus(secret)
    } catch (error: unknown) {
      console.error('Error checking Quick Connect status:', error)
      return { authenticated: false, error: getErrorMessage(error) }
    }
  })

  /**
   * Authenticate with username/password credentials and create source
   */
  ipcMain.handle('jellyfin:authenticateCredentials', async (
    _event,
    serverUrl: string,
    username: string,
    password: string,
    displayName: string,
    isEmby: boolean = false
  ) => {
    try {
      const providerType = isEmby ? 'emby' : 'jellyfin'
      const { EmbyProvider } = await import('../providers/jellyfin-emby/EmbyProvider')

      const ProviderClass = isEmby ? EmbyProvider : JellyfinProvider
      const provider = new ProviderClass({
        sourceId: undefined, // Will be generated
        sourceType: providerType,
        displayName,
        connectionConfig: { serverUrl },
      })

      // Authenticate to get access token
      const authResult = await provider.authenticate({
        serverUrl,
        username,
        password,
      })

      if (!authResult.success) {
        throw new Error(authResult.error || 'Authentication failed')
      }

      // Add the source with the access token (not password)
      const source = await manager.addSource({
        sourceType: providerType,
        displayName,
        connectionConfig: {
          serverUrl,
          accessToken: authResult.token,
          userId: authResult.userId,
        },
      })

      return {
        success: true,
        source,
        userName: authResult.userName,
      }
    } catch (error: unknown) {
      console.error('Error authenticating with credentials:', error)
      return {
        success: false,
        error: getErrorMessage(error) || 'Authentication failed',
      }
    }
  })

  /**
   * Complete Quick Connect authentication and create source
   */
  ipcMain.handle('jellyfin:completeQuickConnect', async (
    _event,
    serverUrl: string,
    secret: string,
    displayName: string
  ) => {
    try {
      const provider = new JellyfinProvider({
        sourceId: undefined, // Will be generated
        sourceType: 'jellyfin',
        displayName,
        connectionConfig: { serverUrl },
      })

      const authResult = await provider.completeQuickConnect(secret)

      if (!authResult.success) {
        throw new Error(authResult.error || 'Quick Connect failed')
      }

      // Add the source with the access token
      const source = await manager.addSource({
        sourceType: 'jellyfin',
        displayName,
        connectionConfig: {
          serverUrl,
          accessToken: authResult.token,
          userId: authResult.userId,
        },
      })

      return {
        success: true,
        source,
        userName: authResult.userName,
      }
    } catch (error: unknown) {
      console.error('Error completing Quick Connect:', error)
      throw error
    }
  })

  console.log('[IPC] Jellyfin handlers registered')
}
