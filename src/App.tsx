'use client'

import { useRef, useState } from 'react'
import PasswordLab from './components/PasswordLab'
import InjectionLab from './components/InjectionLab'
import PromptInjectionLab from './components/PromptInjectionLab'
import { useFeedbackMotion } from './hooks/useFeedbackMotion'

type Demo = 'brute' | 'dictionary' | 'xss' | 'sql' | 'prompt' | 'phishing'

interface DemoItem {
  id: Demo
  name: string
  blurb: string
  disabled?: boolean
}

interface Category {
  id: string
  name: string
  items: DemoItem[]
}

const categories: Category[] = [
  {
    id: 'password',
    name: 'Password attacks',
    items: [
      { id: 'brute', name: 'Brute force', blurb: 'Try every combination in order.' },
      { id: 'dictionary', name: 'Dictionary attack', blurb: 'Try common words and simple variations.' },
    ],
  },
  {
    id: 'injection',
    name: 'Injection attacks',
    items: [
      { id: 'xss', name: 'XSS', blurb: 'A comment that makes a page run JavaScript.' },
      { id: 'sql', name: 'SQL injection', blurb: 'Login input that changes the database query.' },
      { id: 'prompt', name: 'Prompt injection', blurb: 'Chat with the IT assistant. Can you make it reveal the hidden flag?' },
    ],
  },
  {
    id: 'phishing',
    name: 'Phishing',
    items: [{ id: 'phishing', name: 'Coming soon', blurb: 'A deceptive-message demo is in development.', disabled: true }],
  },
]

function findActive(demo: Demo) {
  for (const category of categories) {
    for (const item of category.items) if (item.id === demo) return { category, item }
  }
  throw new Error(`Unknown demo: ${demo}`)
}

export default function App() {
  const [demo, setDemo] = useState<Demo>('brute')
  const { item } = findActive(demo)
  const demoRef = useRef<HTMLDivElement>(null)
  useFeedbackMotion(demoRef, demo, true, '[data-motion-demo]')

  return (
    <>
      <a href="#lab-content" className="sr-only fixed left-4 top-4 z-50 rounded bg-surface px-4 py-3 text-brand shadow-md focus:not-sr-only">Skip to demo</a>
      <header className="lab-app-bar">
        <div className="mx-auto flex min-h-16 w-full max-w-[1120px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="lab-brand-mark" aria-hidden="true">
              <svg viewBox="0 0 40 40" fill="none">
                <circle cx="20" cy="20" r="15" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <ellipse cx="20" cy="20" rx="6" ry="15" stroke="currentColor" strokeWidth="1.3" />
                <path d="M5 20h30M8 12h24M8 28h24" stroke="currentColor" strokeWidth="1.3" />
                <circle cx="33" cy="7" r="4" fill="#c5cae9" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-medium sm:text-xl">Blue Marble Study Tour 2026</h1>
              <p className="mt-0.5 text-xs text-white/80">Cybersecurity lab</p>
            </div>
          </div>
          <p className="max-w-64 text-xs leading-5 text-white/80">Practice with made-up data.<br />{demo === 'prompt' ? 'Chat messages are sent to OpenAI.' : 'Password, XSS and SQL demos run in your browser.'}</p>
        </div>
      </header>

      <nav aria-label="Demos" className="border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-[1120px] flex-wrap gap-x-6 gap-y-2 px-4 pt-3 sm:gap-x-8 sm:px-6">
          {categories.map((group) => (
            <div key={group.id}>
              <p className="px-3 text-xs text-muted">{group.name}</p>
              <ul className="flex flex-wrap">
                {group.items.map((entry) => {
                  const current = entry.id === demo
                  return (
                    <li key={entry.id}>
                      <button
                        type="button"
                        disabled={entry.disabled}
                        aria-current={current ? 'page' : undefined}
                        aria-disabled={entry.disabled || undefined}
                        onClick={() => !entry.disabled && setDemo(entry.id)}
                        className="nav-item"
                      >
                        {entry.name}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      </nav>

      <main id="lab-content" className="mx-auto w-full min-w-0 max-w-[1120px] scroll-mt-6 px-4 py-6 sm:px-6 sm:py-8">
        <header className="mb-5">
          <h2 className="text-2xl font-normal">{item.name}</h2>
          <p className="mt-1 text-sm leading-6 text-muted">{item.blurb}</p>
        </header>

        <div ref={demoRef} data-motion-demo>
          {demo === 'brute' || demo === 'dictionary'
            ? <PasswordLab key={demo} method={demo} />
            : demo === 'prompt'
              ? <PromptInjectionLab />
              : demo === 'xss' || demo === 'sql'
                ? <InjectionLab key={demo} demo={demo} />
                : null}
        </div>
      </main>
    </>
  )
}
