import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/index.css'

async function boot() {
  // Detect web mode (no Electron preload) and install WebSocket transport
  if (typeof window.electronAPI === 'undefined') {
    const { initWebTransport } = await import('./services/webTransport')
    await initWebTransport()
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}

boot()
