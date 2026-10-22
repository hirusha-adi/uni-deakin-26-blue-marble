'use client'

import { useEffect, useRef, useState } from 'react'
import PasswordLab from './components/PasswordLab'
import InjectionLab from './components/InjectionLab'
import PromptInjectionLab from './components/PromptInjectionLab'
import { useFeedbackMotion } from './hooks/useFeedbackMotion'

type Demo = 'brute' | 'dictionary' | 'xss' | 'sql' | 'prompt'

interface DemoItem {
  id: Demo
  name: string
  blurb: string
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
]

function findActive(demo: Demo) {
  for (const category of categories) {
    for (const item of category.items) if (item.id === demo) return { category, item }
  }
  throw new Error(`Unknown demo: ${demo}`)
}

function ChallengeNavigation({ demo, onSelect }: { demo: Demo; onSelect: (demo: Demo) => void }) {
  return (
    <nav aria-label="Challenges">
      {categories.map((group) => (
        <div key={group.id} className="border-t border-line py-3 first:border-t-0">
          <p className="px-5 pb-2 text-xs font-medium text-muted">{group.name}</p>
          <ul>
            {group.items.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  aria-current={entry.id === demo ? 'page' : undefined}
                  onClick={() => onSelect(entry.id)}
                  className="challenge-nav-item"
                >
                  {entry.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}

export default function App() {
  const [demo, setDemo] = useState<Demo>('brute')
  const [navigationOpen, setNavigationOpen] = useState(false)
  const { item } = findActive(demo)
  const demoRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLElement>(null)
  const navigationRef = useRef<HTMLDialogElement>(null)
  useFeedbackMotion(demoRef, demo, true, '[data-motion-demo]')

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)')
    const closeOnDesktop = () => {
      if (desktop.matches) navigationRef.current?.close()
    }
    desktop.addEventListener('change', closeOnDesktop)
    return () => desktop.removeEventListener('change', closeOnDesktop)
  }, [])

  function openNavigation() {
    const drawer = navigationRef.current
    if (!drawer || drawer.open) return
    drawer.showModal()
    setNavigationOpen(true)
  }

  function selectDemo(nextDemo: Demo) {
    setDemo(nextDemo)
    contentRef.current?.scrollTo({ top: 0 })
    navigationRef.current?.close()
  }

  return (
    <>
      <a href="#lab-content" className="sr-only fixed left-4 top-4 z-50 rounded bg-surface px-4 py-3 text-brand shadow-md focus:not-sr-only">Skip to demo</a>
      <div className="flex h-dvh flex-col overflow-hidden">
        <header className="lab-app-bar shrink-0">
          <div className="flex min-h-16 w-full items-center justify-center px-4 py-3">
            <h1 className="text-center text-xl font-medium">Ethical Hacking Lab</h1>
          </div>
        </header>

        <div className="flex min-h-0 w-full flex-1 overflow-hidden">
          <aside className="hidden min-h-0 w-60 shrink-0 overflow-y-auto overscroll-contain border-r border-line bg-surface lg:block">
            <h2 className="px-5 pt-6 pb-2 text-sm font-medium">Challenges</h2>
            <ChallengeNavigation demo={demo} onSelect={selectDemo} />
          </aside>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="shrink-0 border-b border-line bg-surface px-4 py-3 sm:px-6 lg:hidden">
              <button
                type="button"
                onClick={openNavigation}
                aria-label="Open challenge navigation"
                aria-haspopup="dialog"
                aria-controls="challenge-navigation-drawer"
                aria-expanded={navigationOpen}
                className="btn-secondary"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
                Challenges
              </button>
            </div>
            <main ref={contentRef} id="lab-content" tabIndex={-1} className={`min-h-0 min-w-0 flex-1 overscroll-contain px-4 py-6 sm:px-6 sm:py-8 lg:px-8 ${navigationOpen ? 'overflow-hidden' : 'overflow-y-auto'}`}>
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
          </div>
        </div>
      </div>

      <dialog
        ref={navigationRef}
        id="challenge-navigation-drawer"
        aria-labelledby="challenge-navigation-title"
        className="lab-navigation-drawer lg:hidden"
        onClose={() => setNavigationOpen(false)}
        onClick={(event) => { if (event.target === event.currentTarget) navigationRef.current?.close() }}
      >
        <div className="min-h-full">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 id="challenge-navigation-title" className="text-base font-medium">Challenges</h2>
            <button type="button" onClick={() => navigationRef.current?.close()} aria-label="Close challenge navigation" className="inline-flex h-9 w-9 items-center justify-center rounded text-muted hover:bg-paper">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5"><path d="m6 6 12 12M18 6 6 18" /></svg>
            </button>
          </div>
          <ChallengeNavigation demo={demo} onSelect={selectDemo} />
        </div>
      </dialog>
    </>
  )
}
