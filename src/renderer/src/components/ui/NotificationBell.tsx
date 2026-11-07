/**
 * NotificationBell - Simple dropdown for app notifications in the TopBar.
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { Bell, X, CheckCircle2, RefreshCw, AlertCircle, Info } from 'lucide-react'
import { Button } from './Button'

interface AppNotification {
  id: number
  type: string
  title: string
  message: string
  isRead: boolean
  createdAt: string
}

export function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false)
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const loadNotifications = useCallback(async () => {
    try {
      const [items, counts] = await Promise.all([
        window.electronAPI.notificationsGetAll({ limit: 30 }),
        window.electronAPI.notificationsGetCount(),
      ])
      setNotifications(items as AppNotification[])
      setUnreadCount(counts.unread)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    loadNotifications()
  }, [loadNotifications])

  // Refresh when panel opens
  useEffect(() => {
    if (isOpen) loadNotifications()
  }, [isOpen, loadNotifications])

  // Subscribe to push notifications
  useEffect(() => {
    const unsubscribe = window.electronAPI.onNotificationsNew?.(() => {
      loadNotifications()
    })
    return () => unsubscribe?.()
  }, [loadNotifications])

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current && !dropdownRef.current.contains(event.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [isOpen])

  const handleMarkAllRead = useCallback(async () => {
    await window.electronAPI.notificationsMarkAllRead()
    loadNotifications()
  }, [loadNotifications])

  const handleMarkRead = useCallback(async (id: number) => {
    await window.electronAPI.notificationsMarkRead([id])
    loadNotifications()
  }, [loadNotifications])

  const handleClear = useCallback(async () => {
    await window.electronAPI.notificationsClear()
    loadNotifications()
  }, [loadNotifications])

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'scan_complete': return { Icon: CheckCircle2, color: 'text-foreground' }
      case 'source_change': return { Icon: RefreshCw, color: 'text-foreground' }
      case 'error': return { Icon: AlertCircle, color: 'text-destructive' }
      default: return { Icon: Info, color: 'text-muted-foreground' }
    }
  }

  const formatRelativeTime = (dateStr: string) => {
    const now = Date.now()
    const then = new Date(dateStr).getTime()
    const diffMs = now - then
    const diffMin = Math.floor(diffMs / 60000)
    const diffHr = Math.floor(diffMs / 3600000)
    const diffDay = Math.floor(diffMs / 86400000)

    if (diffMin < 1) return 'Just now'
    if (diffMin < 60) return `${diffMin}m ago`
    if (diffHr < 24) return `${diffHr}h ago`
    if (diffDay < 2) return 'Yesterday'
    if (diffDay < 7) return `${diffDay}d ago`
    return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }

  // Get active theme to escape TopBar's forced dark mode
  const getActiveTheme = () => {
    const themes = [
      'frost',
      'slate-light', 'ember-light', 'midnight-light',
      'velvet-light', 'emerald-light', 'cobalt-light', 'carbon-light',
      'matrix-light', 'fury-light', 'gotham-light', 'neon-light', 'whimsy-light',
      'slate', 'ember', 'midnight', 'oled', 'velvet', 'emerald', 'cobalt', 'carbon',
      'matrix', 'fury', 'gotham', 'neon', 'whimsy', 'dark',
    ]
    for (const theme of themes) {
      if (document.documentElement.classList.contains(theme)) return theme
    }
    return 'dark'
  }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className={`relative p-2 rounded-lg transition-colors ${
          isOpen ? 'bg-white text-black' : 'text-white hover:bg-white/10'
        }`}
        aria-label="Notifications"
        aria-expanded={isOpen}
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-white text-black text-caption font-medium rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      <div
        ref={dropdownRef}
        className={`${getActiveTheme()} absolute right-0 top-full mt-2 w-80 max-h-96 bg-card border border-border rounded-2xl shadow-xl z-50 flex flex-col overflow-hidden transition-opacity duration-200 ease-out ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/30">
          <span className="text-label font-semibold text-foreground">Notifications</span>
          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <Button variant="tertiary" size="sm" onClick={handleMarkAllRead}>Mark all read</Button>
            )}
            {notifications.length > 0 && (
              <Button variant="tertiary" size="sm" onClick={handleClear}>Clear</Button>
            )}
            <Button variant="tertiary" size="icon-sm" onClick={() => setIsOpen(false)}
              icon={<X className="w-3.5 h-3.5" />}
            />
          </div>
        </div>

        {/* Notifications list */}
        <div className="flex-1 overflow-y-auto p-2">
          {notifications.length === 0 ? (
            <div className="py-6 text-center">
              <Bell className="w-6 h-6 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-caption text-muted-foreground">No notifications</p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {notifications.map((n) => {
                const { Icon, color } = getNotificationIcon(n.type)
                return (
                  <div
                    key={n.id}
                    className={`py-1.5 px-2 rounded-lg cursor-pointer transition-colors ${
                      n.isRead ? 'opacity-50 hover:opacity-70' : 'hover:bg-muted/30'
                    }`}
                    onClick={() => !n.isRead && handleMarkRead(n.id)}
                  >
                    <div className="flex items-start gap-2">
                      <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${color}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-caption font-medium truncate text-foreground">{n.title}</span>
                          {!n.isRead && <span className="w-1.5 h-1.5 bg-foreground rounded-full shrink-0" />}
                        </div>
                        <p className="text-caption text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                        <span className="text-caption text-muted-foreground/50 mt-0.5 block">
                          {formatRelativeTime(n.createdAt)}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
