import { app, BrowserWindow, ipcMain, protocol, net, dialog, Tray, Menu, nativeImage, session } from 'electron'
import path from 'node:path'
import * as fs from 'fs'

// Disable Chromium SUID sandbox on Linux — the AppImage can't set root ownership
// on chrome-sandbox. Electron's contextIsolation still provides process security.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox')
}

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
import { registerAutoUpdateHandlers } from './ipc/autoUpdate'
import { getLiveMonitoringService } from './services/LiveMonitoringService'
import { getTaskQueueService } from './services/TaskQueueService'
import { getLoggingService } from './services/LoggingService'
import { getAutoUpdateService } from './services/AutoUpdateService'
import { getWishlistCompletionService } from './services/WishlistCompletionService'

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
let tray: Tray | null = null
let isQuitting = false
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
      spellcheck: false,
      enableWebSQL: false,
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

  // Minimize to tray: intercept close to hide instead of quit
  win.on('close', (event) => {
    if (isQuitting) return

    const db = getDatabaseServiceSync()
    const minimizeToTray = db.isInitialized ? db.getSetting('minimize_to_tray') : null

    if (minimizeToTray === 'true') {
      event.preventDefault()
      win?.hide()
    }
  })

  // Content Security Policy — defense-in-depth against XSS
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const isDev = !!VITE_DEV_SERVER_URL
    const csp = [
      "default-src 'self'",
      // unsafe-inline needed for Tailwind; unsafe-eval needed for Vite HMR in dev
      `style-src 'self' 'unsafe-inline'`,
      `script-src 'self'${isDev ? " 'unsafe-inline' 'unsafe-eval'" : ''}`,
      // TMDB posters, provider artwork, local-artwork protocol, data URIs
      "img-src 'self' https: local-artwork: data:",
      // API calls to Plex, Jellyfin, Emby, TMDB, MusicBrainz; ws: for Vite HMR in dev
      `connect-src 'self' https: http:${isDev ? ' ws:' : ''}`,
      "font-src 'self' data:",
    ]
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp.join('; ')],
      },
    })
  })

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

function createTray() {
  const iconPath = path.join(VITE_PUBLIC, 'icon.png')
  const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
  tray = new Tray(trayIcon)
  tray.setToolTip('Totality')

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show Totality', click: () => { win?.show(); win?.focus() } },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit() } },
  ])
  tray.setContextMenu(contextMenu)

  tray.on('click', () => {
    if (win?.isVisible()) {
      win.hide()
    } else {
      win?.show()
      win?.focus()
    }
  })
}

// Guard against double database close from concurrent quit events
let isClosing = false

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', async () => {
  if (process.platform !== 'darwin' && !isClosing) {
    isClosing = true
    const db = getDatabaseServiceSync()
    await db.close()
    app.quit()
    win = null
  }
})

// Before quit, close database and cleanup services
app.on('before-quit', async (event) => {
  isQuitting = true
  if (isClosing) return
  event.preventDefault()
  isClosing = true

  // Cleanup auto-update timers
  getAutoUpdateService().cleanup()

  // Flush log buffer to disk
  await getLoggingService().shutdown()

  // Persist any in-flight tasks as interrupted
  getTaskQueueService().persistInterruptedTasks()

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
        if (!filePath) return new Response('Not found', { status: 404 })

        // SECURITY: Only allow image file extensions to prevent arbitrary file reads
        const ext = path.extname(filePath).toLowerCase()
        const ALLOWED_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff'])
        if (!ALLOWED_IMAGE_EXTS.has(ext)) {
          console.warn('[Security] Blocked non-image file request:', filePath)
          return new Response('Forbidden', { status: 403 })
        }

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
      // Use realpathSync to resolve symlinks before comparison
      let realFilePath: string
      try {
        realFilePath = fs.existsSync(filePath) ? fs.realpathSync(filePath) : filePath
      } catch {
        return new Response('Forbidden', { status: 403 })
      }
      const realBasePath = fs.existsSync(artworkBasePath) ? fs.realpathSync(artworkBasePath) : artworkBasePath
      if (!realFilePath.startsWith(realBasePath + path.sep) && realFilePath !== realBasePath) {
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

    // Initialize file-based logging (requires database for settings)
    await getLoggingService().initializeFileLogging()

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
    registerAutoUpdateHandlers()

    // Initialize live monitoring service
    const liveMonitoringService = getLiveMonitoringService()
    await liveMonitoringService.initialize()

    // Create main window and system tray
    createWindow()
    createTray()

    // Handle "start minimized to tray" setting
    const startMinimized = db.getSetting('start_minimized_to_tray')
    if (startMinimized === 'true' && db.getSetting('minimize_to_tray') === 'true') {
      win?.hide()
    }

    // Initialize task queue service and load persisted history
    const taskQueueService = getTaskQueueService()
    taskQueueService.loadPersistedHistory()
    console.log('Task queue service initialized')

    // Initialize auto-update service
    const autoUpdateService = getAutoUpdateService()
    autoUpdateService.initialize()

    // Set main window reference for services
    if (win) {
      liveMonitoringService.setMainWindow(win)
      taskQueueService.setMainWindow(win)
      getLoggingService().setMainWindow(win)
      autoUpdateService.setMainWindow(win)
      getWishlistCompletionService().setMainWindow(win)
    }

  } catch (error) {
    console.error('Failed to initialize app:', error)
    dialog.showErrorBox('Startup Error', `Totality failed to start:\n\n${error instanceof Error ? error.message : String(error)}`)
    app.quit()
  }
})
