/**
 * AutomationTab - Arr apps (Radarr/Sonarr/Lidarr) + external sync (Trakt/Letterboxd) + Release Alerts
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { SETTING_KEYS } from '../../../../../shared/settingKeys'
import {
  Eye, EyeOff, Loader2, CheckCircle, XCircle, Trash2, Download,
  RefreshCw, ChevronDown, Film, Circle,
} from 'lucide-react'

interface ServiceCardProps {
  title: string
  description: string
  icon: React.ReactNode
  status: 'configured' | 'partial' | 'not-configured'
  statusText: string
  expanded: boolean
  onToggle: () => void
  children: React.ReactNode
  enableToggle?: { enabled: boolean; onToggle: () => void; id: string }
}

function ServiceCard({ title, description, icon, status, statusText, expanded, onToggle, children, enableToggle }: ServiceCardProps) {
  return (
    <div className="border border-border/40 rounded-lg overflow-hidden bg-card/30">
      <div className="flex items-center gap-3 p-4 hover:bg-muted/30 transition-colors">
        <button onClick={onToggle} className="flex items-center gap-3 flex-1 min-w-0 text-left">
          <div className="shrink-0">
            {status === 'configured' ? <CheckCircle className="w-5 h-5 text-green-500" /> :
             status === 'partial' ? <CheckCircle className="w-5 h-5 text-amber-500" /> :
             <Circle className="w-5 h-5 text-muted-foreground/50" />}
          </div>
          <div className="shrink-0 text-muted-foreground">{icon}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">{title}</span>
              <span className="text-xs text-muted-foreground">{statusText}</span>
            </div>
            <p className="text-xs text-muted-foreground truncate">{description}</p>
          </div>
        </button>
        {enableToggle && (
          <button id={enableToggle.id} role="switch" aria-checked={enableToggle.enabled}
            onClick={(e) => { e.stopPropagation(); enableToggle.onToggle() }}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors focus:outline-hidden focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background ${enableToggle.enabled ? 'bg-primary' : 'bg-muted'}`}>
            <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-background shadow-md ring-1 ring-border/50 transition ${enableToggle.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        )}
        <button onClick={onToggle} className="p-1 shrink-0">
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {expanded && <div className="px-4 pb-4 pt-2 border-t border-border/30 bg-muted/10">{children}</div>}
    </div>
  )
}

type ArrType = 'radarr' | 'sonarr' | 'lidarr'

const ARR_META: Record<ArrType, { label: string; description: string }> = {
  radarr: { label: 'Radarr', description: 'Automated movie upgrade and download management' },
  sonarr: { label: 'Sonarr', description: 'Automated TV series upgrade and download management' },
  lidarr: { label: 'Lidarr', description: 'Automated music upgrade and download management' },
}

function ArrServiceCard({ type, expanded, onToggle }: { type: ArrType; expanded: boolean; onToggle: () => void }) {
  const [url, setUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [status, setStatus] = useState<'idle' | 'testing' | 'valid' | 'invalid'>('idle')
  const [version, setVersion] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [profiles, setProfiles] = useState<Array<{ id: number; name: string }>>([])
  const [rootFolders, setRootFolders] = useState<Array<{ id: number; path: string }>>([])
  const [profileId, setProfileId] = useState('')
  const [rootFolder, setRootFolder] = useState('')
  const [savedField, setSavedField] = useState<'profile' | 'folder' | null>(null)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { label } = ARR_META[type]

  useEffect(() => {
    const load = async () => {
      try {
        const all = await window.electronAPI.getAllSettings()
        const savedUrl = all[`${type}_url`] || ''
        const savedKey = all[`${type}_api_key`] || ''
        setUrl(savedUrl); setApiKey(savedKey)
        setProfileId(all[`${type}_quality_profile_id`] || '')
        setRootFolder(all[`${type}_root_folder`] || '')
        if (savedUrl && savedKey) {
          setStatus('valid')
          // Don't fetch profiles/folders until card is expanded — avoids errors when arr apps are offline
        }
      } catch { /* ignore */ }
    }
    load()
  }, [type])

  // Lazy-load profiles/folders when card is expanded
  useEffect(() => {
    if (expanded && status === 'valid' && url && apiKey && profiles.length === 0 && rootFolders.length === 0) {
      Promise.all([
        window.electronAPI.arrGetQualityProfiles({ type, url, apiKey }),
        window.electronAPI.arrGetRootFolders({ type, url, apiKey }),
      ]).then(([p, f]) => {
        setProfiles(p as Array<{ id: number; name: string }>)
        setRootFolders(f as Array<{ id: number; path: string }>)
      }).catch(() => {})
    }
  }, [expanded, status, url, apiKey, type, profiles.length, rootFolders.length])

  const handleTest = async () => {
    if (!url.trim() || !apiKey.trim()) return
    setStatus('testing'); setError(null)
    try {
      const result = await window.electronAPI.arrTestConnection({ type, url: url.trim(), apiKey: apiKey.trim() })
      if (result.success) {
        setStatus('valid'); setVersion(result.version || null)
        await window.electronAPI.setSetting(`${type}_url`, url.trim())
        await window.electronAPI.setSetting(`${type}_api_key`, apiKey.trim())
        const [p, f] = await Promise.all([
          window.electronAPI.arrGetQualityProfiles({ type, url: url.trim(), apiKey: apiKey.trim() }),
          window.electronAPI.arrGetRootFolders({ type, url: url.trim(), apiKey: apiKey.trim() }),
        ])
        setProfiles(p as Array<{ id: number; name: string }>)
        setRootFolders(f as Array<{ id: number; path: string }>)
      } else { setStatus('invalid'); setError(result.error || 'Connection failed'); setProfiles([]); setRootFolders([]) }
    } catch (err) { setStatus('invalid'); setError((err as Error).message || 'Connection failed') }
  }

  const handleClear = async () => {
    setUrl(''); setApiKey(''); setStatus('idle'); setVersion(null); setError(null); setProfiles([]); setRootFolders([]); setProfileId(''); setRootFolder('')
    await Promise.all([
      window.electronAPI.setSetting(`${type}_url`, ''), window.electronAPI.setSetting(`${type}_api_key`, ''),
      window.electronAPI.setSetting(`${type}_quality_profile_id`, ''), window.electronAPI.setSetting(`${type}_root_folder`, ''),
    ])
  }

  const showSaved = (field: 'profile' | 'folder') => {
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    setSavedField(field)
    savedTimerRef.current = setTimeout(() => setSavedField(null), 2000)
  }

  const handleProfileChange = useCallback(async (id: string) => { setProfileId(id); await window.electronAPI.setSetting(`${type}_quality_profile_id`, id); showSaved('profile') }, [type])
  const handleRootFolderChange = useCallback(async (path: string) => { setRootFolder(path); await window.electronAPI.setSetting(`${type}_root_folder`, path); showSaved('folder') }, [type])

  const isConfigured = status === 'valid'

  return (
    <ServiceCard title={label} description={ARR_META[type].description} icon={<Download className="w-5 h-5" />}
      status={isConfigured && profileId && rootFolder ? 'configured' : isConfigured ? 'partial' : 'not-configured'}
      statusText={isConfigured && profileId && rootFolder ? (version ? `v${version}` : 'Configured') : isConfigured ? 'Connected — select profile & folder' : 'Not configured'}
      expanded={expanded} onToggle={onToggle}>
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">URL</label>
          <input type="url" value={url} onChange={(e) => { setUrl(e.target.value); setStatus('idle'); setError(null) }}
            placeholder={`http://localhost:${type === 'radarr' ? 7878 : type === 'sonarr' ? 8989 : 8686}`}
            className="w-full mt-1 px-3 py-2 bg-background border border-border/30 rounded-md text-sm focus:outline-hidden focus:ring-2 focus:ring-primary" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">API Key</label>
          <div className="flex gap-2 mt-1">
            <div className="relative flex-1">
              <input type={showKey ? 'text' : 'password'} value={apiKey} onChange={(e) => { setApiKey(e.target.value); setStatus('idle'); setError(null) }}
                placeholder="Paste API key from Settings → General → Security"
                className="w-full px-3 py-2 pr-10 bg-background border border-border/30 rounded-md text-sm focus:outline-hidden focus:ring-2 focus:ring-primary" />
              <button type="button" onClick={() => setShowKey(!showKey)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground">
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <button onClick={handleTest} disabled={!url.trim() || !apiKey.trim() || status === 'testing'}
              className={`px-3 py-2 rounded-md transition-colors disabled:opacity-50 flex items-center gap-1.5 text-sm ${status === 'valid' ? 'text-green-500' : status === 'invalid' ? 'text-red-500 bg-red-500/10' : 'bg-muted hover:bg-muted/80'}`}>
              {status === 'testing' ? <Loader2 className="w-4 h-4 animate-spin" /> : status === 'valid' ? <CheckCircle className="w-4 h-4" /> : status === 'invalid' ? <><XCircle className="w-4 h-4" /><span>Invalid</span></> : <span>Test</span>}
            </button>
            {(url || apiKey) && (
              <button onClick={handleClear} className="px-3 py-2 text-muted-foreground hover:text-destructive rounded-md transition-colors" title={`Clear ${label} settings`}>
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
          {error && <p className="text-xs text-destructive mt-1">{error}</p>}
        </div>
        {isConfigured && (profiles.length > 0 || rootFolders.length > 0) && (
          <div className="grid grid-cols-2 gap-3 pt-1 border-t border-border/20">
            {profiles.length > 0 && (
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Quality Profile</label>
                  {savedField === 'profile' && <span className="text-xs text-green-400">Saved</span>}
                </div>
                <select value={profileId} onChange={(e) => handleProfileChange(e.target.value)}
                  className="w-full mt-1 px-2 py-1.5 bg-background border border-border/30 rounded-md text-sm focus:outline-hidden focus:ring-2 focus:ring-primary">
                  <option value="">Select profile...</option>
                  {profiles.map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
                </select>
              </div>
            )}
            {rootFolders.length > 0 && (
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Root Folder</label>
                  {savedField === 'folder' && <span className="text-xs text-green-400">Saved</span>}
                </div>
                <select value={rootFolder} onChange={(e) => handleRootFolderChange(e.target.value)}
                  className="w-full mt-1 px-2 py-1.5 bg-background border border-border/30 rounded-md text-sm focus:outline-hidden focus:ring-2 focus:ring-primary">
                  <option value="">Select folder...</option>
                  {rootFolders.map((f) => <option key={f.id} value={f.path}>{f.path}</option>)}
                </select>
              </div>
            )}
          </div>
        )}
      </div>
    </ServiceCard>
  )
}

export function AutomationTab() {
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set())
  const toggleCard = (id: string) => setExpandedCards(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })

  // Sync state
  const [traktUsername, setTraktUsername] = useState('')
  const [releaseAlertsEnabled, setReleaseAlertsEnabled] = useState(false)
  const [releaseAlertDays, setReleaseAlertDays] = useState('30')
  const [syncStatus, setSyncStatus] = useState<string | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const all = await window.electronAPI.getAllSettings()
        setTraktUsername(all[SETTING_KEYS.trakt_username] || '')
        setReleaseAlertsEnabled(all[SETTING_KEYS.release_alerts_enabled] === 'true')
        setReleaseAlertDays(all[SETTING_KEYS.release_alert_days_ahead] || '30')
      } catch { /* ignore */ }
      finally { setIsLoading(false) }
    }
    load()
  }, [])

  if (isLoading) {
    return <div className="p-6 flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
  }

  return (
    <div className="p-6 space-y-5 overflow-y-auto">
      {/* Arr Apps */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">Download Automation</h3>
        <div className="space-y-2">
          <ArrServiceCard type="radarr" expanded={expandedCards.has('radarr')} onToggle={() => toggleCard('radarr')} />
          <ArrServiceCard type="sonarr" expanded={expandedCards.has('sonarr')} onToggle={() => toggleCard('sonarr')} />
          <ArrServiceCard type="lidarr" expanded={expandedCards.has('lidarr')} onToggle={() => toggleCard('lidarr')} />
        </div>
      </div>

      {/* External Sync */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">Watchlist Import</h3>
        <div className="space-y-2">
          <ServiceCard title="Trakt" description="Import your movie watchlist from Trakt" icon={<Film className="w-5 h-5" />}
            status={traktUsername ? 'configured' : 'not-configured'} statusText={traktUsername ? `@${traktUsername}` : 'Not configured'}
            expanded={expandedCards.has('trakt')} onToggle={() => toggleCard('trakt')}>
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Enter your Trakt username to import your public watchlist. Make sure your watchlist is set to public in your Trakt privacy settings.
              </p>
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Username</label>
                <input type="text" value={traktUsername} onChange={e => setTraktUsername(e.target.value)} placeholder="your-trakt-username"
                  className="w-full mt-1 px-3 py-2 bg-background border border-border/30 rounded-md text-sm focus:outline-hidden focus:ring-2 focus:ring-primary" />
              </div>
              <div className="flex items-center gap-2">
                <button onClick={async () => {
                  if (!traktUsername.trim()) return
                  await window.electronAPI.setSetting(SETTING_KEYS.trakt_username, traktUsername.trim())
                  setIsSyncing(true); setSyncStatus(null)
                  try { const r = await window.electronAPI.syncTrakt(traktUsername.trim()); setSyncStatus(`Added ${r.added} of ${r.total} items`); window.dispatchEvent(new CustomEvent('wishlist-changed')) }
                  catch (err) { setSyncStatus(`Error: ${(err as Error).message}`) }
                  finally { setIsSyncing(false) }
                }} disabled={isSyncing || !traktUsername.trim()}
                  className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors">
                  {isSyncing ? 'Syncing...' : 'Import Watchlist'}
                </button>
                {syncStatus && <span className="text-xs text-muted-foreground">{syncStatus}</span>}
              </div>
            </div>
          </ServiceCard>

        </div>
      </div>

      {/* Release Alerts */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">Alerts</h3>
        <ServiceCard title="Release Alerts" description="Get notified when wishlist movies get release dates" icon={<RefreshCw className="w-5 h-5" />}
          status={releaseAlertsEnabled ? 'configured' : 'not-configured'} statusText={releaseAlertsEnabled ? 'Active' : 'Disabled'}
          expanded={expandedCards.has('release-alerts')} onToggle={() => toggleCard('release-alerts')}
          enableToggle={{ enabled: releaseAlertsEnabled, onToggle: async () => {
            const next = !releaseAlertsEnabled; setReleaseAlertsEnabled(next)
            await window.electronAPI.setSetting(SETTING_KEYS.release_alerts_enabled, next.toString())
          }, id: 'release-alerts-toggle' }}>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Alert Window (days ahead)</label>
              <input type="number" value={releaseAlertDays} onChange={async e => { setReleaseAlertDays(e.target.value); await window.electronAPI.setSetting(SETTING_KEYS.release_alert_days_ahead, e.target.value) }}
                min={7} max={180} className="w-24 mt-1 px-3 py-2 bg-background border border-border/30 rounded-md text-sm focus:outline-hidden focus:ring-2 focus:ring-primary" />
            </div>
            <button onClick={async () => {
              setSyncStatus(null)
              try { const c = await window.electronAPI.releaseAlertsCheck(); setSyncStatus(c > 0 ? `Found ${c} upcoming releases` : 'No upcoming releases found') }
              catch (err) { setSyncStatus(`Error: ${(err as Error).message}`) }
            }} className="px-3 py-1.5 text-xs bg-muted hover:bg-muted/80 rounded-md transition-colors">Check Now</button>
            {syncStatus && <span className="text-xs text-muted-foreground">{syncStatus}</span>}
          </div>
        </ServiceCard>
      </div>
    </div>
  )
}
