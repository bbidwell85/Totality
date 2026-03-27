/**
 * MediaMonkeyConnectionFlow Component
 *
 * Handles connection to MediaMonkey:
 * - Auto-detects local MM4/MM5 installation
 * - Allows manual database path selection
 * - Music-only source
 */

import { useState, useEffect } from 'react'
import { Music, CheckCircle2, AlertCircle, Loader2, FolderOpen } from 'lucide-react'
import { useSources } from '../../contexts/SourceContext'

interface MediaMonkeyConnectionFlowProps {
  onSuccess: () => void
  onBack: () => void
}

interface MMInstallation {
  version: 4 | 5
  databasePath: string
  exists: boolean
}

type FlowMode = 'detecting' | 'configure' | 'success'

export function MediaMonkeyConnectionFlow({ onSuccess, onBack }: MediaMonkeyConnectionFlowProps) {
  const { addSource, testConnection, refreshSources } = useSources()

  const [mode, setMode] = useState<FlowMode>('detecting')
  const [installations, setInstallations] = useState<MMInstallation[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [selectedPath, setSelectedPath] = useState('')
  const [selectedVersion, setSelectedVersion] = useState<4 | 5>(5)
  const [displayName, setDisplayName] = useState('MediaMonkey')
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Auto-detect on mount
  useEffect(() => {
    detectMediaMonkey()
  }, [])

  const detectMediaMonkey = async () => {
    try {
      const result = await window.electronAPI.mediamonkeyDetectLocal()
      if (result) {
        setInstallations(result.installations)
        setIsRunning(result.isRunning)

        // Auto-select the first found installation (prefer MM5 over MM4)
        const found = result.installations.filter(i => i.exists)
        const preferred = found.find(i => i.version === 5) || found[0]
        if (preferred) {
          setSelectedPath(preferred.databasePath)
          setSelectedVersion(preferred.version)
          setDisplayName(`MediaMonkey ${preferred.version}`)
        }
      }
      setMode('configure')
    } catch (err) {
      console.error('Error detecting MediaMonkey:', err)
      setMode('configure')
    }
  }

  const handleConnect = async () => {
    if (!selectedPath) {
      setError('Please select a database path')
      return
    }

    setError(null)
    setIsConnecting(true)

    try {
      // Add the source
      const source = await addSource({
        sourceType: 'mediamonkey',
        displayName: displayName || 'MediaMonkey',
        connectionConfig: {
          mediamonkeyDatabasePath: selectedPath,
          mediamonkeyVersion: selectedVersion,
        },
      })

      if (!source) {
        throw new Error('Failed to create source')
      }

      // Test the connection
      const testResult = await testConnection(source.source_id)
      if (!testResult.success) {
        throw new Error(testResult.error || 'Connection test failed')
      }

      // Queue initial scan
      await window.electronAPI.taskQueueAddTask({
        type: 'music-scan',
        label: `Scan ${displayName || 'MediaMonkey'}`,
        sourceId: source.source_id,
        libraryId: 'music',
      })

      await refreshSources()
      setMode('success')

      // Auto-close after a moment
      setTimeout(() => {
        onSuccess()
      }, 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed')
    } finally {
      setIsConnecting(false)
    }
  }

  const handleBrowse = async () => {
    try {
      const result = await window.electronAPI.mediamonkeySelectDatabase()
      if (result) {
        setSelectedPath(result)
        // Auto-detect version from filename
        if (result.includes('MM5')) {
          setSelectedVersion(5)
        } else {
          setSelectedVersion(4)
        }
      }
    } catch {
      // Dialog cancelled
    }
  }

  // Detecting state
  if (mode === 'detecting') {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--color-accent)]" />
        <p className="mt-4 text-[var(--color-text-secondary)]">Detecting MediaMonkey installation...</p>
      </div>
    )
  }

  // Success state
  if (mode === 'success') {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <CheckCircle2 className="w-12 h-12 text-green-500" />
        <h3 className="mt-4 text-lg font-medium text-[var(--color-text)]">Connected to MediaMonkey!</h3>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">Initial scan has been queued.</p>
      </div>
    )
  }

  // Configure state
  const foundInstallations = installations.filter(i => i.exists)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center">
          <Music className="w-5 h-5 text-orange-400" />
        </div>
        <div>
          <h3 className="text-lg font-medium text-[var(--color-text)]">Connect MediaMonkey</h3>
          <p className="text-sm text-[var(--color-text-secondary)]">Read your MediaMonkey music library</p>
        </div>
      </div>

      {/* Running warning */}
      {isRunning && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
          <AlertCircle className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" />
          <p className="text-sm text-yellow-300">
            MediaMonkey is currently running. The database may be locked. Close MediaMonkey first for best results.
          </p>
        </div>
      )}

      {/* Auto-detected installations */}
      {foundInstallations.length > 0 && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-[var(--color-text-secondary)]">Detected Installations</label>
          <div className="space-y-2">
            {foundInstallations.map((inst) => (
              <button
                key={inst.version}
                onClick={() => {
                  setSelectedPath(inst.databasePath)
                  setSelectedVersion(inst.version)
                  setDisplayName(`MediaMonkey ${inst.version}`)
                }}
                className={`w-full text-left p-3 rounded-lg border transition-colors ${
                  selectedPath === inst.databasePath
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10'
                    : 'border-[var(--color-border)] hover:border-[var(--color-border-hover)]'
                }`}
              >
                <div className="font-medium text-[var(--color-text)]">MediaMonkey {inst.version}</div>
                <div className="text-xs text-[var(--color-text-secondary)] mt-1 truncate">{inst.databasePath}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Manual path selection */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-[var(--color-text-secondary)]">
          {foundInstallations.length > 0 ? 'Or select manually' : 'Database Path'}
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={selectedPath}
            onChange={(e) => setSelectedPath(e.target.value)}
            placeholder="Path to MM.DB or MM5.DB"
            className="flex-1 px-3 py-2 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-[var(--color-text)] text-sm placeholder-[var(--color-text-tertiary)]"
          />
          <button
            onClick={handleBrowse}
            className="px-3 py-2 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)] hover:border-[var(--color-border-hover)] text-[var(--color-text-secondary)]"
          >
            <FolderOpen className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Display name */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-[var(--color-text-secondary)]">Display Name</label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
        />
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
          <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-between pt-2">
        <button
          onClick={onBack}
          className="px-4 py-2 rounded-lg text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
        >
          Back
        </button>
        <button
          onClick={handleConnect}
          disabled={isConnecting || !selectedPath}
          className="px-6 py-2 rounded-lg text-sm font-medium bg-[var(--color-accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {isConnecting && <Loader2 className="w-4 h-4 animate-spin" />}
          {isConnecting ? 'Connecting...' : 'Connect'}
        </button>
      </div>
    </div>
  )
}
