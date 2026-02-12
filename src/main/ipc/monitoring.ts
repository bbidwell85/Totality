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
    return service.getConfig()
  })

  /**
   * Update monitoring configuration
   */
  ipcMain.handle('monitoring:setConfig', async (_event, config: unknown) => {
    const validConfig = validateInput(MonitoringConfigSchema, config, 'monitoring:setConfig')
    await service.setConfig(validConfig)
    return { success: true }
  })

  /**
   * Start live monitoring
   */
  ipcMain.handle('monitoring:start', async () => {
    service.start()
    return { success: true }
  })

  /**
   * Stop live monitoring
   */
  ipcMain.handle('monitoring:stop', async () => {
    service.stop()
    return { success: true }
  })

  /**
   * Check if monitoring is currently active
   */
  ipcMain.handle('monitoring:isActive', async () => {
    return service.isMonitoringActive()
  })

  /**
   * Get monitoring status (for debug panel)
   */
  ipcMain.handle('monitoring:getStatus', async () => {
    return service.getStatus()
  })

  /**
   * Force check a specific source immediately
   */
  ipcMain.handle('monitoring:forceCheck', async (_event, sourceId: unknown) => {
    const validSourceId = validateInput(SourceIdSchema, sourceId, 'monitoring:forceCheck')
    const events = await service.forceCheck(validSourceId)
    return events
  })

  console.log('[IPC] Monitoring handlers registered')
}
