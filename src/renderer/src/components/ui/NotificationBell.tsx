/**
 * NotificationBell - Simple dropdown for app notifications in the TopBar.
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { Bell, X } from 'lucide-react'

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

  const getIconStyle = (type: string) => {
    switch (type) {
      case 'scan_complete': return { icon: '✓', color: 'text-muted-foreground' }
      case 'source_change': return { icon: '↻', color: 'text-muted-foreground' }
      case 'error': return { icon: '!', color: 'text-muted-foreground' }
      default: return { icon: 'i', color: 'text-muted-foreground' }
    }
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
        className={`relative p-2 rounded-md transition-colors ${
          isOpen ? 'bg-white text-black' : 'text-white hover:bg-white/10'
        }`}
        aria-label="Notifications"
        aria-expanded={isOpen}
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-white text-black text-[10px] font-medium rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      <div
        ref={dropdownRef}
        className={`${getActiveTheme()} absolute right-0 top-full mt-2 w-80 max-h-96 bg-card rounded-xl shadow-2xl z-50 flex flex-col overflow-hidden transition-all duration-200 ease-out ${
          isOpen ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0 pointer-events-none'
        }`}
        style={{ boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/30">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Notifications</span>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button onClick={handleMarkAllRead} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                Mark all read
              </button>
            )}
            {notifications.length > 0 && (
              <button onClick={handleClear} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                Clear
              </button>
            )}
            <button onClick={() => setIsOpen(false)} className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Notifications list */}
        <div className="flex-1 overflow-y-auto p-2">
          {notifications.length === 0 ? (
            <div className="py-6 text-center">
              <Bell className="w-6 h-6 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">No notifications</p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {notifications.map((n) => {
                const style = getIconStyle(n.type)
                return (
                  <div
                    key={n.id}
                    className={`py-1.5 px-2 rounded-lg cursor-pointer transition-colors ${
                      n.isRead ? 'opacity-50 hover:opacity-70' : 'hover:bg-muted/30'
                    }`}
                    onClick={() => !n.isRead && handleMarkRead(n.id)}
                  >
                    <div className="flex items-start gap-2">
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5 ${style.color}`}>
                        {style.icon}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium truncate text-foreground">{n.title}</span>
                          {!n.isRead && <span className="w-1.5 h-1.5 bg-accent rounded-full shrink-0" />}
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                        <span className="text-[10px] text-muted-foreground/50 mt-0.5 block">
                          {new Date(n.createdAt).toLocaleString()}
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
