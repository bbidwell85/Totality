import { getErrorMessage } from './utils/errorUtils'
/**
 * EmbyDiscoveryService
 *
 * Handles automatic discovery of Emby servers on the local network
 * using UDP broadcast on port 7359.
 *
 * Protocol: Send "who is EmbyServer?" to broadcast address,
 * servers respond with JSON containing address, ID, and name.
 */

import * as dgram from 'dgram'
import axios from 'axios'

export interface DiscoveredEmbyServer {
  id: string
  name: string
  address: string
  endpointAddress?: string
  localAddress?: string
}

const DISCOVERY_PORT = 7359
const DISCOVERY_MESSAGE = 'who is EmbyServer?'
const DISCOVERY_TIMEOUT = 3000 // 3 seconds

export class EmbyDiscoveryService {
  /**
   * Discover Emby servers on the local network using UDP broadcast
   */
  async discoverServers(): Promise<DiscoveredEmbyServer[]> {
    return new Promise((resolve) => {
      const servers: DiscoveredEmbyServer[] = []
      const seenIds = new Set<string>()

      let socket: dgram.Socket | null = null

      try {
        socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })

        socket.on('message', (msg, rinfo) => {
          try {
            const response = JSON.parse(msg.toString())

            // Emby responds with: { Id, Name, Address, EndpointAddress? }
            if (response.Id && response.Name && !seenIds.has(response.Id)) {
              seenIds.add(response.Id)

              servers.push({
                id: response.Id,
                name: response.Name,
                address: response.Address || `http://${rinfo.address}:8096`,
                endpointAddress: response.EndpointAddress,
                localAddress: response.LocalAddress,
              })

              console.log(`[EmbyDiscovery] Found server: ${response.Name} at ${response.Address || rinfo.address}`)
            }
          } catch (e) {
            // Ignore invalid responses
            console.debug('[EmbyDiscovery] Invalid response:', msg.toString().substring(0, 100))
          }
        })

        socket.on('error', (err) => {
          console.error('[EmbyDiscovery] Socket error:', err.message)
        })

        socket.bind(() => {
          try {
            socket!.setBroadcast(true)

            // Send to broadcast address
            const message = Buffer.from(DISCOVERY_MESSAGE)

            // Try multiple broadcast addresses
            const broadcastAddresses = ['255.255.255.255', '192.168.255.255', '192.168.1.255', '10.255.255.255']

            for (const addr of broadcastAddresses) {
              try {
                socket!.send(message, 0, message.length, DISCOVERY_PORT, addr)
              } catch (e) {
                // Ignore errors for specific addresses
              }
            }

            console.log('[EmbyDiscovery] Broadcast sent, waiting for responses...')
          } catch (e) {
            console.error('[EmbyDiscovery] Failed to send broadcast:', e)
          }
        })

        // Wait for responses then close
        setTimeout(() => {
          try {
            socket?.close()
          } catch (e) {
            // Ignore close errors
          }
          console.log(`[EmbyDiscovery] Discovery complete, found ${servers.length} server(s)`)
          resolve(servers)
        }, DISCOVERY_TIMEOUT)

      } catch (err) {
        console.error('[EmbyDiscovery] Failed to create socket:', err)
        resolve(servers)
      }
    })
  }

  /**
   * Test if a specific server URL is reachable and get its info
   */
  async testServerUrl(url: string): Promise<{
    success: boolean
    serverName?: string
    serverId?: string
    version?: string
    error?: string
  }> {
    try {

      // Emby uses /emby prefix for API calls
      const response = await axios.get(`${url.replace(/\/$/, '')}/emby/System/Info/Public`, {
        timeout: 5000,
        headers: { Accept: 'application/json' },
      })

      return {
        success: true,
        serverName: response.data.ServerName,
        serverId: response.data.Id,
        version: response.data.Version,
      }
    } catch (error: unknown) {
      // Fallback: try without /emby prefix (some Emby setups)
      try {
  
        const response = await axios.get(`${url.replace(/\/$/, '')}/System/Info/Public`, {
          timeout: 5000,
          headers: { Accept: 'application/json' },
        })

        return {
          success: true,
          serverName: response.data.ServerName,
          serverId: response.data.Id,
          version: response.data.Version,
        }
      } catch {
        return {
          success: false,
          error: getErrorMessage(error) || 'Failed to connect',
        }
      }
    }
  }
}

// Singleton
let instance: EmbyDiscoveryService | null = null

export function getEmbyDiscoveryService(): EmbyDiscoveryService {
  if (!instance) {
    instance = new EmbyDiscoveryService()
  }
  return instance
}
