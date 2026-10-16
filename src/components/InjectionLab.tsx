import { useEffect, useRef, useState } from 'react'
import { buildLoginQuery, runSqlLogin, SQL_ATTACK_USERNAME, SQL_DEMO_PASSWORD, SQL_DEMO_USERNAME, SQL_INPUT_MAX_LENGTH, type SqlLoginResult, type SqlMode } from '../lib/sqlDemo'
import { loadSqlEngine } from '../lib/sqlEngine'
import { buildXssDocument, readXssMessage, XSS_MAX_LENGTH, XSS_PAYLOAD, XSS_PLAIN_COMMENT, XSS_SANDBOX } from '../lib/xssDemo'

function ProtectionToggle({ checked, onChange, disabled = false }: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-brand" />
      Protection on
    </label>
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

  return (
    <div className="panel p-5 sm:p-6">
      <p className="mb-6 text-sm leading-relaxed text-muted">Try a comment that makes a page run JavaScript, then turn protection on and try again.</p>
      <div className="grid items-start gap-6 md:grid-cols-2">
        <div>
          <label htmlFor="xss-comment" className="field-label">Your noticeboard comment</label>
          <textarea id="xss-comment" className="input-field min-h-32 resize-y font-mono text-sm leading-relaxed" value={comment} maxLength={XSS_MAX_LENGTH} onChange={(event) => setComment(event.target.value)} spellCheck={false} />
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn-secondary" type="button" onClick={() => setComment(XSS_PAYLOAD)}>Try an XSS payload</button>
            <button className="btn-secondary" type="button" onClick={() => setComment(XSS_PLAIN_COMMENT)}>Normal comment</button>
          </div>
          <div className="mt-5"><ProtectionToggle checked={protectedMode} onChange={changeProtection} /></div>
          <div className="mt-5 flex gap-2">
            <button type="button" className="btn-primary" onClick={runComment}>Run</button>
            <button type="button" className="btn-secondary" onClick={reset}>Reset</button>
          </div>
        </div>
        <div>
          <p className="field-label">What the page shows</p>
          <iframe key={runId} ref={iframeRef} title="Isolated XSS noticeboard demonstration" sandbox={XSS_SANDBOX} srcDoc={frameDocument} referrerPolicy="no-referrer" className="block h-[270px] w-full rounded-lg border border-line" />
          <div aria-live="polite" className="mt-3 min-h-10 text-sm leading-relaxed">
            {scriptMessage !== null ? <p className="text-[#9a4b20]"><strong>JavaScript executed.</strong> Demo alert: {scriptMessage}</p> : didRun && protectedMode ? <p className="text-brand"><strong>Displayed as text.</strong> The code did not run.</p> : didRun ? <p className="text-muted">Comment posted.</p> : <p className="text-muted">Click Run to post your comment.</p>}
          </div>
        </div>
      </div>
      <section className="mt-6 border-t border-line pt-5 text-sm leading-relaxed" aria-labelledby="xss-explanation">
        <h3 id="xss-explanation" className="mb-3 font-semibold">How it works</h3>
        <div className="space-y-3 text-muted">
          <p>Without protection, the page treats your comment as HTML. In the sample, <code>onerror</code> runs JavaScript when the image fails to load.</p>
          <p>With protection on, HTML characters are escaped and the comment appears as plain text. Try the same payload again to see the difference. Real apps need output encoding appropriate to where the input is displayed.</p>
          <p>The preview runs in an isolated browser sandbox that cannot access this app’s page. External resources are blocked. Demo alerts appear here instead of opening a popup.</p>
        </div>
        <p className="mt-3">Treating input as text stops this attack.</p>
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

  return (
    <div className="panel p-5 sm:p-6">
      <p className="mb-6 text-sm leading-relaxed text-muted">Try logging in normally, then use the example to bypass the password check.</p>
      <div className="grid items-start gap-6 md:grid-cols-2">
        <form onSubmit={(event) => { event.preventDefault(); void submitLogin() }}>
          <div className="space-y-4">
            <div><label className="field-label" htmlFor="sql-username">Demo username</label><input id="sql-username" className="input-field font-mono text-sm" value={username} disabled={busy} maxLength={SQL_INPUT_MAX_LENGTH} autoComplete="off" spellCheck={false} onChange={(event) => { setUsername(event.target.value); setResult(null) }} /></div>
            <div><label className="field-label" htmlFor="sql-password">Demo password</label><input id="sql-password" className="input-field font-mono text-sm" type="text" value={password} disabled={busy} maxLength={SQL_INPUT_MAX_LENGTH} autoComplete="off" spellCheck={false} onChange={(event) => { setPassword(event.target.value); setResult(null) }} /></div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn-secondary" type="button" disabled={busy} onClick={() => setExample(false)}>Valid student login</button>
            <button className="btn-secondary" type="button" disabled={busy} onClick={() => setExample(true)}>Try a login bypass</button>
          </div>
          <div className="mt-5"><ProtectionToggle checked={mode === 'protected'} onChange={changeProtection} disabled={busy} /></div>
          <div className="mt-5 flex gap-2">
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Running…' : 'Run'}</button>
            <button type="button" className="btn-secondary" onClick={reset} disabled={busy}>Reset</button>
          </div>
        </form>
        <div>
          <p className="field-label">{result ? 'Executed query' : 'Login query'}</p>
          <pre className="code-panel whitespace-pre-wrap break-words p-4 text-sm leading-relaxed"><code>{query}</code></pre>
          {mode === 'protected' && <div className="mt-3"><p className="field-label">Bound values — treated as data</p><pre className="code-panel whitespace-pre-wrap break-words p-3 text-sm">{JSON.stringify(result?.parameters ?? [username, password], null, 2)}</pre></div>}
          <div className="mt-4 min-h-20 text-sm leading-relaxed" aria-live="polite" aria-atomic="true">
            {result?.status === 'success' ? <><p className="font-semibold text-brand">Login successful</p><p className="mt-1">Welcome, {result.user?.displayName}.</p><p className="mt-1 text-muted">Account: {result.user?.username} · {result.user?.role}</p>{result.user?.username === 'admin' && mode === 'vulnerable' && <p className="mt-2 text-[#9a4b20]">You reached the admin account without its password.</p>}</> : result?.status === 'rejected' ? <><p className="font-semibold">Login rejected</p><p className="mt-1 text-muted">{mode === 'protected' ? 'The input was treated as a username, so the bypass failed.' : 'The username and password did not match.'}</p></> : result?.status === 'error' ? <><p className="font-semibold text-[#9a4b20]">Query could not run</p><p className="mt-1 break-words text-muted">{result.error}</p></> : <p className="text-muted">{busy ? 'Starting the local database…' : 'Click Run to try the login.'}</p>}
          </div>
        </div>
      </div>
      <section className="mt-6 border-t border-line pt-5 text-sm leading-relaxed" aria-labelledby="sql-explanation">
        <h3 id="sql-explanation" className="mb-3 font-semibold">How it works</h3>
        <div className="space-y-3 text-muted">
          <p>Without protection, your input is inserted directly into the SQL query. In <code>admin' --</code>, the apostrophe closes the username and the two dashes comment out the password check on that line.</p>
          <p>With protection on, the question marks are placeholders. Bound values are handled separately as data, so the database searches for the exact username instead of executing your input as SQL. Try the same bypass again.</p>
          <p>A real SQLite database runs in your browser with three fictional accounts and resets after every attempt. Readable passwords keep this lesson simple; real apps should store password hashes.</p>
        </div>
        <p className="mt-3">Treating input as data stops this attack.</p>
      </section>
    </div>
  )
}

export default function InjectionLab({ demo }: { demo: 'xss' | 'sql' }) {
  return demo === 'xss' ? <XssDemo /> : <SqlDemo />
}
