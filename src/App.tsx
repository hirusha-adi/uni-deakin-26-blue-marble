'use client'

import { useState } from 'react'
import PasswordLab from './components/PasswordLab'
import InjectionLab from './components/InjectionLab'

type Demo = 'brute' | 'dictionary' | 'xss' | 'sql'

const demos: { id: Demo; name: string }[] = [
  { id: 'brute', name: 'Brute force' },
  { id: 'dictionary', name: 'Dictionary attack' },
  { id: 'xss', name: 'XSS demo' },
  { id: 'sql', name: 'SQL injection' },
]

export default function App() {
  const [demo, setDemo] = useState<Demo>('brute')
  const title = demos.find(item => item.id === demo)!.name

  return (
    <main className="mx-auto w-full max-w-[1100px] px-4 py-7 sm:px-6 sm:py-10">
      <a href="#lab-content" className="sr-only fixed left-4 top-4 z-50 rounded-lg bg-brand px-4 py-3 text-white focus:not-sr-only">Skip to demo</a>
      <header className="mb-6">
        <p className="text-sm text-muted">Blue Marble Study Tour 2026</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Cybersecurity demos</h1>
      </header>

      <nav aria-label="Choose a demo" className="mb-7 flex flex-wrap gap-2">
        {demos.map(item => (
          <button key={item.id} type="button" aria-pressed={demo === item.id} onClick={() => setDemo(item.id)} className={`rounded-lg border px-3.5 py-2.5 text-sm font-medium transition ${demo === item.id ? 'border-brand bg-brand text-white' : 'border-line bg-white text-ink hover:border-brand'}`}>
            {item.name}
          </button>
        ))}
        <button type="button" disabled aria-label="Phishing demo, coming soon" className="cursor-not-allowed rounded-lg border border-line px-3.5 py-2.5 text-sm text-muted/65">Phishing · soon</button>
      </nav>

      <section id="lab-content" aria-labelledby="lab-title" className="scroll-mt-5">
        <h2 id="lab-title" className="mb-3 text-xl font-semibold">{title}</h2>
        {demo === 'brute' || demo === 'dictionary'
          ? <PasswordLab key={demo} method={demo} />
          : <InjectionLab key={demo} demo={demo} />}
      </section>
      <p className="mt-5 text-xs text-muted">All demos run in your browser.</p>
    </main>
  )
}
