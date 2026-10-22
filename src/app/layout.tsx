import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import '@fontsource/roboto/latin-400.css'
import '@fontsource/roboto/latin-500.css'
import '@fontsource/roboto/latin-700.css'
import './globals.css'

export const metadata: Metadata = {
  title: 'Blue Marble Study Tour 2026 · Security Lab',
  description: 'Hands-on cybersecurity demos for the Blue Marble Study Tour 2026. Password attacks, injection attacks, and more — all in your browser.',
  icons: { icon: '/favicon.svg' },
}

export const viewport: Viewport = { themeColor: '#3f51b5' }

// Keep the XSS lesson isolated while allowing Next's local development tools.
const isDevelopment = process.env.NODE_ENV === 'development'
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDevelopment ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  `connect-src 'self'${isDevelopment ? ' ws://127.0.0.1:* ws://localhost:*' : ''}`,
  "worker-src 'self' blob:",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ')

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head><meta httpEquiv="Content-Security-Policy" content={contentSecurityPolicy} /></head>
      <body>{children}</body>
    </html>
  )
}
