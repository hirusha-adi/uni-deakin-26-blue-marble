'use client'

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useFeedbackMotion } from '../hooks/useFeedbackMotion'
import {
  clearBrowserChats,
  readBrowserChats,
  writeBrowserChats,
} from '../lib/promptChatBrowser'
import {
  MAX_CHAT_INPUT_LENGTH,
  MAX_CHAT_MESSAGES,
  MAX_CHAT_TURNS,
  MAX_SESSION_NAME_LENGTH,
  type ChatSession,
} from '../lib/promptChat'

interface ChatResponse {
  browserId?: string
  sessions?: ChatSession[]
  session?: ChatSession
  configured?: boolean
  error?: string
}

type PendingAction = 'loading' | 'creating' | 'sending' | 'refreshing' | null

async function requestChat(path: string, options?: RequestInit) {
  const response = await fetch(path, {
    ...options,
    credentials: 'same-origin',
    cache: 'no-store',
  })

  let data: ChatResponse
  try {
    data = await response.json() as ChatResponse
  } catch {
    throw new Error('The computer could not be reached. Try refreshing the chat.')
  }

  return { response, data }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}

export default function PromptInjectionLab() {
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [sessionName, setSessionName] = useState('')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [pending, setPending] = useState<PendingAction>('loading')
  const [error, setError] = useState<string | null>(null)
  const [newReplyId, setNewReplyId] = useState<string | null>(null)
  const [browserId, setBrowserId] = useState<string | null>(null)
  const [localSaveFailed, setLocalSaveFailed] = useState(false)
  const browserIdRef = useRef<string | null>(null)
  const activeIdRef = useRef<string | null>(null)
  const operationTokenRef = useRef(0)
  const operationRef = useRef(true)
  const focusComposerNextRef = useRef(false)
  const sendingSnapshotRef = useRef<{ sessionId: string; messageCount: number } | null>(null)
  const retryRef = useRef<{ sessionId: string; message: string; requestId: string } | null>(null)
  const sessionNameRef = useRef<HTMLInputElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const chatRef = useRef<HTMLDivElement>(null)

  const session = sessions.find((item) => item.id === activeId) ?? null
  const draft = session ? drafts[session.id] ?? '' : ''
  const messageCount = session?.messages.length ?? 0
  const showPendingMessage = pending === 'sending'
    && session?.id === sendingSnapshotRef.current?.sessionId
    && messageCount === sendingSnapshotRef.current?.messageCount
  const displayedMessageCount = Math.min(MAX_CHAT_MESSAGES, messageCount + (showPendingMessage ? 1 : 0))
  const full = messageCount >= MAX_CHAT_MESSAGES
  const disabled = pending !== null || !session || !configured || full || session.busy
  const canSend = !disabled && draft.trim().length > 0

  useFeedbackMotion(chatRef, newReplyId, newReplyId !== null)

  useEffect(() => {
    const controller = new AbortController()
    const token = ++operationTokenRef.current

    async function load() {
      try {
        await reconcileSessions(token, controller.signal)
      } catch (cause) {
        if (!controller.signal.aborted && token === operationTokenRef.current) setError(errorMessage(cause))
      } finally {
        if (!controller.signal.aborted && token === operationTokenRef.current) {
          operationRef.current = false
          setPending(null)
        }
      }
    }

    void load()
    return () => {
      controller.abort()
      operationTokenRef.current += 1
    }
    // Browser ownership is verified before any saved selection is restored.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!browserId || browserIdRef.current !== browserId) return
    setLocalSaveFailed(!writeBrowserChats(browserId, sessions, activeId))
  }, [browserId, sessions, activeId])

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
  }, [activeId, messageCount, pending])

  useEffect(() => {
    if (pending === null && focusComposerNextRef.current) {
      composerRef.current?.focus()
      focusComposerNextRef.current = false
    }
  }, [pending])

  function selectSession(id: string | null) {
    activeIdRef.current = id
    setActiveId(id)
  }

  function clearVerifiedBrowser() {
    browserIdRef.current = null
    setBrowserId(null)
    setSessions([])
    selectSession(null)
    setDrafts({})
    setSessionName('')
    setNewReplyId(null)
    setConfigured(null)
    retryRef.current = null
    sendingSnapshotRef.current = null
    focusComposerNextRef.current = false
    clearBrowserChats()
  }

  function updateSession(updated: ChatSession) {
    setSessions((current) => [updated, ...current.filter((item) => item.id !== updated.id)])
  }

  async function reconcileSessions(token: number, signal?: AbortSignal) {
    const { response, data } = await requestChat('/api/prompt-chat', { signal })
    if (signal?.aborted || token !== operationTokenRef.current) return false
    if (!response.ok || !data.sessions || !data.browserId) {
      // Even an error can report that this browser's anonymous identity changed.
      if (data.browserId && browserIdRef.current && data.browserId !== browserIdRef.current) clearVerifiedBrowser()
      throw new Error(data.error ?? 'The sessions could not be refreshed.')
    }

    const sameBrowser = browserIdRef.current === data.browserId
    if (browserIdRef.current && !sameBrowser) clearVerifiedBrowser()
    const saved = readBrowserChats(data.browserId)
    const preferredId = sameBrowser ? activeIdRef.current : saved.activeId
    const nextActiveId = data.sessions.some((item) => item.id === preferredId)
      ? preferredId
      : data.sessions[0]?.id ?? null

    // The browser copy remembers selection; the server controls history and limits.
    browserIdRef.current = data.browserId
    setBrowserId(data.browserId)
    setSessions(data.sessions)
    setConfigured(data.configured === true)
    selectSession(nextActiveId)
    return true
  }

  async function acceptResponseScope(data: ChatResponse, token: number) {
    if (token !== operationTokenRef.current) return false
    if (!data.browserId) throw new Error('The browser session could not be verified. Refresh the chat.')
    if (data.browserId === browserIdRef.current) return true

    clearVerifiedBrowser()
    await reconcileSessions(token)
    if (token === operationTokenRef.current) setError('This browser’s chat identity changed. Start or select a session to continue.')
    return false
  }

  async function refresh() {
    if (operationRef.current) return
    const token = ++operationTokenRef.current
    operationRef.current = true
    setPending('refreshing')
    setError(null)
    try {
      await reconcileSessions(token)
    } catch (cause) {
      if (token === operationTokenRef.current) setError(errorMessage(cause))
    } finally {
      if (token === operationTokenRef.current) {
        operationRef.current = false
        setPending(null)
      }
    }
  }

  async function createSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = sessionName.trim()
    if (!name || !configured || operationRef.current) return

    const token = ++operationTokenRef.current
    operationRef.current = true
    setPending('creating')
    setError(null)
    try {
      const { response, data } = await requestChat('/api/prompt-chat/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!await acceptResponseScope(data, token)) return
      if (!response.ok || !data.session) throw new Error(data.error ?? 'The session could not be created.')
      updateSession(data.session)
      selectSession(data.session.id)
      setSessionName('')
      setNewReplyId(null)
      focusComposerNextRef.current = true
    } catch (cause) {
      if (token === operationTokenRef.current) setError(errorMessage(cause))
    } finally {
      if (token === operationTokenRef.current) {
        operationRef.current = false
        setPending(null)
      }
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!session || !canSend || operationRef.current) return

    const sessionId = session.id
    const message = draft.trim()
    const previous = retryRef.current
    const requestId = previous?.sessionId === sessionId && previous.message === message
      ? previous.requestId
      : crypto.randomUUID()

    const token = ++operationTokenRef.current
    retryRef.current = { sessionId, message, requestId }
    sendingSnapshotRef.current = { sessionId, messageCount }
    operationRef.current = true
    setPending('sending')
    setError(null)
    setNewReplyId(null)

    try {
      const { response, data } = await requestChat('/api/prompt-chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, message, requestId }),
      })
      if (!await acceptResponseScope(data, token)) return
      if (data.session) updateSession(data.session)
      if (!response.ok || !data.session) throw new Error(data.error ?? 'The message could not be sent. Your draft is still here.')

      const reply = data.session.messages.at(-1)
      if (reply?.role === 'assistant') setNewReplyId(reply.id)
      setDrafts((current) => ({ ...current, [sessionId]: '' }))
      retryRef.current = null
    } catch (cause) {
      if (token !== operationTokenRef.current) return
      const messageError = errorMessage(cause)
      try {
        await reconcileSessions(token)
      } catch {
        // Keep the last known history and the draft when the connection is down.
      }
      if (token === operationTokenRef.current) setError(messageError)
    } finally {
      if (token === operationTokenRef.current) {
        operationRef.current = false
        focusComposerNextRef.current = true
        setPending(null)
      }
    }
  }

  function handleComposerKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      if (canSend) event.currentTarget.form?.requestSubmit()
    }
  }

  function startNewSession() {
    sessionNameRef.current?.scrollIntoView({ block: 'nearest' })
    sessionNameRef.current?.focus()
  }

  return (
    <div className="space-y-4">
      <section className="panel px-5 py-4 sm:px-6" aria-labelledby="prompt-challenge-title">
        <h2 id="prompt-challenge-title" className="font-medium">Capture the flag</h2>
        <p className="mt-1 text-sm leading-6 text-muted">
          The computer has a secret flag and instructions to keep it hidden. Can you convince it to reveal the flag?
          Try a technical question, role-play, or a persuasive story.
        </p>
        <p className="mt-2 text-xs leading-5 text-muted">
          Each session has {MAX_CHAT_TURNS} turns ({MAX_CHAT_MESSAGES} messages, counting your messages and the replies).
          Messages are sent to an AI service; use made-up scenarios and leave out personal information.
        </p>
      </section>

      <div className="panel grid overflow-hidden md:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="border-b border-line p-4 md:border-r md:border-b-0" aria-label="Chat sessions">
          <form onSubmit={createSession} className="space-y-3">
            <label htmlFor="chat-session-name" className="field-label">Session name</label>
            <input
              ref={sessionNameRef}
              id="chat-session-name"
              className="input-field"
              placeholder="e.g. Team Blue Marble"
              value={sessionName}
              onChange={(event) => setSessionName(event.target.value)}
              maxLength={MAX_SESSION_NAME_LENGTH}
              disabled={pending !== null || !configured}
              required
            />
            <button type="submit" className="btn-primary w-full" disabled={pending !== null || !configured || !sessionName.trim()}>
              {pending === 'creating' ? 'Creating…' : 'New session'}
            </button>
          </form>

          <div className="mt-5 flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">Your sessions</h3>
            <button type="button" className="btn-ghost text-xs" onClick={() => void refresh()} disabled={pending !== null}>
              {pending === 'refreshing' ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          {sessions.length > 0 ? (
            <ul className="mt-2 max-h-60 space-y-1 overflow-y-auto md:max-h-[440px]">
              {sessions.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-current={activeId === item.id ? 'true' : undefined}
                    disabled={pending !== null}
                    onClick={() => { selectSession(item.id); setNewReplyId(null); setError(null) }}
                    className={`w-full rounded border-l-2 px-3 py-2.5 text-left transition-colors disabled:cursor-wait ${activeId === item.id ? 'border-brand bg-brand-soft' : 'border-transparent hover:bg-paper'}`}
                  >
                    <span className="block truncate text-sm font-medium">{item.name}</span>
                    <span className="mt-0.5 block text-xs text-muted">
                      {item.messages.length + (showPendingMessage && item.id === activeId ? 1 : 0)}/{MAX_CHAT_MESSAGES} messages
                      {item.won ? ' · Flag captured' : item.messages.length >= MAX_CHAT_MESSAGES ? ' · Full' : item.busy ? ' · Reply pending' : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm leading-6 text-muted">{pending === 'loading' ? 'Loading sessions…' : 'Name a session to start playing.'}</p>
          )}
          <p className="mt-4 text-xs leading-5 text-muted">Saved on this device, with a private server backup. No login needed.</p>
          {localSaveFailed && (
            <p role="status" className="mt-2 text-xs leading-5 text-warn">This browser could not save a local copy. Your server copy is still saved.</p>
          )}
        </aside>

        <section className="flex min-w-0 flex-col" aria-label="Flag challenge chat" aria-busy={pending === 'sending'}>
          <div className="flex min-h-17 flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
            <h3 className="min-w-0 break-words font-medium">{session?.name ?? 'New challenge'}</h3>
            {session && (
              <div className="flex items-center gap-2">
                {session.won && <span className="pill pill-success">Flag captured</span>}
                <span className={`pill ${full ? 'pill-neutral' : 'pill-brand'}`}>{displayedMessageCount}/{MAX_CHAT_MESSAGES} messages</span>
              </div>
            )}
          </div>

          {configured === false && (
            <p role="status" className="border-b border-line bg-warn-soft px-5 py-3 text-sm leading-6 text-warn">
              The chat is not configured yet. Ask your facilitator to connect the AI service.
            </p>
          )}

          {error && (
            <p role="alert" className="border-b border-line bg-danger-soft px-5 py-3 text-sm leading-6 text-danger">{error}</p>
          )}

          <div
            ref={chatRef}
            role="log"
            aria-label={session ? `Messages in ${session.name}` : 'Chat messages'}
            aria-live="polite"
            aria-relevant="additions text"
            tabIndex={0}
            className="h-[380px] space-y-5 overflow-y-auto overscroll-contain px-5 py-5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand sm:h-[440px]"
          >
            {session?.messages.map((item) => (
              <div key={item.id} className={`flex ${item.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  data-motion-result={item.id === newReplyId ? '' : undefined}
                  className={`max-w-[92%] rounded px-4 py-3 sm:max-w-[85%] ${item.role === 'user' ? 'bg-brand-soft' : 'border border-line bg-paper'}`}
                >
                  <p className={`mb-1 text-xs font-medium ${item.role === 'user' ? 'text-brand' : 'text-muted'}`}>{item.role === 'user' ? 'You' : 'Computer'}</p>
                  <p className="whitespace-pre-wrap break-words text-sm leading-6 [overflow-wrap:anywhere]">{item.content}</p>
                </div>
              </div>
            ))}

            {showPendingMessage && (
              <div className="flex justify-end">
                <div className="max-w-[92%] rounded bg-brand-soft px-4 py-3 sm:max-w-[85%]">
                  <p className="mb-1 text-xs font-medium text-brand">You</p>
                  <p className="whitespace-pre-wrap break-words text-sm leading-6 [overflow-wrap:anywhere]">{draft.trim()}</p>
                </div>
              </div>
            )}

            {!messageCount && pending !== 'sending' && (
              <div className="flex min-h-60 flex-col items-center justify-center text-center">
                <span aria-hidden className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-6 w-6"><path d="M5 21V4m0 1c5-5 9 5 14 0v9c-5 5-9-5-14 0" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </span>
                <p className="font-medium">{session ? 'The flag is hidden. Your move.' : 'Ready to challenge the computer?'}</p>
                <p className="mt-1 max-w-xs text-sm leading-6 text-muted">{session ? 'Send your first message to start the conversation.' : 'Create a named session to start your first conversation.'}</p>
              </div>
            )}

            {(pending === 'sending' || session?.busy) && (
              <p role="status" className="text-sm text-muted">{pending === 'sending' ? 'Computer is thinking…' : 'A reply is pending. Refresh to check for the response.'}</p>
            )}
          </div>

          {session?.won && (
            <p role="status" className="border-t border-line bg-success-soft px-5 py-3 text-sm leading-6 text-success">
              Flag captured! You persuaded the computer to reveal its secret.
            </p>
          )}

          <div className="border-t border-line p-4 sm:p-5">
            {full && (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2" role="status">
                <p className="text-sm leading-6 text-muted">This session has reached {MAX_CHAT_MESSAGES} messages. Create a new session to keep playing.</p>
                <button type="button" className="btn-ghost" onClick={startNewSession} disabled={pending !== null || !configured}>Create new session</button>
              </div>
            )}
            <form onSubmit={sendMessage}>
              <label htmlFor="chat-message" className="sr-only">Your message to the computer</label>
              <textarea
                ref={composerRef}
                id="chat-message"
                className="input-field min-h-24 resize-y leading-6 disabled:bg-[#eeeeee] disabled:text-faint"
                rows={2}
                value={draft}
                maxLength={MAX_CHAT_INPUT_LENGTH}
                placeholder={full ? 'Session full — create a new session to play again.' : !session ? 'Create a session to start chatting.' : 'Write a message to the computer…'}
                disabled={disabled}
                onChange={(event) => session && setDrafts((current) => ({ ...current, [session.id]: event.target.value }))}
                onKeyDown={handleComposerKey}
                aria-describedby="chat-message-hint"
              />
              <div className="mt-2 flex items-center justify-between gap-3">
                <p id="chat-message-hint" className="text-xs leading-5 text-muted">
                  <span className="hidden sm:inline">Enter to send · Shift+Enter for a new line · </span>{draft.length}/{MAX_CHAT_INPUT_LENGTH}
                </p>
                <button type="submit" className="btn-primary" disabled={!canSend}>{pending === 'sending' ? 'Sending…' : 'Send'}</button>
              </div>
            </form>
          </div>
        </section>
      </div>

      <p className="px-1 text-xs leading-5 text-muted">
        Prompt injection tries to make an AI follow a user’s instructions instead of its original rules. This challenge uses a real AI, so its replies can vary.
      </p>
    </div>
  )
}
