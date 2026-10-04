import type { ReactNode } from 'react'

interface DropdownMenuProps {
  children: ReactNode
  align?: 'left' | 'right'
  className?: string
}

/**
 * Shared dropdown menu container for context menus (3-dot menus).
 * Renders an absolutely-positioned card with consistent styling.
 */
export function DropdownMenu({ children, align = 'right', className = '' }: DropdownMenuProps) {
  return (
    <div className={`absolute top-8 ${align === 'right' ? 'right-0' : 'left-0'} bg-card border border-border rounded-md shadow-lg py-1 min-w-[160px] z-20 ${className}`}>
      {children}
    </div>
  )
}

interface DropdownMenuItemProps {
  onClick: (e: React.MouseEvent) => void
  icon?: ReactNode
  children: ReactNode
  destructive?: boolean
}

/**
 * Shared menu item for dropdown menus.
 */
export function DropdownMenuItem({ onClick, icon, children, destructive }: DropdownMenuItemProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2 ${destructive ? 'text-red-500' : ''}`}
    >
      {icon}
      {children}
    </button>
  )
}
