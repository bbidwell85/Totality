import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Loader2, Music, Film, Tv, Plus } from 'lucide-react'
import { Button } from '../ui/Button'

interface BarcodeResult {
  type: 'movie' | 'tv' | 'album'
  title: string
  year?: number
  poster_url?: string
  tmdb_id?: number
  musicbrainz_id?: string
  artist_name?: string
  barcode: string
}

interface BarcodeScannerProps {
  isOpen: boolean
  onClose: () => void
  onAddToWishlist: (result: BarcodeResult) => void
}

const typeLabels: Record<string, string> = { movie: 'Movie', tv: 'TV show', album: 'Album' }

export function BarcodeScanner({ isOpen, onClose, onAddToWishlist }: BarcodeScannerProps) {
  const [scanning, setScanning] = useState(false)
  const [looking, setLooking] = useState(false)
  const [results, setResults] = useState<BarcodeResult[]>([])
  const [error, setError] = useState<string | null>(null)
  const [addedIndex, setAddedIndex] = useState<number | null>(null)
  const lastBarcodeRef = useRef<string | null>(null)
  const html5QrCodeRef = useRef<unknown>(null)

  const stopCamera = useCallback(() => {
    if (html5QrCodeRef.current) {
      const scanner = html5QrCodeRef.current as { stop: () => Promise<void>; getState?: () => number; isScanning?: boolean }
      try {
        const state = scanner.getState?.()
        if (state !== 0 || scanner.isScanning) {
          scanner.stop().catch(() => {})
        }
      } catch { /* already stopped */ }
      html5QrCodeRef.current = null
    }
    setScanning(false)
  }, [])

  const startCamera = useCallback(async () => {
    setError(null)
    setResults([])
    setAddedIndex(null)
    lastBarcodeRef.current = null

    // Pre-check camera permission before loading scanner library
    try {
      if (navigator.permissions) {
        const status = await navigator.permissions.query({ name: 'camera' as PermissionName })
        if (status.state === 'denied') {
          setError('Camera access denied. Allow camera access in your browser settings.')
          return
        }
      }
    } catch { /* permissions API not available — proceed to scanner */ }

    setScanning(true)

    await new Promise(r => setTimeout(r, 100))

    try {
      const { Html5Qrcode } = await import('html5-qrcode')
      const scanner = new Html5Qrcode('barcode-reader')
      html5QrCodeRef.current = scanner

      await scanner.start(
        { facingMode: 'environment' },
        { fps: 15, qrbox: { width: 300, height: 160 }, disableFlip: false },
        async (decodedText) => {
          if (!/^\d{8,14}$/.test(decodedText)) return
          if (decodedText === lastBarcodeRef.current) return

          lastBarcodeRef.current = decodedText
          window.electronAPI?.clientLog?.('info', 'BarcodeScanner', `Barcode decoded: ${decodedText}`)

          try { scanner.stop().catch(() => {}) } catch { /* already stopped */ }
          setScanning(false)
          setLooking(true)
          setError(null)

          try {
            const lookupResults = await window.electronAPI.barcodeLookup(decodedText)
            setResults(lookupResults)
            if (lookupResults.length === 0) {
              setError('No matches found for this barcode')
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            setError(`Lookup failed: ${msg || 'Unknown error'}`)
            window.electronAPI?.clientLog?.('error', 'BarcodeScanner', `Lookup failed for ${decodedText}: ${msg}`)
          } finally {
            setLooking(false)
          }
        },
        () => {}
      )
    } catch (err) {
      setScanning(false)
      const msg = err instanceof Error ? err.message : (typeof err === 'string' ? err : JSON.stringify(err))
      window.electronAPI?.clientLog?.('error', 'BarcodeScanner', `Camera start failed: ${msg}`)
      if (msg.includes('Permission') || msg.includes('NotAllowed')) {
        setError('Camera access denied. Allow camera access in your browser settings.')
      } else if (msg.includes('NotFound') || msg.includes('DevicesNotFound')) {
        setError('No camera found on this device.')
      } else {
        setError(`Camera error: ${msg}`)
      }
    }
  }, [])

  // Auto-start camera when opened
  useEffect(() => {
    if (isOpen) {
      startCamera()
    } else {
      stopCamera()
      setResults([])
      setError(null)
      setAddedIndex(null)
      lastBarcodeRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  useEffect(() => {
    return () => stopCamera()
  }, [stopCamera])

  if (!isOpen) return null

  const TypeIcon = ({ type }: { type: string }) => {
    if (type === 'movie') return <Film className="w-4 h-4" />
    if (type === 'tv') return <Tv className="w-4 h-4" />
    return <Music className="w-4 h-4" />
  }

  const handleAdd = async (result: BarcodeResult, index: number) => {
    onAddToWishlist(result)
    setAddedIndex(index)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Header */}
      <div
        className="shrink-0 flex items-center justify-between px-4"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 24px)', paddingBottom: '12px' }}
      >
        <h2 className="text-title font-semibold text-white">Scan barcode</h2>
        <button
          onClick={() => { stopCamera(); onClose() }}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full bg-white/10 text-white/80 hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Camera viewfinder */}
      <div className={`w-full ${scanning ? '' : 'hidden'}`}>
        <div id="barcode-reader" className="overflow-hidden" style={{ minHeight: '280px' }} />
        <p className="text-caption text-white/40 text-center mt-3 px-4">
          Hold steady over a barcode
        </p>
      </div>

      {/* Loading state */}
      {looking && (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-white/50 animate-spin" />
            <p className="text-label text-white/60">Looking up barcode...</p>
          </div>
        </div>
      )}

      {/* Error — inline, not replacing the whole view */}
      {error && !scanning && !looking && results.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center px-6">
          <p className="text-label text-white/60 text-center mb-4">{error}</p>
          <Button onClick={startCamera} variant="tertiary" size="sm">
            Try again
          </Button>
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="flex-1 flex flex-col px-4 pt-4"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }}
        >
          <p className="text-caption text-white/40 mb-3">
            {results.length} match{results.length !== 1 ? 'es' : ''} found
          </p>

          <div className="flex-1 overflow-y-auto space-y-2">
            {results.map((result, i) => (
              <button
                key={i}
                onClick={() => handleAdd(result, i)}
                disabled={addedIndex === i}
                className={`w-full flex items-center gap-3 p-3 rounded-2xl text-left transition-colors ${
                  addedIndex === i
                    ? 'bg-foreground text-background'
                    : 'bg-white/8 hover:bg-white/12'
                }`}
              >
                {/* Poster */}
                <div className={`shrink-0 rounded-lg overflow-hidden bg-white/5 ${result.type === 'album' ? 'w-14 h-14' : 'w-12 h-[4.5rem]'}`}>
                  {result.poster_url ? (
                    <img src={result.poster_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <TypeIcon type={result.type} />
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <TypeIcon type={result.type} />
                    <span className={`text-caption ${addedIndex === i ? 'opacity-70' : 'text-white/40'}`}>
                      {typeLabels[result.type] || result.type}
                    </span>
                  </div>
                  <h3 className="text-label font-medium truncate">{result.title}</h3>
                  {result.artist_name && (
                    <p className={`text-caption truncate ${addedIndex === i ? 'opacity-70' : 'text-white/50'}`}>{result.artist_name}</p>
                  )}
                  {result.year && (
                    <p className={`text-caption ${addedIndex === i ? 'opacity-70' : 'text-white/40'}`}>{result.year}</p>
                  )}
                </div>

                {/* Add indicator */}
                {addedIndex === i ? (
                  <span className="text-caption font-medium shrink-0">Added</span>
                ) : (
                  <Plus className="w-5 h-5 text-white/30 shrink-0" />
                )}
              </button>
            ))}
          </div>

          {/* Bottom actions */}
          <div className="shrink-0 flex gap-2 pt-4">
            <Button onClick={startCamera} variant="tertiary" size="sm" className="flex-1">
              Scan another
            </Button>
            <Button onClick={() => { stopCamera(); onClose() }} variant="tertiary" size="sm" className="flex-1">
              Done
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
