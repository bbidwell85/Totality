import { useState, useEffect } from 'react'
import { Loader2, FolderOpen, Download, Upload, Trash2, AlertTriangle, FileSpreadsheet, X } from 'lucide-react'

interface CSVExportOptions {
  includeUpgrades: boolean
  includeMissingMovies: boolean
  includeMissingEpisodes: boolean
  includeMissingAlbums: boolean
}

export function DataManagementTab() {
  const [dbPath, setDbPath] = useState<string>('')
  const [isLoading, setIsLoading] = useState(true)
  const [isExporting, setIsExporting] = useState(false)
  const [isExportingCSV, setIsExportingCSV] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [isResetting, setIsResetting] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [showCSVExportModal, setShowCSVExportModal] = useState(false)
  const [csvOptions, setCSVOptions] = useState<CSVExportOptions>({
    includeUpgrades: true,
    includeMissingMovies: true,
    includeMissingEpisodes: true,
    includeMissingAlbums: true,
  })
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    loadDbPath()
  }, [])

  const loadDbPath = async () => {
    setIsLoading(true)
    try {
      const path = await window.electronAPI.dbGetPath()
      setDbPath(path)
    } catch (error) {
      console.error('Failed to load database path:', error)
      setDbPath('Unable to load path')
    } finally {
      setIsLoading(false)
    }
  }

  const handleExport = async () => {
    setIsExporting(true)
    setMessage(null)
    try {
      const result = await window.electronAPI.dbExport()
      if (result.cancelled) {
        // User cancelled, no message needed
      } else if (result.success) {
        setMessage({ type: 'success', text: `Database exported to: ${result.path}` })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to export database' })
    } finally {
      setIsExporting(false)
    }
  }

  const handleExportCSV = async () => {
    // Check if at least one option is selected
    if (!csvOptions.includeUpgrades && !csvOptions.includeMissingMovies &&
        !csvOptions.includeMissingEpisodes && !csvOptions.includeMissingAlbums) {
      setMessage({ type: 'error', text: 'Please select at least one section to export' })
      return
    }

    setIsExportingCSV(true)
    setMessage(null)
    try {
      const result = await window.electronAPI.dbExportCSV(csvOptions)
      if (result.cancelled) {
        // User cancelled, no message needed
      } else if (result.success) {
        setMessage({ type: 'success', text: `Working document exported to: ${result.path}` })
        setShowCSVExportModal(false)
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to export CSV' })
    } finally {
      setIsExportingCSV(false)
    }
  }

  const handleImport = async () => {
    setIsImporting(true)
    setMessage(null)
    try {
      const result = await window.electronAPI.dbImport()
      if (result.cancelled) {
        // User cancelled, no message needed
      } else if (result.success) {
        const errorText = result.errors && result.errors.length > 0
          ? ` (${result.errors.length} warnings)`
          : ''
        setMessage({
          type: 'success',
          text: `Imported ${result.imported} records successfully${errorText}. Please restart the app.`
        })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to import database' })
    } finally {
      setIsImporting(false)
    }
  }

  const handleReset = async () => {
    setIsResetting(true)
    setMessage(null)
    try {
      await window.electronAPI.dbReset()
      setMessage({ type: 'success', text: 'Database reset successfully. Please restart the app.' })
      setShowResetConfirm(false)
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to reset database' })
    } finally {
      setIsResetting(false)
    }
  }

  const toggleCSVOption = (key: keyof CSVExportOptions) => {
    setCSVOptions(prev => ({ ...prev, [key]: !prev[key] }))
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      {/* Database Location */}
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Database Location</h3>
          <p className="text-xs text-muted-foreground">
            Your media library data is stored locally on your computer
          </p>
        </div>
        <div className="bg-muted/30 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <FolderOpen className="w-5 h-5 text-muted-foreground flex-shrink-0" />
            <code className="text-xs text-muted-foreground break-all">
              {dbPath}
            </code>
          </div>
        </div>
      </div>

      {/* Working Document Export */}
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Working Document</h3>
          <p className="text-xs text-muted-foreground">
            Export a CSV file tracking items that need upgrades or completion
          </p>
        </div>
        <div className="bg-muted/30 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="w-5 h-5 text-muted-foreground" />
              <div>
                <p className="text-sm">Export Working Document</p>
                <p className="text-xs text-muted-foreground">
                  CSV file with upgrade candidates and missing items
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowCSVExportModal(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            >
              <Download className="w-4 h-4" />
              Export CSV
            </button>
          </div>
        </div>
      </div>

      {/* Full Backup Export/Import */}
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Full Backup</h3>
          <p className="text-xs text-muted-foreground">
            Backup your complete database or transfer it to another computer
          </p>
        </div>
        <div className="bg-muted/30 rounded-lg p-4">
          <div className="flex gap-3">
            <button
              onClick={handleExport}
              disabled={isExporting}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm bg-muted hover:bg-muted/80 rounded-md transition-colors disabled:opacity-50"
            >
              {isExporting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              Export Backup (JSON)
            </button>
            <button
              onClick={handleImport}
              disabled={isImporting}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm bg-muted hover:bg-muted/80 rounded-md transition-colors disabled:opacity-50"
            >
              {isImporting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
              Import Backup
            </button>
          </div>
        </div>
      </div>

      {/* Reset Database */}
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-red-400">Danger Zone</h3>
          <p className="text-xs text-muted-foreground">
            Irreversible actions that affect your data
          </p>
        </div>
        <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-4">
          {showResetConfirm ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-400">
                    Are you sure you want to reset the database?
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    This will permanently delete all your scanned media, quality scores, completeness data, and settings. This action cannot be undone.
                  </p>
                </div>
              </div>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setShowResetConfirm(false)}
                  disabled={isResetting}
                  className="px-4 py-2 text-sm hover:bg-muted rounded-md transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleReset}
                  disabled={isResetting}
                  className="flex items-center gap-2 px-4 py-2 text-sm bg-red-500 text-white rounded-md hover:bg-red-600 transition-colors disabled:opacity-50"
                >
                  {isResetting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                  Yes, Reset Database
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Reset Database</p>
                <p className="text-xs text-muted-foreground">
                  Delete all data and start fresh
                </p>
              </div>
              <button
                onClick={() => setShowResetConfirm(true)}
                className="flex items-center gap-2 px-3 py-1.5 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                Reset
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Status message */}
      {message && (
        <div
          className={`p-4 rounded-lg text-sm ${
            message.type === 'success'
              ? 'bg-green-500/10 border border-green-500/30 text-green-400'
              : 'bg-red-500/10 border border-red-500/30 text-red-400'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* CSV Export Modal */}
      {showCSVExportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background border border-border rounded-lg shadow-xl w-full max-w-md mx-4">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h2 className="text-lg font-semibold">Export Working Document</h2>
              <button
                onClick={() => setShowCSVExportModal(false)}
                className="p-1 hover:bg-muted rounded transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-4 space-y-4">
              <p className="text-sm text-muted-foreground">
                Select what to include in the CSV export:
              </p>

              <div className="space-y-3">
                {/* Upgrade Candidates */}
                <label className="flex items-start gap-3 p-3 bg-muted/30 rounded-lg cursor-pointer hover:bg-muted/50 transition-colors">
                  <input
                    type="checkbox"
                    checked={csvOptions.includeUpgrades}
                    onChange={() => toggleCSVOption('includeUpgrades')}
                    className="mt-0.5 w-4 h-4 rounded border-border"
                  />
                  <div>
                    <p className="text-sm font-medium">Upgrade Candidates</p>
                    <p className="text-xs text-muted-foreground">
                      Movies and TV episodes that need quality upgrades
                    </p>
                  </div>
                </label>

                {/* Missing Movies */}
                <label className="flex items-start gap-3 p-3 bg-muted/30 rounded-lg cursor-pointer hover:bg-muted/50 transition-colors">
                  <input
                    type="checkbox"
                    checked={csvOptions.includeMissingMovies}
                    onChange={() => toggleCSVOption('includeMissingMovies')}
                    className="mt-0.5 w-4 h-4 rounded border-border"
                  />
                  <div>
                    <p className="text-sm font-medium">Missing Movies</p>
                    <p className="text-xs text-muted-foreground">
                      Movies missing from incomplete collections
                    </p>
                  </div>
                </label>

                {/* Missing Episodes */}
                <label className="flex items-start gap-3 p-3 bg-muted/30 rounded-lg cursor-pointer hover:bg-muted/50 transition-colors">
                  <input
                    type="checkbox"
                    checked={csvOptions.includeMissingEpisodes}
                    onChange={() => toggleCSVOption('includeMissingEpisodes')}
                    className="mt-0.5 w-4 h-4 rounded border-border"
                  />
                  <div>
                    <p className="text-sm font-medium">Missing TV Episodes</p>
                    <p className="text-xs text-muted-foreground">
                      Episodes missing from incomplete TV series
                    </p>
                  </div>
                </label>

                {/* Missing Albums */}
                <label className="flex items-start gap-3 p-3 bg-muted/30 rounded-lg cursor-pointer hover:bg-muted/50 transition-colors">
                  <input
                    type="checkbox"
                    checked={csvOptions.includeMissingAlbums}
                    onChange={() => toggleCSVOption('includeMissingAlbums')}
                    className="mt-0.5 w-4 h-4 rounded border-border"
                  />
                  <div>
                    <p className="text-sm font-medium">Missing Albums</p>
                    <p className="text-xs text-muted-foreground">
                      Albums, EPs, and singles missing from artist discographies
                    </p>
                  </div>
                </label>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex gap-3 justify-end p-4 border-t border-border">
              <button
                onClick={() => setShowCSVExportModal(false)}
                className="px-4 py-2 text-sm hover:bg-muted rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleExportCSV}
                disabled={isExportingCSV}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {isExportingCSV ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                Export CSV
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
