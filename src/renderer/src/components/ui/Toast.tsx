import { useEffect, useState } from 'react'
import { X, CheckCircle2, AlertCircle, Info } from 'lucide-react'
import { useToast, Toast as ToastType } from '../../contexts/ToastContext'

function ToastItem({ toast, onRemove }: { toast: ToastType; onRemove: () => void }) {
  const [isVisible, setIsVisible] = useState(false)

  // Animate in on mount
  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 10)
    return () => clearTimeout(timer)
  }, [])

  const handleRemove = () => {
    setIsVisible(false)
    setTimeout(onRemove, 200) // Wait for animation
  }

  const handleActionClick = () => {
    toast.action?.onClick()
    handleRemove()
  }

  const icons = {
    success: <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0" />,
    error: <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />,
    info: <Info className="w-5 h-5 text-blue-400 flex-shrink-0" />
  }

  return (
    <div
      className={`
        bg-card border border-border/50 rounded-lg shadow-lg p-4 min-w-[300px] max-w-[400px]
        transform transition-all duration-200 ease-out
        ${isVisible ? 'translate-x-0 opacity-100' : 'translate-x-4 opacity-0'}
      `}
    >
      <div className="flex items-start gap-3">
        {icons[toast.type]}

        <div className="flex-1 min-w-0">
          <p className="font-medium text-foreground text-sm">{toast.title}</p>
          {toast.message && (
            <p className="text-muted-foreground text-xs mt-0.5">{toast.message}</p>
          )}

          {toast.action && (
            <button
              onClick={handleActionClick}
              className="mt-2 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
            >
              {toast.action.label}
            </button>
          )}
        </div>

        <button
          onClick={handleRemove}
          className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

export function ToastContainer() {
  const { toasts, removeToast } = useToast()

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map(toast => (
        <ToastItem
          key={toast.id}
          toast={toast}
          onRemove={() => removeToast(toast.id)}
        />
      ))}
    </div>
  )
}
