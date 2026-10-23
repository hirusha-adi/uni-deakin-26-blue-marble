import { useEffect, useRef, useState } from 'react'
import { useFeedbackMotion } from '../hooks/useFeedbackMotion'
import { buildLoginQuery, runSqlLogin, SQL_ATTACK_PAYLOADS, SQL_DEMO_PASSWORD, SQL_DEMO_USERNAME, SQL_INPUT_MAX_LENGTH, type SqlLoginResult, type SqlMode } from '../lib/sqlDemo'
import { loadSqlEngine } from '../lib/sqlEngine'
import { buildXssDocument, readXssMessage, XSS_MAX_LENGTH, XSS_PAYLOAD, XSS_PLAIN_COMMENT, XSS_SANDBOX } from '../lib/xssDemo'
import SqlQuery from './SqlQuery'

const XSS_PAYLOAD_EXAMPLES = [
  `<script>alert('Script tag executed!')</script>`,
  `<svg onload="alert('SVG loaded!')"></svg>`,
  `<button onclick="alert('Button clicked!')">Click me</button>`,
  `<span onmouseover="alert('Mouse detected!')">Hover over me</span>`,
  `<script>
document.body.style.background = '#ffe082';
alert('Background changed!');
</script>`,
] as const

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
      <section aria-label="Comment controls" className="grid items-start gap-4 border-b border-line p-5 sm:p-6 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <label htmlFor="xss-comment" className="field-label">Your noticeboard comment</label>
          <textarea id="xss-comment" rows={2} className="input-field min-h-20 resize-y font-mono text-sm leading-relaxed" value={comment} maxLength={XSS_MAX_LENGTH} onChange={(event) => setComment(event.target.value)} spellCheck={false} />
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
            <button className="font-medium text-brand underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:opacity-45" type="button" onClick={() => setComment(XSS_PLAIN_COMMENT)}>Normal comment</button>
            <button className="font-medium text-brand underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:opacity-45" type="button" onClick={() => setComment(XSS_PAYLOAD)}>XSS payload</button>
            {XSS_PAYLOAD_EXAMPLES.map((payload, index) => (
              <button key={payload} className="font-medium text-brand underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:opacity-45" type="button" onClick={() => setComment(payload)}>Payload {index + 1}</button>
            ))}
          </div>
        </div>
        <div className="space-y-4 md:pt-7">
          <ProtectionToggle checked={protectedMode} onChange={changeProtection} />
          <div className="flex gap-2">
            <button type="button" className="btn-primary" onClick={runComment}>Run</button>
            <button type="button" className="btn-secondary" onClick={reset}>Reset</button>
          </div>
        </div>
      </section>
      <section aria-labelledby="xss-preview-heading" className="space-y-3 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 id="xss-preview-heading" className="text-sm font-medium">What the page shows</h3>
          {pill}
        </div>
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

  function setExample(exampleUsername = SQL_DEMO_USERNAME, examplePassword = SQL_DEMO_PASSWORD) {
    setUsername(exampleUsername)
    setPassword(examplePassword)
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
      <div className="grid items-start gap-6 p-5 sm:p-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <form className="min-w-0 space-y-4" onSubmit={(event) => { event.preventDefault(); void submitLogin() }}>
          <div>
            <label className="field-label" htmlFor="sql-username">Demo username</label>
            <input id="sql-username" className="input-field font-mono text-sm" value={username} disabled={busy} maxLength={SQL_INPUT_MAX_LENGTH} autoComplete="off" spellCheck={false} onChange={(event) => { setUsername(event.target.value); setResult(null) }} />
          </div>
          <div>
            <label className="field-label" htmlFor="sql-password">Demo password</label>
            <input id="sql-password" className="input-field font-mono text-sm" type="text" value={password} disabled={busy} maxLength={SQL_INPUT_MAX_LENGTH} autoComplete="off" spellCheck={false} onChange={(event) => { setPassword(event.target.value); setResult(null) }} />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
            <button className="font-medium text-brand underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:opacity-45" type="button" disabled={busy} onClick={() => setExample()}>Valid student login</button>
            {SQL_ATTACK_PAYLOADS.map((payload, index) => (
              <button key={index} className="font-medium text-brand underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:opacity-45" type="button" disabled={busy} onClick={() => setExample(payload.username, payload.password)}>Payload {index + 1}</button>
            ))}
          </div>
          <ProtectionToggle checked={mode === 'protected'} onChange={changeProtection} disabled={busy} />
          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Running…' : 'Run'}</button>
            <button type="button" className="btn-secondary" onClick={reset} disabled={busy}>Reset</button>
          </div>
        </form>
        <section className="min-w-0 space-y-4">
          <div>
            <p className="field-label">{result ? 'Executed query' : 'Login query'}</p>
            <SqlQuery query={query} />
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
