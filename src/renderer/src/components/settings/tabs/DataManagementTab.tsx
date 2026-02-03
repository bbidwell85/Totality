/**
 * DataManagementTab - Settings tab for database and export management
 *
 * Features:
 * - Database location display
 * - Working document CSV export
 * - Full database backup/restore
 * - Database reset (danger zone)
 */

import { useState, useEffect } from 'react'
import { Loader2, FolderOpen, Download, Upload, Trash2, AlertTriangle, FileSpreadsheet, X, Database, RefreshCw } from 'lucide-react'

interface CSVExportOptions {
  includeUpgrades: boolean
  includeMissingMovies: boolean
  includeMissingEpisodes: boolean
  includeMissingAlbums: boolean
}

// Toggle switch component (matching MonitoringTab)
function Toggle({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
      } ${checked ? 'bg-primary' : 'bg-muted'}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-background shadow-md ring-1 ring-border/50 transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )
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
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-5">
      {/* Database Location Section */}
      <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg border border-border/40">
        <div className="flex items-center gap-3">
          <Database className="w-7 h-7 text-primary" />
          <div>
            <h3 className="text-sm font-medium text-foreground">Database Location</h3>
            <p className="text-xs text-muted-foreground break-all max-w-[280px]">
              {dbPath}
            </p>
          </div>
        </div>
        <button
          onClick={() => navigator.clipboard.writeText(dbPath)}
          className="px-3 py-1.5 text-xs bg-muted hover:bg-muted/80 rounded-md transition-colors"
        >
          Copy Path
        </button>
      </div>

      {/* Export Options */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">Export Options</h3>

        <div className="bg-muted/30 rounded-lg border border-border/40 divide-y divide-border/30">
          {/* Working Document */}
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="w-5 h-5 text-muted-foreground" />
              <div>
                <span className="text-sm text-foreground">Working Document</span>
                <p className="text-xs text-muted-foreground">
                  CSV with upgrade candidates and missing items
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowCSVExportModal(true)}
              className="flex items-center gap-2 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Export
            </button>
          </div>

          {/* Full Backup */}
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <FolderOpen className="w-5 h-5 text-muted-foreground" />
              <div>
                <span className="text-sm text-foreground">Full Backup</span>
                <p className="text-xs text-muted-foreground">
                  Complete database backup (JSON)
                </p>
              </div>
            </div>
            <button
              onClick={handleExport}
              disabled={isExporting}
              className="flex items-center gap-2 px-3 py-1.5 text-xs bg-muted hover:bg-muted/80 rounded-md transition-colors disabled:opacity-50"
            >
              {isExporting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              Export
            </button>
          </div>
        </div>
      </div>

      {/* Import Options */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">Import</h3>

        <div className="bg-muted/30 rounded-lg border border-border/40">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <Upload className="w-5 h-5 text-muted-foreground" />
              <div>
                <span className="text-sm text-foreground">Restore Backup</span>
                <p className="text-xs text-muted-foreground">
                  Import a previously exported database
                </p>
              </div>
            </div>
            <button
              onClick={handleImport}
              disabled={isImporting}
              className="flex items-center gap-2 px-3 py-1.5 text-xs bg-muted hover:bg-muted/80 rounded-md transition-colors disabled:opacity-50"
            >
              {isImporting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Upload className="w-3.5 h-3.5" />
              )}
              Import
            </button>
          </div>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-red-400">Danger Zone</h3>

        <div className="bg-red-500/5 rounded-lg border border-red-500/20">
          {showResetConfirm ? (
            <div className="p-4 space-y-4">
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
                  className="px-3 py-1.5 text-xs hover:bg-muted rounded-md transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleReset}
                  disabled={isResetting}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs bg-red-500 text-white rounded-md hover:bg-red-600 transition-colors disabled:opacity-50"
                >
                  {isResetting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5" />
                  )}
                  Yes, Reset Database
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                <Trash2 className="w-5 h-5 text-red-400" />
                <div>
                  <span className="text-sm text-foreground">Reset Database</span>
                  <p className="text-xs text-muted-foreground">
                    Delete all data and start fresh
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowResetConfirm(true)}
                className="flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-md transition-colors"
              >
                Reset
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Status message */}
      {message && (
        <div
          className={`p-3 rounded-lg text-xs ${
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
              <h2 className="text-base font-medium">Export Working Document</h2>
              <button
                onClick={() => setShowCSVExportModal(false)}
                className="p-1 hover:bg-muted rounded transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-4 space-y-3">
              <p className="text-xs text-muted-foreground">
                Select what to include in the CSV export:
              </p>

              <div className="bg-muted/30 rounded-lg border border-border/40 divide-y divide-border/30">
                {/* Upgrade Candidates */}
                <div className="flex items-center justify-between px-4 py-2.5">
                  <div>
                    <span className="text-sm text-foreground">Upgrade Candidates</span>
                    <p className="text-xs text-muted-foreground">
                      Movies and episodes that need quality upgrades
                    </p>
                  </div>
                  <Toggle
                    checked={csvOptions.includeUpgrades}
                    onChange={() => toggleCSVOption('includeUpgrades')}
                  />
                </div>

                {/* Missing Movies */}
                <div className="flex items-center justify-between px-4 py-2.5">
                  <div>
                    <span className="text-sm text-foreground">Missing Movies</span>
                    <p className="text-xs text-muted-foreground">
                      Movies missing from incomplete collections
                    </p>
                  </div>
                  <Toggle
                    checked={csvOptions.includeMissingMovies}
                    onChange={() => toggleCSVOption('includeMissingMovies')}
                  />
                </div>

                {/* Missing Episodes */}
                <div className="flex items-center justify-between px-4 py-2.5">
                  <div>
                    <span className="text-sm text-foreground">Missing TV Episodes</span>
                    <p className="text-xs text-muted-foreground">
                      Episodes missing from incomplete TV series
                    </p>
                  </div>
                  <Toggle
                    checked={csvOptions.includeMissingEpisodes}
                    onChange={() => toggleCSVOption('includeMissingEpisodes')}
                  />
                </div>

                {/* Missing Albums */}
                <div className="flex items-center justify-between px-4 py-2.5">
                  <div>
                    <span className="text-sm text-foreground">Missing Albums</span>
                    <p className="text-xs text-muted-foreground">
                      Albums missing from artist discographies
                    </p>
                  </div>
                  <Toggle
                    checked={csvOptions.includeMissingAlbums}
                    onChange={() => toggleCSVOption('includeMissingAlbums')}
                  />
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex gap-3 justify-end p-4 border-t border-border">
              <button
                onClick={() => setShowCSVExportModal(false)}
                className="px-3 py-1.5 text-xs hover:bg-muted rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleExportCSV}
                disabled={isExportingCSV}
                className="flex items-center gap-2 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {isExportingCSV ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
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
