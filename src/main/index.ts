import { app, BrowserWindow, ipcMain, protocol, net } from 'electron'
import path from 'node:path'
import * as fs from 'fs'

// Disable hardware acceleration to prevent GPU process crashes on some systems
// This uses software rendering instead, which is fine for a media library app
app.disableHardwareAcceleration()

// Register custom protocol for serving local artwork files
// Must be registered before app is ready
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local-artwork',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
])
import { getDatabaseServiceAsync, getDatabaseServiceSync, getDatabaseBackend } from './database/DatabaseFactory'
import { getSourceManager } from './services/SourceManager'
import { registerDatabaseHandlers } from './ipc/database'
import { registerQualityHandlers } from './ipc/quality'
import { registerSeriesHandlers } from './ipc/series'
import { registerCollectionHandlers } from './ipc/collections'
import { registerSourceHandlers } from './ipc/sources'
import { registerJellyfinHandlers } from './ipc/jellyfin'
import { registerMusicHandlers } from './ipc/music'
import { registerWishlistHandlers } from './ipc/wishlist'
import { registerMonitoringHandlers } from './ipc/monitoring'
import { registerTaskQueueHandlers } from './ipc/taskQueue'
import { registerLoggingHandlers } from './ipc/logging'
import { getLiveMonitoringService } from './services/LiveMonitoringService'
import { getTaskQueueService } from './services/TaskQueueService'
import { getLoggingService } from './services/LoggingService'

// __dirname is provided by CommonJS/Node
declare const __dirname: string

// Crash handlers - ensure database integrity on unexpected errors
// With better-sqlite3 (WAL mode): data is auto-persisted, forceSave() just checkpoints WAL
// With SQL.js: forceSave() writes in-memory database to disk
process.on('uncaughtException', async (error) => {
  console.error('[CRASH] Uncaught exception:', error)
  try {
    const db = getDatabaseServiceSync()
    if (db.isInitialized) {
      const backend = getDatabaseBackend()
      if (backend === 'sql.js') {
        await db.forceSave()
        console.log('[CRASH] SQL.js database saved before exit')
      } else {
        console.log('[CRASH] better-sqlite3 data already persisted (WAL mode)')
      }
    }
  } catch (e) {
    console.error('[CRASH] Failed to checkpoint database:', e)
  }
  process.exit(1)
})

process.on('unhandledRejection', async (reason, promise) => {
  console.error('[CRASH] Unhandled rejection at:', promise, 'reason:', reason)
  try {
    const db = getDatabaseServiceSync()
    if (db.isInitialized) {
      const backend = getDatabaseBackend()
      if (backend === 'sql.js') {
        await db.forceSave()
        console.log('[CRASH] SQL.js database saved after unhandled rejection')
      }
      // better-sqlite3: no action needed, WAL mode auto-persists
    }
  } catch (e) {
    console.error('[CRASH] Failed to checkpoint database:', e)
  }
  // Don't exit on unhandled rejection - log and continue
})

// The built directory structure:
// ├─┬ dist                    <- renderer build output
// │ └── index.html
// │
// ├─┬ dist-electron
// │ ├─┬ main
// │ │ └── index.cjs           <- this file at runtime
// │ └─┬ preload
// │   └── index.cjs
//
const DIST = path.join(__dirname, '../../dist')
const VITE_PUBLIC = app.isPackaged
  ? DIST
  : path.join(__dirname, '../../src/renderer/public')

process.env.DIST = DIST
process.env.VITE_PUBLIC = VITE_PUBLIC

let win: BrowserWindow | null = null
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1000,
    minHeight: 600,
    icon: path.join(VITE_PUBLIC, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'default',
    frame: true,
    backgroundColor: '#14151a', // Match app's dark background
    show: false, // Don't show until ready
  })

  // Show window when React signals it's ready (via IPC)
  const fallbackTimer = setTimeout(() => win?.show(), 3000)
  ipcMain.once('app:ready', () => {
    clearTimeout(fallbackTimer)
    win?.show()
  })

  // App version handler
  ipcMain.handle('app:getVersion', () => app.getVersion())

  // Disable default menu
  win.removeMenu()

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(DIST, 'index.html'))
  }

  // Only open DevTools in development mode (docked to prevent window close issues)
  if (!app.isPackaged) {
    win.webContents.openDevTools({ mode: 'bottom' })
  }
}

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', async () => {
  if (process.platform !== 'darwin') {
    // Close database before quitting
    const db = getDatabaseServiceSync()
    await db.close()
    app.quit()
    win = null
  }
})

// Before quit, close database
app.on('before-quit', async (event) => {
  event.preventDefault()

  // Close database
  const db = getDatabaseServiceSync()
  await db.close()

  app.exit()
})

app.on('activate', () => {
  // On macOS, re-create window when dock icon is clicked and no other windows are open
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(async () => {
  try {
    // Initialize logging first (before other services so their logs are captured)
    getLoggingService().initialize()

    // Register local-artwork protocol handler for serving local album artwork
    const userDataPath = app.getPath('userData')
    const artworkBasePath = path.join(userDataPath, 'artwork')

    protocol.handle('local-artwork', (request) => {
      const url = new URL(request.url)

      // Check if this is a direct file path request
      // URL format: local-artwork://file?path=C:\path\to\file.jpg
      if (url.hostname === 'file') {
        const filePath = url.searchParams.get('path')
        if (filePath && fs.existsSync(filePath)) {
          // Handle Windows UNC paths
          if (filePath.startsWith('\\\\')) {
            return net.fetch(`file:${filePath.replace(/\\/g, '/')}`)
          }
          // Handle Windows drive letters
          if (/^[A-Za-z]:/.test(filePath)) {
            return net.fetch(`file:///${filePath.replace(/\\/g, '/')}`)
          }
          // Handle Unix paths
          return net.fetch(`file://${filePath}`)
        }
        return new Response('Not found', { status: 404 })
      }

      // Standard app-cached artwork
      // URL format: local-artwork://albums/123.jpg
      // SECURITY: Prevent path traversal attacks by validating the resolved path
      const urlPath = url.pathname.replace(/^\/+/, '') // Remove leading slashes
      const normalizedPath = path.normalize(urlPath)

      // Block any path traversal attempts (../ sequences)
      if (normalizedPath.startsWith('..') || path.isAbsolute(normalizedPath)) {
        console.warn('[Security] Blocked path traversal attempt:', urlPath)
        return new Response('Forbidden', { status: 403 })
      }

      const filePath = path.resolve(artworkBasePath, normalizedPath)

      // Ensure resolved path is within the artwork directory
      if (!filePath.startsWith(artworkBasePath + path.sep) && filePath !== artworkBasePath) {
        console.warn('[Security] Blocked path escape attempt:', urlPath)
        return new Response('Forbidden', { status: 403 })
      }

      // Check if file exists
      if (fs.existsSync(filePath)) {
        // Handle Windows paths for file:// URL
        if (process.platform === 'win32') {
          return net.fetch(`file:///${filePath.replace(/\\/g, '/')}`)
        }
        return net.fetch(`file://${filePath}`)
      }

      // Return a 404-like response
      return new Response('Not found', { status: 404 })
    })
    console.log('Local artwork protocol registered')

    // Initialize database (auto-migrates from SQL.js to better-sqlite3 if needed)
    const db = await getDatabaseServiceAsync()
    await db.initialize()
    console.log(`Database initialized successfully (backend: ${getDatabaseBackend()})`)

    // Initialize source manager (loads providers from database)
    const sourceManager = getSourceManager()
    await sourceManager.initialize()
    console.log('Source manager initialized successfully')

    // Register IPC handlers
    registerDatabaseHandlers()
    registerQualityHandlers()
    registerSeriesHandlers()
    registerCollectionHandlers()
    registerSourceHandlers()
    registerJellyfinHandlers()
    registerMusicHandlers()
    registerWishlistHandlers()
    registerMonitoringHandlers()
    registerTaskQueueHandlers()
    registerLoggingHandlers()

    // Initialize live monitoring service
    const liveMonitoringService = getLiveMonitoringService()
    await liveMonitoringService.initialize()

    // Create main window
    createWindow()

    // Initialize task queue service
    const taskQueueService = getTaskQueueService()
    console.log('Task queue service initialized')

    // Set main window reference for services
    if (win) {
      liveMonitoringService.setMainWindow(win)
      taskQueueService.setMainWindow(win)
      getLoggingService().setMainWindow(win)
    }

  } catch (error) {
    console.error('Failed to initialize app:', error)
    app.quit()
  }
})
