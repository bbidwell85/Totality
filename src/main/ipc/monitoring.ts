/**
 * IPC Handlers for Live Monitoring System
 */

import { ipcMain } from 'electron'
import { getLiveMonitoringService } from '../services/LiveMonitoringService'
import { validateInput, MonitoringConfigSchema, SourceIdSchema } from '../validation/schemas'

export function registerMonitoringHandlers(): void {
  const service = getLiveMonitoringService()

  /**
   * Get monitoring configuration
   */
  ipcMain.handle('monitoring:getConfig', async () => {
    try {
      return service.getConfig()
    } catch (error) {
      console.error('[IPC monitoring:getConfig] Error:', error)
      throw error
    }
  })

  /**
   * Update monitoring configuration
   */
  ipcMain.handle('monitoring:setConfig', async (_event, config: unknown) => {
    try {
      const validConfig = validateInput(MonitoringConfigSchema, config, 'monitoring:setConfig')
      await service.setConfig(validConfig)
      return { success: true }
    } catch (error) {
      console.error('[IPC monitoring:setConfig] Error:', error)
      throw error
    }
  })

  /**
   * Start live monitoring
   */
  ipcMain.handle('monitoring:start', async () => {
    try {
      console.log('[IPC monitoring:start] Live monitoring started')
      service.start()
      return { success: true }
    } catch (error) {
      console.error('[IPC monitoring:start] Error:', error)
      throw error
    }
  })

  /**
   * Stop live monitoring
   */
  ipcMain.handle('monitoring:stop', async () => {
    try {
      console.log('[IPC monitoring:stop] Live monitoring stopped')
      service.stop()
      return { success: true }
    } catch (error) {
      console.error('[IPC monitoring:stop] Error:', error)
      throw error
    }
  })

  /**
   * Check if monitoring is currently active
   */
  ipcMain.handle('monitoring:isActive', async () => {
    try {
      return service.isMonitoringActive()
    } catch (error) {
      console.error('[IPC monitoring:isActive] Error:', error)
      throw error
    }
  })

  /**
   * Get monitoring status (for debug panel)
   */
  ipcMain.handle('monitoring:getStatus', async () => {
    try {
      return service.getStatus()
    } catch (error) {
      console.error('[IPC monitoring:getStatus] Error:', error)
      throw error
    }
  })

  /**
   * Force check a specific source immediately
   */
  ipcMain.handle('monitoring:forceCheck', async (_event, sourceId: unknown) => {
    try {
      const validSourceId = validateInput(SourceIdSchema, sourceId, 'monitoring:forceCheck')
      console.log('[IPC monitoring:forceCheck] Manual check for source:', validSourceId)
      const events = await service.forceCheck(validSourceId)
      return events
    } catch (error) {
      console.error('[IPC monitoring:forceCheck] Error:', error)
      throw error
    }
  })

  console.log('[IPC] Monitoring handlers registered')
}
