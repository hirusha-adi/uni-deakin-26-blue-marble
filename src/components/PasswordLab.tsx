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
  const brute = method === 'brute'
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
  const alphabetSize = new Set(Array.from(alphabet)).size
  const bruteForceCombinations = brute && !planInfo.message ? alphabetSize ** maxLength : null

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
  const passwordField = (
    <div>
      <label htmlFor="demo-password" className="field-label">Password</label>
      <input id="demo-password" type="text" autoComplete="off" spellCheck={false} maxLength={64} disabled={running} value={target} onChange={(event) => { reset(); setTarget(event.target.value) }} className="input-field font-mono" aria-describedby="demo-password-help" />
      <p id="demo-password-help" className="field-hint">Use a made-up password.</p>
    </div>
  )
  const presetButtons = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
      {presets.map(([preset, label]) => (
        <button key={preset} type="button" disabled={running} onClick={() => usePreset(preset)} className="font-medium text-brand underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:opacity-45">
          {label}
        </button>
      ))}
    </div>
  )
  const actionButtons = (
    <div className="flex flex-wrap gap-2 pt-1">
      {running
        ? <button type="button" onClick={stop} className="btn-primary">Stop</button>
        : <button type="button" onClick={start} disabled={!target || Boolean(planInfo.message)} className="btn-primary">{status === 'idle' ? 'Start' : 'Run again'}</button>}
      <button type="button" onClick={reset} className="btn-secondary">Reset</button>
    </div>
  )
  const settingsError = planInfo.message && <p role="alert" className="rounded border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{planInfo.message}</p>
  const strengthSection = (
    <section aria-labelledby="password-strength-heading" className={brute ? 'space-y-3 border-t border-line pt-5' : 'min-w-0 space-y-3'}>
      <header className="flex flex-wrap items-center gap-3">
        <h3 id="password-strength-heading" className="text-sm font-medium">Strength</h3>
        <span className="ml-auto text-xs font-medium">{estimate ? strengthNames[estimate.score] : 'Enter a password'} <span className="font-normal text-muted">({estimate?.score ?? '—'} / 4)</span></span>
      </header>
      <div className="flex w-full gap-1" role="meter" aria-label="Password strength score" aria-valuemin={0} aria-valuemax={4} aria-valuenow={estimate?.score ?? 0} aria-valuetext={estimate ? strengthNames[estimate.score] : 'Enter a password'}>
        {[0, 1, 2, 3, 4].map((index) => <span key={index} className={`h-1 flex-1 ${estimate && index <= estimate.score ? strengthColours[estimate.score] : 'bg-line'}`} />)}
      </div>
      <dl className={`grid gap-4 text-sm ${brute ? 'sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2' : 'sm:grid-cols-2'}`}>
        <div>
          <dt className="text-xs text-muted">Offline · 10k guesses/sec</dt>
          <dd className="mt-1 text-sm font-medium tabular-nums">{estimate?.crack_times_display.offline_slow_hashing_1e4_per_second ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Online · 100 guesses/hour</dt>
          <dd className="mt-1 text-sm font-medium tabular-nums">{estimate?.crack_times_display.online_throttling_100_per_hour ?? '—'}</dd>
        </div>
      </dl>
      {(estimate?.feedback.warning || Boolean(estimate?.feedback.suggestions.length)) && (
        <div className="space-y-1.5 text-sm leading-6">
          {estimate?.feedback.warning && <p className="font-medium text-ink">{estimate.feedback.warning}</p>}
          {Boolean(estimate?.feedback.suggestions.length) && <ul className="list-disc space-y-1 pl-5 text-muted">{estimate?.feedback.suggestions.map((suggestion) => <li key={suggestion}>{suggestion}</li>)}</ul>}
        </div>
      )}
    </section>
  )

  return (
    <div ref={feedbackScope} className="space-y-4">
      <div className="panel overflow-hidden">
        {!brute && (
          <section aria-label="Dictionary controls" className="grid items-start gap-4 border-b border-line p-5 sm:grid-cols-[minmax(0,1fr)_8rem_auto] sm:p-6">
            {passwordField}
            <div>
              <label htmlFor="dictionary-speed" className="field-label">Demo pace</label>
              <select id="dictionary-speed" value={speed} disabled={running} onChange={(event) => { reset(); setSpeed(Number(event.target.value)) }} className="input-field">
                <option value={10}>10/sec</option>
                <option value={60}>60/sec</option>
                <option value={1000}>1,000/sec</option>
              </select>
            </div>
            <div className="sm:pt-7">{actionButtons}</div>
            {settingsError && <div className="sm:col-span-3">{settingsError}</div>}
          </section>
        )}
        <div className={`grid ${brute ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,3fr)]' : 'lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]'}`}>
          <section aria-labelledby={brute ? 'password-settings-heading' : 'dictionary-wordlist-heading'} className={brute ? 'min-w-0 space-y-4 p-5 sm:p-6' : 'flex min-w-0 flex-col p-5 sm:p-6'}>
            {brute ? (
              <>
                <header className="sr-only">
                  <h3 id="password-settings-heading" className="text-base font-medium">Settings</h3>
                </header>
                {passwordField}
                {presetButtons}
                <div>
                  <label htmlFor="attack-alphabet" className="field-label">Characters to try</label>
                  <input id="attack-alphabet" value={alphabet} maxLength={64} disabled={running} onChange={(event) => { reset(); setAlphabet(event.target.value) }} spellCheck={false} className="input-field font-mono" />
                  <p className="field-hint">{alphabetSize} unique characters{alphabetSize < Array.from(alphabet).length ? '. Duplicates are ignored.' : ''}</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
                  <div>
                    <label htmlFor="attack-max-length" className="field-label">Maximum length</label>
                    <select id="attack-max-length" disabled={running} value={maxLength} onChange={(event) => { reset(); setMaxLength(Number(event.target.value)) }} className="input-field">
                      {[1, 2, 3, 4, 5, 6].map((length) => <option key={length} value={length}>{length} {length === 1 ? 'character' : 'characters'}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="attack-speed" className="field-label">Demo pace</label>
                    <select id="attack-speed" disabled={running} value={speed} onChange={(event) => { reset(); setSpeed(Number(event.target.value)) }} className="input-field">
                      <option value={10}>10/sec</option>
                      <option value={60}>60/sec</option>
                      <option value={1000}>1,000/sec</option>
                      <option value={25000}>25,000/sec</option>
                    </select>
                  </div>
                </div>
                {settingsError}
                {actionButtons}
                {strengthSection}
              </>
            ) : (
              <div className="flex flex-1 flex-col">
                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <label id="dictionary-wordlist-heading" htmlFor="attack-wordlist" className="field-label">Your wordlist</label>
                  <span className="text-xs text-muted">{number.format(baseWordCount)} unique words</span>
                </div>
                <textarea id="attack-wordlist" rows={12} maxLength={300000} disabled={running} value={wordlist} onChange={(event) => { reset(); setWordlist(event.target.value) }} spellCheck={false} className="input-field min-h-80 flex-auto resize-y font-mono" />
                <p className="field-hint">One per line. Duplicates and blanks are skipped.</p>
              </div>
            )}
          </section>

          <section aria-labelledby="live-attempts-heading" className="min-w-0 space-y-4 border-t border-line p-5 sm:p-6 lg:border-t-0 lg:border-l">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
              <h3 id="live-attempts-heading" className="text-base font-medium">Live attempts</h3>
              {status !== 'idle' && <span className="text-sm font-medium text-muted">{info.label}</span>}
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
            <p className="break-words text-sm"><span className="text-muted">Current guess: </span><code data-testid="password-current-guess" className="font-mono font-medium text-brand">{snapshot?.currentGuess ? JSON.stringify(snapshot.currentGuess) : '—'}</code></p>

            <AttemptLog key={logVersion} guesses={guesses.current} matched={snapshot?.matched} compact />

            <div aria-live="polite" aria-atomic="true">
              {resultText[status] && (
                <p data-motion-result className={`break-words border-l-2 px-3 py-1 text-sm leading-6 ${
                  status === 'found' ? 'border-success text-success' :
                  status === 'error' ? 'border-danger text-danger' :
                  'border-line text-muted'
                }`}>{resultText[status]}</p>
              )}
            </div>

            {bruteForceCombinations !== null && (
              <section aria-labelledby="possible-guesses-heading" className="space-y-3 border-t border-line pt-4">
                <div>
                  <h4 id="possible-guesses-heading" className="text-sm font-medium">Possible guesses</h4>
                  <p className="mt-1 text-xs text-muted">{maxLength}-character passwords · {alphabetSize} choices per character</p>
                </div>
                <p className="break-words font-mono text-sm leading-6 tabular-nums">
                  {Array.from({ length: maxLength }, () => number.format(alphabetSize)).join(' × ')} = <strong className="font-medium">{number.format(bruteForceCombinations)}</strong>
                </p>
                {maxLength > 1 && <p className="text-xs leading-5 text-muted">The demo tries lengths 1–{maxLength}, shortest first: {number.format(Number(planInfo.fullTotal))} total guesses.</p>}
                {planInfo.capped && <p className="text-xs leading-5 text-warn">The demo checks only the first {number.format(MAX_ATTEMPTS)} guesses. Remaining combinations stay untested.</p>}
              </section>
            )}
          </section>
        </div>
        {!brute && (
          <div className="border-t border-line p-5 sm:p-6">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <section aria-label="Dictionary options" className="min-w-0 space-y-4">
                {presetButtons}
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" checked={variations} disabled={running} onChange={(event) => { reset(); setVariations(event.target.checked) }} className="mt-0.5 h-4 w-4 shrink-0" />
                  Add common variations
                </label>
                {variations && <p className="field-hint">Adds lowercase, UPPERCASE, Capitalised, and the endings 1, 123, !, 2026 after each word.</p>}
              </section>
              {strengthSection}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
