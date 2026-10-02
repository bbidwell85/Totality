/**
 * AutomationTab - External sync (Trakt) + Release Alerts
 */

import { useState, useEffect } from 'react'
import { SETTING_KEYS } from '../../../../../shared/settingKeys'
import {
  Loader2, CheckCircle,
  RefreshCw, ChevronDown, Film, Circle,
} from 'lucide-react'
import { Toggle } from '../../ui/Toggle'

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
            {status === 'configured' ? <CheckCircle className="w-5 h-5 text-primary" /> :
             status === 'partial' ? <CheckCircle className="w-5 h-5 text-muted-foreground" /> :
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
          <div onClick={(e) => e.stopPropagation()}>
            <Toggle checked={enableToggle.enabled} onChange={() => enableToggle.onToggle()} />
          </div>
        )}
        <button onClick={onToggle} className="p-1 shrink-0">
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {expanded && <div className="px-4 pb-4 pt-2 border-t border-border/30 bg-muted/10">{children}</div>}
    </div>
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
