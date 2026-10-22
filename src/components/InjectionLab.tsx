import { useEffect, useRef, useState } from 'react'
import { useFeedbackMotion } from '../hooks/useFeedbackMotion'
import { buildLoginQuery, runSqlLogin, SQL_ATTACK_USERNAME, SQL_DEMO_PASSWORD, SQL_DEMO_USERNAME, SQL_INPUT_MAX_LENGTH, type SqlLoginResult, type SqlMode } from '../lib/sqlDemo'
import { loadSqlEngine } from '../lib/sqlEngine'
import { buildXssDocument, readXssMessage, XSS_MAX_LENGTH, XSS_PAYLOAD, XSS_PLAIN_COMMENT, XSS_SANDBOX } from '../lib/xssDemo'

function ProtectionToggle({ checked, onChange, disabled = false }: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`flex w-fit items-center gap-2 py-1 text-sm ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand" />
      Protection on
    </label>
  )
}

function StatusHeader({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3 sm:px-6">
      <div className="flex items-center gap-2">{left}</div>
      {right}
    </div>
  )
}

function XssDemo() {
  const [comment, setComment] = useState(XSS_PAYLOAD)
  const [protectedMode, setProtectedMode] = useState(false)
  const [frameDocument, setFrameDocument] = useState(() => buildXssDocument(XSS_PLAIN_COMMENT, true))
  const [runId, setRunId] = useState(0)
  const [didRun, setDidRun] = useState(false)
  const [scriptMessage, setScriptMessage] = useState<string | null>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const feedbackRef = useRef<HTMLDivElement>(null)
  const feedbackTrigger = scriptMessage !== null ? `${runId}:${scriptMessage}` : didRun && protectedMode ? runId : null
  useFeedbackMotion(feedbackRef, feedbackTrigger, feedbackTrigger !== null)

  useEffect(() => {
    const receiveMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== iframeRef.current?.contentWindow) return
      const message = readXssMessage(event.data)
      if (message !== null) setScriptMessage(message)
    }
    window.addEventListener('message', receiveMessage)
    return () => window.removeEventListener('message', receiveMessage)
  }, [])

  function clearPreview() {
    setFrameDocument(buildXssDocument(XSS_PLAIN_COMMENT, true))
    setRunId((previous) => previous + 1)
    setScriptMessage(null)
    setDidRun(false)
  }

  function changeProtection(checked: boolean) {
    setProtectedMode(checked)
    clearPreview()
  }

  function runComment() {
    setScriptMessage(null)
    setDidRun(true)
    setFrameDocument(buildXssDocument(comment, protectedMode))
    setRunId((previous) => previous + 1)
  }

  function reset() {
    setComment(XSS_PAYLOAD)
    setProtectedMode(false)
    clearPreview()
  }

  const pill = scriptMessage !== null
    ? <span className="pill pill-danger">Script executed</span>
    : didRun && protectedMode
      ? <span className="pill pill-success">Displayed as text</span>
      : didRun
        ? <span className="pill pill-brand">Comment posted</span>
        : <span className="pill pill-neutral">Ready</span>

  return (
    <div className="panel overflow-hidden">
      <StatusHeader
        left={<span className="text-xs text-muted">Fictional noticeboard · sandboxed</span>}
        right={pill}
      />
      <div className="grid items-start gap-6 p-5 sm:p-6 md:grid-cols-2">
        <section className="space-y-4">
          <div>
            <label htmlFor="xss-comment" className="field-label">Your noticeboard comment</label>
            <textarea id="xss-comment" className="input-field min-h-36 resize-y font-mono text-sm leading-relaxed" value={comment} maxLength={XSS_MAX_LENGTH} onChange={(event) => setComment(event.target.value)} spellCheck={false} />
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <span className="text-muted">Try:</span>
              <button className="btn-ghost" type="button" onClick={() => setComment(XSS_PLAIN_COMMENT)}>Normal comment</button>
              <button className="btn-ghost" type="button" onClick={() => setComment(XSS_PAYLOAD)}>XSS payload</button>
            </div>
          </div>
          <ProtectionToggle checked={protectedMode} onChange={changeProtection} />
          <div className="flex gap-2">
            <button type="button" className="btn-primary" onClick={runComment}>Run</button>
            <button type="button" className="btn-secondary" onClick={reset}>Reset</button>
          </div>
        </section>
        <section className="space-y-3">
          <p className="field-label">What the page shows</p>
          <iframe key={runId} ref={iframeRef} title="Isolated XSS noticeboard demonstration" sandbox={XSS_SANDBOX} srcDoc={frameDocument} referrerPolicy="no-referrer" className="block h-[270px] w-full rounded border border-line bg-surface" />
          <div ref={feedbackRef} aria-live="polite" className="min-h-10 text-sm leading-relaxed">
            {scriptMessage !== null
              ? <p data-motion-result className="text-danger"><strong>JavaScript executed.</strong> Demo alert: {scriptMessage}</p>
              : didRun && protectedMode
                ? <p data-motion-result className="text-success"><strong>Displayed as text.</strong> The code did not run.</p>
                : didRun
                  ? <p className="text-muted">Comment posted.</p>
                  : <p className="text-muted">Click Run to post your comment.</p>}
          </div>
        </section>
      </div>
    </div>
  )
}

function SqlDemo() {
  const [username, setUsername] = useState(SQL_DEMO_USERNAME)
  const [password, setPassword] = useState(SQL_DEMO_PASSWORD)
  const [mode, setMode] = useState<SqlMode>('vulnerable')
  const [result, setResult] = useState<SqlLoginResult | null>(null)
  const [busy, setBusy] = useState(false)
  const feedbackRef = useRef<HTMLDivElement>(null)
  useFeedbackMotion(feedbackRef, result, result !== null)
  const query = result?.query ?? buildLoginQuery(username, password, mode)

  function changeProtection(checked: boolean) {
    setMode(checked ? 'protected' : 'vulnerable')
    setResult(null)
  }

  function setExample(attack: boolean) {
    setUsername(attack ? SQL_ATTACK_USERNAME : SQL_DEMO_USERNAME)
    setPassword(attack ? 'anything' : SQL_DEMO_PASSWORD)
    setResult(null)
  }

  async function submitLogin() {
    setBusy(true)
    setResult(null)
    try {
      const SQL = await loadSqlEngine()
      setResult(runSqlLogin(SQL, username, password, mode))
    } catch {
      setResult({ status: 'error', query, error: 'The local database engine could not load. Refresh this page and try again.' })
    } finally {
      setBusy(false)
    }
  }

  function reset() {
    setUsername(SQL_DEMO_USERNAME)
    setPassword(SQL_DEMO_PASSWORD)
    setMode('vulnerable')
    setResult(null)
  }

  const pill = !result
    ? <span className="pill pill-neutral">{busy ? 'Starting database…' : 'Ready'}</span>
    : result.status === 'success'
      ? <span className="pill pill-success">Login successful</span>
      : result.status === 'rejected'
        ? <span className="pill pill-brand">Login rejected</span>
        : <span className="pill pill-danger">Query error</span>

  return (
    <div className="panel overflow-hidden">
      <StatusHeader
        left={<span className="text-xs text-muted">Fictional accounts · fresh in-browser database</span>}
        right={pill}
      />
      <div className="grid items-start gap-6 p-5 sm:p-6 md:grid-cols-2">
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void submitLogin() }}>
          <div>
            <label className="field-label" htmlFor="sql-username">Demo username</label>
            <input id="sql-username" className="input-field font-mono text-sm" value={username} disabled={busy} maxLength={SQL_INPUT_MAX_LENGTH} autoComplete="off" spellCheck={false} onChange={(event) => { setUsername(event.target.value); setResult(null) }} />
          </div>
          <div>
            <label className="field-label" htmlFor="sql-password">Demo password</label>
            <input id="sql-password" className="input-field font-mono text-sm" type="text" value={password} disabled={busy} maxLength={SQL_INPUT_MAX_LENGTH} autoComplete="off" spellCheck={false} onChange={(event) => { setPassword(event.target.value); setResult(null) }} />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <span className="text-muted">Try:</span>
            <button className="btn-ghost" type="button" disabled={busy} onClick={() => setExample(false)}>Valid student login</button>
            <button className="btn-ghost" type="button" disabled={busy} onClick={() => setExample(true)}>Login bypass</button>
          </div>
          <ProtectionToggle checked={mode === 'protected'} onChange={changeProtection} disabled={busy} />
          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Running…' : 'Run'}</button>
            <button type="button" className="btn-secondary" onClick={reset} disabled={busy}>Reset</button>
          </div>
        </form>
        <section className="space-y-4">
          <div>
            <p className="field-label">{result ? 'Executed query' : 'Login query'}</p>
            <pre className="code-panel whitespace-pre-wrap break-words p-3.5 text-sm leading-relaxed"><code>{query}</code></pre>
          </div>
          {mode === 'protected' && (
            <div>
              <p className="field-label">Bound values — treated as data</p>
              <pre className="code-panel whitespace-pre-wrap break-words p-3 text-sm">{JSON.stringify(result?.parameters ?? [username, password], null, 2)}</pre>
            </div>
          )}
          <div ref={feedbackRef} className="min-h-20 text-sm leading-relaxed" aria-live="polite" aria-atomic="true">
            {result?.status === 'success' ? (
              <div data-motion-result className="text-success">
                <p className="font-medium">Welcome, {result.user?.displayName}</p>
                <p className="mt-1 text-sm">Account: {result.user?.username} · {result.user?.role}</p>
                {result.user?.username === 'admin' && mode === 'vulnerable' && <p className="mt-2 text-sm text-danger">The admin account was reached without its password.</p>}
              </div>
            ) : result?.status === 'rejected' ? (
              <div data-motion-result>
                <p className="font-medium">Login rejected</p>
                <p className="mt-1 text-muted">{mode === 'protected' ? 'The input was treated as a username, so the bypass failed.' : 'The username and password did not match.'}</p>
              </div>
            ) : result?.status === 'error' ? (
              <div data-motion-result className="text-danger">
                <p className="font-medium">Query could not run</p>
                <p className="mt-1 break-words text-sm">{result.error}</p>
              </div>
            ) : (
              <p className="text-muted">Click Run to try the login.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

export default function InjectionLab({ demo }: { demo: 'xss' | 'sql' }) {
  return demo === 'xss' ? <XssDemo /> : <SqlDemo />
}
