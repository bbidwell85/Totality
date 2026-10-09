/**
 * WebLoginScreen
 *
 * PIN authentication screen shown when accessing via web browser.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { Lock, AlertCircle } from 'lucide-react'

interface WebLoginScreenProps {
  onAuthenticated: () => void
  authenticate: (pin: string) => Promise<string>
  logoSrc?: string
}

export function WebLoginScreen({ onAuthenticated, authenticate, logoSrc }: WebLoginScreenProps) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pin.trim() || loading) return

    setLoading(true)
    setError(null)

    try {
      await authenticate(pin)
      onAuthenticated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed')
      setPin('')
      inputRef.current?.focus()
    } finally {
      setLoading(false)
    }
  }, [pin, loading, authenticate, onAuthenticated])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
      <div className="w-full max-w-xs mx-auto px-6">
        {/* Logo */}
        <div className="text-center mb-8">
          {logoSrc ? (
            <img src={logoSrc} alt="Totality" className="h-20 mx-auto mb-4" />
          ) : (
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Lock className="w-6 h-6 text-primary" />
            </div>
          )}
          <p className="text-sm text-muted-foreground">Enter PIN to access</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="Enter PIN"
            className="w-full px-4 py-3 min-h-[48px] text-center text-lg tracking-[0.3em] bg-white/10 border border-white/15 rounded-full text-foreground placeholder:tracking-normal placeholder:text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-white/30 focus:border-white/25 transition-all"
            autoComplete="off"
            disabled={loading}
          />

          {error && (
            <div className="flex items-center justify-center gap-2 mt-3 text-sm text-destructive">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={!pin.trim() || loading}
            className="w-full mt-4 px-4 min-h-[48px] bg-primary text-primary-foreground rounded-full font-medium text-sm hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Verifying...' : 'Unlock'}
          </button>
        </form>
      </div>
    </div>
  )
}
