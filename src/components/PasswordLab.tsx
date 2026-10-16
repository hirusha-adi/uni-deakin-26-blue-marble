import { useEffect, useMemo, useRef, useState } from 'react'
import zxcvbn from 'zxcvbn'
import { buildDictionary, createAttackPlan, MAX_ATTEMPTS, type AttackConfig, type AttackMethod, type AttackSnapshot } from '../lib/passwordEngine'
import AttemptLog from './AttemptLog'

const DEFAULT_WORDLIST = '123456\npassword\nqwerty\nletmein\nwelcome\nadmin\nfootball\nmonkey\ndragon\nsunshine\niloveyou\npassword123\nblue marble\ndeakin2026'
const number = new Intl.NumberFormat('en-AU')
const strengthNames = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong']
const strengthColours = ['bg-red-500', 'bg-orange-500', 'bg-amber-500', 'bg-emerald-500', 'bg-brand']

type DisplayStatus = 'idle' | 'stopped' | 'error' | AttackSnapshot['status']
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
  const running = status === 'running'
  const config: AttackConfig = { method, target, alphabet, maxLength, wordlist, variations }
  const estimate = useMemo(() => target ? zxcvbn(target, ['blue marble', 'deakin', 'study tour', '2026']) : null, [target])

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
  const statusLabel: Record<DisplayStatus, string> = {
    idle: 'Ready', running: 'Trying passwords…', found: 'Password found', exhausted: 'Dictionary exhausted',
    limited: 'Demo limit reached', unsupported: 'Outside search settings', stopped: 'Stopped', error: 'Check your settings',
  }
  const resultText: Partial<Record<DisplayStatus, string>> = {
    found: `Found “${snapshot?.matched}” after ${number.format(attempts)} ${attempts === 1 ? 'guess' : 'guesses'}.`,
    exhausted: 'This password was not in the list. A different list could still find it.',
    limited: `Stopped at ${number.format(MAX_ATTEMPTS)} guesses. The remaining combinations have not been tried.`,
    unsupported: snapshot?.reason ?? 'Update your settings to include this password.',
    stopped: 'Start again to begin from the first guess.',
    error,
  }

  return (
    <div className="space-y-4">
      <p className="text-[15px] leading-6 text-muted">{method === 'brute' ? 'Brute force tries combinations one by one until a password matches.' : 'A dictionary attack tries passwords from a list of common words and phrases.'}</p>

      <div className="panel overflow-hidden">
        <div className="grid lg:grid-cols-2">
          <section aria-labelledby="password-settings-heading" className="space-y-4 p-5 sm:p-6">
            <h3 id="password-settings-heading" className="border-b border-line pb-3 text-base font-semibold">Settings</h3>
            <div>
              <label htmlFor="demo-password" className="field-label">Demo password</label>
              <input id="demo-password" type="text" autoComplete="off" spellCheck={false} maxLength={64} disabled={running} value={target} onChange={(event) => { reset(); setTarget(event.target.value) }} className="input-field font-mono" aria-describedby="demo-password-help" />
              <p id="demo-password-help" className="mt-1 text-sm text-muted">Use a made-up password.</p>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <span className="text-muted">Try:</span>
              {(method === 'brute' ? [['pin', '3-digit PIN'], ['letters', 'Tiny alphabet'], ['large', 'Bigger search']] : [['common', 'Common password'], ['phrase', 'Long phrase'], ['variants', 'Word + numbers']]).map(([preset, label]) => <button key={preset} type="button" disabled={running} onClick={() => usePreset(preset as Parameters<typeof usePreset>[0])} className="text-brand underline underline-offset-4 disabled:opacity-50">{label}</button>)}
            </div>
            {method === 'brute' ? (
              <>
                <div>
                  <label htmlFor="attack-alphabet" className="field-label">Characters to try</label>
                  <input id="attack-alphabet" value={alphabet} maxLength={64} disabled={running} onChange={(event) => { reset(); setAlphabet(event.target.value) }} spellCheck={false} className="input-field font-mono" />
                  <p className="mt-1 text-sm text-muted">{new Set(Array.from(alphabet)).size} unique characters. Repeated characters count once.</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div><label htmlFor="attack-max-length" className="field-label">Maximum length</label><select id="attack-max-length" disabled={running} value={maxLength} onChange={(event) => { reset(); setMaxLength(Number(event.target.value)) }} className="input-field">{[1, 2, 3, 4, 5, 6].map((length) => <option key={length} value={length}>{length} {length === 1 ? 'character' : 'characters'}</option>)}</select></div>
                  <div><label htmlFor="attack-speed" className="field-label">Demo pace</label><select id="attack-speed" disabled={running} value={speed} onChange={(event) => { reset(); setSpeed(Number(event.target.value)) }} className="input-field"><option value={10}>Slow · 10/sec</option><option value={60}>Normal · 60/sec</option><option value={1000}>Quick · 1,000/sec</option><option value={25000}>Fast · 25,000/sec</option></select></div>
                </div>
                <p className="text-sm leading-6 text-muted">Search space: <strong className="font-medium text-ink">{number.format(Number(planInfo.fullTotal))} combinations</strong> from lengths 1–{maxLength}, shortest first. {planInfo.capped ? `This demo checks only the first ${number.format(MAX_ATTEMPTS)}; the rest remain untested.` : `The browser demo allows up to ${number.format(MAX_ATTEMPTS)} guesses.`}</p>
              </>
            ) : (
              <>
                <div>
                  <div className="flex items-center justify-between gap-2"><label htmlFor="attack-wordlist" className="field-label">Your wordlist</label><span className="text-sm text-muted">{number.format(baseWordCount)} unique words</span></div>
                  <textarea id="attack-wordlist" rows={7} maxLength={300000} disabled={running} value={wordlist} onChange={(event) => { reset(); setWordlist(event.target.value) }} spellCheck={false} className="input-field resize-y font-mono" />
                  <p className="mt-1 text-sm text-muted">One password per line. Empty lines and duplicates are skipped.</p>
                </div>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={variations} disabled={running} onChange={(event) => { reset(); setVariations(event.target.checked) }} className="h-4 w-4 accent-[#075c48]" />Add common variations</label>
                {variations && <p className="text-sm leading-6 text-muted">Adds lowercase, UPPERCASE, Capitalised, and the endings 1, 123, !, 2026 after each word.</p>}
                <div><label htmlFor="dictionary-speed" className="field-label">Dictionary demo pace</label><select id="dictionary-speed" value={speed} disabled={running} onChange={(event) => { reset(); setSpeed(Number(event.target.value)) }} className="input-field"><option value={10}>Slow · 10/sec</option><option value={60}>Normal · 60/sec</option><option value={1000}>Quick · 1,000/sec</option></select></div>
                <p className="text-sm text-muted">Search space: <strong className="font-medium text-ink">{number.format(planInfo.total)} candidates</strong>, tried in list order.</p>
              </>
            )}
            {planInfo.message && <p role="alert" className="text-sm text-red-700">{planInfo.message}</p>}
            <div className="flex flex-wrap gap-2">
              {running ? <button type="button" onClick={stop} className="btn-primary">Stop demo</button> : <button type="button" onClick={start} disabled={!target || Boolean(planInfo.message)} className="btn-primary">{status === 'idle' ? 'Start demo' : 'Run again'}</button>}
              <button type="button" onClick={reset} className="btn-secondary">Reset</button>
            </div>
          </section>

          <section aria-labelledby="live-attempts-heading" className="min-w-0 space-y-4 border-t border-line p-5 sm:p-6 lg:border-t-0 lg:border-l">
            <h3 id="live-attempts-heading" className="border-b border-line pb-3 text-base font-semibold">Live attempts</h3>
            <dl className="flex flex-wrap justify-between gap-4 text-sm">
              <div><dt className="text-muted">Guesses tried</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{number.format(attempts)} <span className="text-sm font-normal text-muted">/ {number.format(total)}</span></dd></div>
              <div><dt className="text-muted">Time in this demo</dt><dd data-testid="password-elapsed-time" className="mt-1 text-lg font-semibold tabular-nums">{((snapshot?.elapsedMs ?? 0) / 1000).toFixed(1)} <span className="text-sm font-normal text-muted">seconds</span></dd></div>
              <div><dt className="text-muted">Progress</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{progress.toFixed(1)}%</dd></div>
            </dl>
            <progress aria-label="Attack progress" value={attempts} max={Math.max(1, total)} className="block h-2 w-full accent-[#075c48]" />
            {planInfo.capped && <p className="text-sm text-muted">Progress is against the {number.format(MAX_ATTEMPTS)}-guess demo limit.</p>}
            <p className="break-words text-sm"><span className="text-muted">Current guess: </span><code data-testid="password-current-guess" className="font-mono">{snapshot?.currentGuess ? JSON.stringify(snapshot.currentGuess) : '—'}</code></p>
            <AttemptLog key={logVersion} guesses={guesses.current} matched={snapshot?.matched} />
            <div aria-live="polite" aria-atomic="true"><p className={`text-sm font-semibold ${status === 'found' ? 'text-brand' : 'text-ink'}`}>{statusLabel[status]}</p>{resultText[status] && <p className="mt-1 break-words text-sm leading-6 text-muted">{resultText[status]}</p>}</div>
          </section>
        </div>

        <section aria-labelledby="password-strength-heading" className="space-y-4 border-t border-line p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <h3 id="password-strength-heading" className="text-base font-semibold">Password strength</h3>
            <div className="flex w-28 gap-1" role="meter" aria-label="Password strength score" aria-valuemin={0} aria-valuemax={4} aria-valuenow={estimate?.score ?? 0} aria-valuetext={estimate ? strengthNames[estimate.score] : 'Enter a password'}>{[0, 1, 2, 3, 4].map((index) => <span key={index} className={`h-2 flex-1 rounded-sm ${estimate && index <= estimate.score ? strengthColours[estimate.score] : 'bg-[#e3e9e0]'}`} />)}</div>
            <span className="font-medium">{estimate ? strengthNames[estimate.score] : 'Enter a password'} <span className="font-normal text-muted">({estimate?.score ?? '—'} / 4)</span></span>
          </div>
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted">Offline estimate · 10k guesses/sec</dt>
              <dd className="mt-1 font-semibold">{estimate?.crack_times_display.offline_slow_hashing_1e4_per_second ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted">Online estimate · 100 guesses/hour</dt>
              <dd className="mt-1 font-semibold">{estimate?.crack_times_display.online_throttling_100_per_hour ?? '—'}</dd>
            </div>
          </dl>
          <div className="space-y-2 text-sm leading-6">
            <h4 className="font-medium">Recommendations</h4>
            {estimate?.feedback.warning && <p>{estimate.feedback.warning}</p>}
            {estimate?.feedback.suggestions.length ? <ul className="list-disc space-y-1 pl-5 text-muted">{estimate.feedback.suggestions.map((suggestion) => <li key={suggestion}>{suggestion}</li>)}</ul> : !estimate ? <p className="text-muted">Enter a password to see recommendations.</p> : !estimate.feedback.warning && <p className="text-muted">No recommendations from zxcvbn.</p>}
          </div>
        </section>
      </div>

      <p className="text-sm leading-6 text-muted">This demo compares plaintext strings; real services normally verify password hashes. Guesses are deliberately paced for teaching; elapsed time is not a real-world cracking benchmark.</p>

      <p className="text-[15px] leading-6"><strong className="font-semibold">Remember:</strong> {method === 'brute' ? 'Longer passwords take more guesses.' : 'Common words and predictable endings are often guessed first.'}</p>
    </div>
  )
}
