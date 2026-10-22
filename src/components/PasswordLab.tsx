import { useEffect, useMemo, useRef, useState } from 'react'
import zxcvbn from 'zxcvbn'
import { buildDictionary, createAttackPlan, MAX_ATTEMPTS, type AttackConfig, type AttackMethod, type AttackSnapshot } from '../lib/passwordEngine'
import { useFeedbackMotion } from '../hooks/useFeedbackMotion'
import AttemptLog from './AttemptLog'

const DEFAULT_WORDLIST = '123456\npassword\nqwerty\nletmein\nwelcome\nadmin\nfootball\nmonkey\ndragon\nsunshine\niloveyou\npassword123\nblue marble\ndeakin2026'
const number = new Intl.NumberFormat('en-AU')
const strengthNames = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong']
const strengthColours = ['bg-danger', 'bg-[#d47121]', 'bg-warn', 'bg-success', 'bg-brand']

type DisplayStatus = 'idle' | 'stopped' | 'error' | AttackSnapshot['status']

const statusMeta: Record<DisplayStatus, { label: string; tone: 'neutral' | 'brand' | 'warn' | 'success' | 'danger' }> = {
  idle: { label: 'Ready', tone: 'neutral' },
  running: { label: 'Running', tone: 'brand' },
  found: { label: 'Match found', tone: 'success' },
  exhausted: { label: 'List exhausted', tone: 'warn' },
  limited: { label: 'Demo limit reached', tone: 'warn' },
  unsupported: { label: 'Outside settings', tone: 'warn' },
  stopped: { label: 'Stopped', tone: 'neutral' },
  error: { label: 'Check settings', tone: 'danger' },
}

interface WorkerResponse {
  type: 'snapshot' | 'error'
  snapshot?: AttackSnapshot
  message?: string
  newGuesses?: string[]
}

export default function PasswordLab({ method }: { method: AttackMethod }) {
  const [target, setTarget] = useState(method === 'brute' ? '042' : 'password123')
  const [alphabet, setAlphabet] = useState('0123456789')
  const [maxLength, setMaxLength] = useState(3)
  const [wordlist, setWordlist] = useState(DEFAULT_WORDLIST)
  const [variations, setVariations] = useState(false)
  const [speed, setSpeed] = useState(method === 'brute' ? 60 : 10)
  const [status, setStatus] = useState<DisplayStatus>('idle')
  const [snapshot, setSnapshot] = useState<AttackSnapshot | null>(null)
  const [error, setError] = useState('')
  const [logVersion, setLogVersion] = useState(0)
  const worker = useRef<Worker | null>(null)
  const guesses = useRef<string[]>([])
  const feedbackScope = useRef<HTMLDivElement>(null)
  const running = status === 'running'
  const config: AttackConfig = { method, target, alphabet, maxLength, wordlist, variations }
  const estimate = useMemo(() => target ? zxcvbn(target, ['blue marble', 'deakin', 'study tour', '2026']) : null, [target])

  useFeedbackMotion(feedbackScope, status, status !== 'idle' && status !== 'running')
  useEffect(() => () => worker.current?.terminate(), [])

  const planInfo = useMemo(() => {
    try {
      const plan = createAttackPlan({ method, target, alphabet, maxLength, wordlist, variations })
      return { total: plan.total, fullTotal: plan.fullTotal, capped: plan.capped, message: '' }
    } catch (problem) {
      return { total: 0, fullTotal: '0', capped: false, message: problem instanceof Error ? problem.message : 'Check your settings.' }
    }
  }, [method, target, alphabet, maxLength, wordlist, variations])
  const baseWordCount = useMemo(() => buildDictionary(wordlist).length, [wordlist])

  function reset() {
    worker.current?.terminate()
    worker.current = null
    setSnapshot(null)
    setStatus('idle')
    setError('')
    guesses.current = []
    setLogVersion((version) => version + 1)
  }

  function start() {
    reset()
    try {
      createAttackPlan(config)
      const nextWorker = new Worker(new URL('../workers/password.worker.ts', import.meta.url), { type: 'module' })
      worker.current = nextWorker
      setStatus('running')
      nextWorker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        if (worker.current !== nextWorker) return
        const response = event.data
        if (response.type === 'error') {
          setError(response.message ?? 'Unable to start this demo.')
          setStatus('error')
          nextWorker.terminate()
          worker.current = null
        } else if (response.snapshot) {
          if (response.newGuesses) guesses.current.push(...response.newGuesses)
          setSnapshot(response.snapshot)
          setStatus(response.snapshot.status)
          if (response.snapshot.status !== 'running') {
            nextWorker.terminate()
            worker.current = null
          }
        }
      }
      nextWorker.onerror = () => {
        if (worker.current !== nextWorker) return
        setError('The browser could not start the demo. Reload the page and try again.')
        setStatus('error')
        nextWorker.terminate()
        worker.current = null
      }
      nextWorker.postMessage({ type: 'start', config, candidatesPerSecond: speed })
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Check your demo settings.')
      setStatus('error')
    }
  }

  function stop() {
    worker.current?.terminate()
    worker.current = null
    setStatus('stopped')
  }

  function usePreset(preset: 'pin' | 'letters' | 'large' | 'common' | 'phrase' | 'variants') {
    reset()
    if (preset === 'pin') {
      setTarget('042'); setAlphabet('0123456789'); setMaxLength(3); setSpeed(60)
    } else if (preset === 'letters') {
      setTarget('cab'); setAlphabet('abc'); setMaxLength(3); setSpeed(10)
    } else if (preset === 'large') {
      setTarget('zzzzzz'); setAlphabet('abcdefghijklmnopqrstuvwxyz'); setMaxLength(6); setSpeed(25000)
    } else if (preset === 'common') {
      setTarget('password123'); setWordlist(DEFAULT_WORDLIST); setVariations(false)
    } else if (preset === 'phrase') {
      setTarget('orbit kiwi river cloud'); setWordlist(DEFAULT_WORDLIST); setVariations(false)
    } else {
      setTarget('marble123'); setWordlist('welcome\ndeakin\nmarble\nstudent\nblue'); setVariations(true)
    }
  }

  const attempts = snapshot?.attempts ?? 0
  const total = snapshot?.total ?? planInfo.total
  const progress = total ? Math.min(100, attempts / total * 100) : 0
  const info = statusMeta[status]
  const resultText: Partial<Record<DisplayStatus, string>> = {
    found: `Found “${snapshot?.matched}” after ${number.format(attempts)} ${attempts === 1 ? 'guess' : 'guesses'}.`,
    exhausted: 'This password was not in the list. A different list could still find it.',
    limited: `Stopped at ${number.format(MAX_ATTEMPTS)} guesses. The remaining combinations have not been tried.`,
    unsupported: snapshot?.reason ?? 'Update your settings to include this password.',
    stopped: 'Start again to begin from the first guess.',
    error,
  }
  const presets = method === 'brute'
    ? ([['pin', '3-digit PIN'], ['letters', 'Tiny alphabet'], ['large', 'Bigger search']] as const)
    : ([['common', 'Common password'], ['phrase', 'Long phrase'], ['variants', 'Word + numbers']] as const)

  return (
    <div ref={feedbackScope} className="space-y-4">
      <div className="panel overflow-hidden">
        <div className="grid lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <section aria-labelledby="password-settings-heading" className="space-y-4 p-5 sm:p-6">
            <header className="border-b border-line pb-3">
              <h3 id="password-settings-heading" className="text-base font-medium">Settings</h3>
            </header>

            <div>
              <label htmlFor="demo-password" className="field-label">Demo password</label>
              <input id="demo-password" type="text" autoComplete="off" spellCheck={false} maxLength={64} disabled={running} value={target} onChange={(event) => { reset(); setTarget(event.target.value) }} className="input-field font-mono" aria-describedby="demo-password-help" />
              <p id="demo-password-help" className="field-hint">Use a made-up password.</p>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <span className="text-muted">Try:</span>
              {presets.map(([preset, label]) => (
                <button key={preset} type="button" disabled={running} onClick={() => usePreset(preset)} className="btn-ghost">
                  {label}
                </button>
              ))}
            </div>

            {method === 'brute' ? (
              <>
                <div>
                  <label htmlFor="attack-alphabet" className="field-label">Characters to try</label>
                  <input id="attack-alphabet" value={alphabet} maxLength={64} disabled={running} onChange={(event) => { reset(); setAlphabet(event.target.value) }} spellCheck={false} className="input-field font-mono" />
                  <p className="field-hint">{new Set(Array.from(alphabet)).size} unique characters. Repeats count once.</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="attack-max-length" className="field-label">Maximum length</label>
                    <select id="attack-max-length" disabled={running} value={maxLength} onChange={(event) => { reset(); setMaxLength(Number(event.target.value)) }} className="input-field">
                      {[1, 2, 3, 4, 5, 6].map((length) => <option key={length} value={length}>{length} {length === 1 ? 'character' : 'characters'}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="attack-speed" className="field-label">Demo pace</label>
                    <select id="attack-speed" disabled={running} value={speed} onChange={(event) => { reset(); setSpeed(Number(event.target.value)) }} className="input-field">
                      <option value={10}>Slow · 10/sec</option>
                      <option value={60}>Normal · 60/sec</option>
                      <option value={1000}>Quick · 1,000/sec</option>
                      <option value={25000}>Fast · 25,000/sec</option>
                    </select>
                  </div>
                </div>
                <p className="text-sm leading-6 text-muted">
                  Search space: <strong className="font-medium text-ink">{number.format(Number(planInfo.fullTotal))} combinations</strong> from lengths 1–{maxLength}, shortest first.{' '}
                  {planInfo.capped ? `Only the first ${number.format(MAX_ATTEMPTS)} are checked; the rest remain untested.` : `Up to ${number.format(MAX_ATTEMPTS)} guesses are allowed.`}
                </p>
              </>
            ) : (
              <>
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="attack-wordlist" className="field-label">Your wordlist</label>
                    <span className="text-xs text-muted">{number.format(baseWordCount)} unique words</span>
                  </div>
                  <textarea id="attack-wordlist" rows={7} maxLength={300000} disabled={running} value={wordlist} onChange={(event) => { reset(); setWordlist(event.target.value) }} spellCheck={false} className="input-field resize-y font-mono" />
                  <p className="field-hint">One password per line. Empty lines and duplicates are skipped.</p>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={variations} disabled={running} onChange={(event) => { reset(); setVariations(event.target.checked) }} className="h-4 w-4" />
                  Add common variations
                </label>
                {variations && <p className="field-hint">Adds lowercase, UPPERCASE, Capitalised, and the endings 1, 123, !, 2026 after each word.</p>}
                <div>
                  <label htmlFor="dictionary-speed" className="field-label">Demo pace</label>
                  <select id="dictionary-speed" value={speed} disabled={running} onChange={(event) => { reset(); setSpeed(Number(event.target.value)) }} className="input-field">
                    <option value={10}>Slow · 10/sec</option>
                    <option value={60}>Normal · 60/sec</option>
                    <option value={1000}>Quick · 1,000/sec</option>
                  </select>
                </div>
                <p className="text-sm text-muted">Search space: <strong className="font-medium text-ink">{number.format(planInfo.total)} candidates</strong>, tried in list order.</p>
              </>
            )}

            {planInfo.message && <p role="alert" className="rounded border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{planInfo.message}</p>}

            <div className="flex flex-wrap gap-2 pt-1">
              {running
                ? <button type="button" onClick={stop} className="btn-primary">Stop</button>
                : <button type="button" onClick={start} disabled={!target || Boolean(planInfo.message)} className="btn-primary">{status === 'idle' ? 'Start' : 'Run again'}</button>}
              <button type="button" onClick={reset} className="btn-secondary">Reset</button>
            </div>
          </section>

          <section aria-labelledby="live-attempts-heading" className="min-w-0 space-y-4 border-t border-line p-5 sm:p-6 lg:border-t-0 lg:border-l">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
              <h3 id="live-attempts-heading" className="text-base font-medium">Live attempts</h3>
              <span className="text-sm font-medium text-muted">{info.label}</span>
            </header>

            <dl className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <dt className="text-xs text-muted">Guesses</dt>
                <dd className="mt-1 text-xl font-medium tabular-nums">{number.format(attempts)}<span className="ml-1 text-xs font-normal text-muted">/ {number.format(total)}</span></dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Elapsed</dt>
                <dd data-testid="password-elapsed-time" className="mt-1 text-xl font-medium tabular-nums">{((snapshot?.elapsedMs ?? 0) / 1000).toFixed(1)}<span className="ml-1 text-xs font-normal text-muted">s</span></dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Progress</dt>
                <dd className="mt-1 text-xl font-medium tabular-nums">{progress.toFixed(1)}<span className="ml-0.5 text-xs font-normal text-muted">%</span></dd>
              </div>
            </dl>
            <progress aria-label="Attack progress" value={attempts} max={Math.max(1, total)} className="password-progress block h-1 w-full overflow-hidden accent-brand" />
            {planInfo.capped && <p className="field-hint">Progress is against the {number.format(MAX_ATTEMPTS)}-guess demo limit.</p>}
            <p className="break-words text-sm"><span className="text-muted">Current guess: </span><code data-testid="password-current-guess" className="font-mono font-medium text-brand">{snapshot?.currentGuess ? JSON.stringify(snapshot.currentGuess) : '—'}</code></p>

            <AttemptLog key={logVersion} guesses={guesses.current} matched={snapshot?.matched} />

            <div aria-live="polite" aria-atomic="true">
              {resultText[status] && (
                <p data-motion-result className={`break-words border-l-2 px-3 py-1 text-sm leading-6 ${
                  status === 'found' ? 'border-success text-success' :
                  status === 'error' ? 'border-danger text-danger' :
                  'border-line text-muted'
                }`}>{resultText[status]}</p>
              )}
            </div>
          </section>
        </div>
      </div>

      <section aria-labelledby="password-strength-heading" className="panel space-y-4 p-5 sm:p-6">
        <header className="flex flex-wrap items-center gap-3 border-b border-line pb-3">
          <h3 id="password-strength-heading" className="text-base font-medium">Password strength</h3>
          <span className="ml-auto text-sm font-medium">{estimate ? strengthNames[estimate.score] : 'Enter a password'} <span className="font-normal text-muted">({estimate?.score ?? '—'} / 4)</span></span>
        </header>
        <div className="flex w-full gap-1" role="meter" aria-label="Password strength score" aria-valuemin={0} aria-valuemax={4} aria-valuenow={estimate?.score ?? 0} aria-valuetext={estimate ? strengthNames[estimate.score] : 'Enter a password'}>
          {[0, 1, 2, 3, 4].map((index) => <span key={index} className={`h-1 flex-1 ${estimate && index <= estimate.score ? strengthColours[estimate.score] : 'bg-line'}`} />)}
        </div>
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted">Offline · 10k guesses/sec</dt>
            <dd className="mt-1 text-base font-medium tabular-nums">{estimate?.crack_times_display.offline_slow_hashing_1e4_per_second ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Online · 100 guesses/hour</dt>
            <dd className="mt-1 text-base font-medium tabular-nums">{estimate?.crack_times_display.online_throttling_100_per_hour ?? '—'}</dd>
          </div>
        </dl>
        <div className="space-y-1.5 text-sm leading-6">
          {estimate?.feedback.warning && <p className="font-medium text-ink">{estimate.feedback.warning}</p>}
          {estimate?.feedback.suggestions.length
            ? <ul className="list-disc space-y-1 pl-5 text-muted">{estimate.feedback.suggestions.map((suggestion) => <li key={suggestion}>{suggestion}</li>)}</ul>
            : !estimate ? <p className="text-muted">Enter a password to see recommendations.</p>
            : !estimate.feedback.warning && <p className="text-muted">No recommendations from zxcvbn.</p>}
        </div>
      </section>

      <p className="text-xs leading-5 text-muted">Guesses are deliberately paced for teaching; elapsed time is not a real-world cracking benchmark. Real services verify password hashes rather than plaintext.</p>
    </div>
  )
}
