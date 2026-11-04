/**
 * WebLoginScreen
 *
 * PIN authentication screen shown when accessing via web browser.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { Button } from '../ui/Button'

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
    <div className="fixed inset-0 flex flex-col items-center justify-center overflow-auto bg-background text-foreground px-4">
      {/* Logo */}
      {logoSrc ? (
        <img src={logoSrc} alt="Totality" className="h-28 mb-10" />
      ) : (
        <h1 className="text-display font-semibold mb-10">Totality</h1>
      )}

      {/* PIN form */}
      <form onSubmit={handleSubmit} className="w-full max-w-[280px] flex flex-col items-center gap-4">
        <input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="Enter PIN"
          className="w-full px-4 py-3 text-center text-title tracking-widest bg-muted/50 rounded-lg text-foreground placeholder:tracking-normal placeholder:text-label placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20"
          autoComplete="off"
          disabled={loading}
        />

        {error && (
          <p className="text-label text-destructive">{error}</p>
        )}

        <Button
          type="submit"
          disabled={!pin.trim() || loading}
          loading={loading}
          size="lg"
          className="w-full"
        >
          Unlock
        </Button>
      </form>
    </div>
  )
}
