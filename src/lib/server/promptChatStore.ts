import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
  MAX_CHAT_INPUT_LENGTH,
  MAX_CHAT_MESSAGES,
  MAX_SESSION_NAME_LENGTH,
  type ChatMessage,
  type ChatSession,
} from '../promptChat'

const PENDING_TIMEOUT_MS = 90_000

type RequestStatus = 'pending' | 'completed' | 'failed'

interface StoredRequest {
  id: string
  userText: string
  status: RequestStatus
}

interface StoredSession extends Omit<ChatSession, 'busy'> {
  ownerId: string
  requests: StoredRequest[]
  pending: { requestId: string; userMessageId: string; startedAt: number } | null
}

interface StoredData {
  version: 1
  sessions: StoredSession[]
}

export interface BeginTurnResult {
  session: ChatSession
  history: ChatMessage[]
  completed: boolean
}

export class StoreError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'StoreError'
  }
}

// The queue is shared across store instances and Next.js hot reloads. This file
// store is intended for one Node.js process with persistent local storage; a
// multi-instance deployment needs a database with transactional row locking.
const shared = globalThis as typeof globalThis & {
  __blueMarbleChatFileLocks?: Map<string, Promise<void>>
}
const fileLocks = shared.__blueMarbleChatFileLocks ??= new Map()

async function withFileLock<T>(filePath: string, action: () => Promise<T>): Promise<T> {
  const previous = fileLocks.get(filePath) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((done) => { release = done })
  fileLocks.set(filePath, current)
  await previous
  try {
    return await action()
  } finally {
    release()
    if (fileLocks.get(filePath) === current) fileLocks.delete(filePath)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isMessage(value: unknown): value is ChatMessage {
  return isRecord(value) && typeof value.id === 'string'
    && (value.role === 'user' || value.role === 'assistant')
    && typeof value.content === 'string'
}

function isStoredRequest(value: unknown): value is StoredRequest {
  return isRecord(value) && typeof value.id === 'string'
    && typeof value.userText === 'string'
    && (value.status === 'pending' || value.status === 'completed' || value.status === 'failed')
}

function isStoredSession(value: unknown): value is StoredSession {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string'
    || typeof value.ownerId !== 'string' || typeof value.createdAt !== 'string'
    || typeof value.updatedAt !== 'string' || typeof value.won !== 'boolean'
    || !Array.isArray(value.messages) || !value.messages.every(isMessage)
    || value.messages.length > MAX_CHAT_MESSAGES
    || !Array.isArray(value.requests) || !value.requests.every(isStoredRequest)) return false

  const messages = value.messages as ChatMessage[]
  const requests = value.requests as StoredRequest[]
  if (messages.some((message, index) => message.role !== (index % 2 === 0 ? 'user' : 'assistant'))
    || new Set(requests.map((request) => request.id)).size !== requests.length
    || requests.filter((request) => request.status === 'completed').length !== Math.floor(messages.length / 2)) return false

  const pendingRequests = requests.filter((request) => request.status === 'pending')
  if (value.pending === null) return messages.length % 2 === 0 && pendingRequests.length === 0

  const pending = value.pending
  const lastMessage = messages.at(-1)
  return isRecord(pending) && typeof pending.requestId === 'string'
    && typeof pending.userMessageId === 'string' && typeof pending.startedAt === 'number'
    && Number.isFinite(pending.startedAt) && messages.length % 2 === 1
    && lastMessage?.id === pending.userMessageId
    && pendingRequests.length === 1 && pendingRequests[0].id === pending.requestId
    && pendingRequests[0].userText === lastMessage.content
}

async function loadData(filePath: string): Promise<StoredData> {
  let contents: string
  try {
    contents = await readFile(filePath, 'utf8')
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return { version: 1, sessions: [] }
    throw new StoreError(500, 'Chat sessions could not be loaded. Please try again.')
  }
  try {
    const data: unknown = JSON.parse(contents)
    if (!isRecord(data) || data.version !== 1 || !Array.isArray(data.sessions)
      || !data.sessions.every(isStoredSession)) throw new Error('Invalid session file')
    return data as unknown as StoredData
  } catch {
    // Never replace an unreadable file with an empty history or reset its limit.
    throw new StoreError(500, 'Chat sessions could not be loaded. Please try again.')
  }
}

async function saveData(filePath: string, data: StoredData): Promise<void> {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`
  try {
    await mkdir(dirname(filePath), { recursive: true, mode: 0o700 })
    await writeFile(temporaryPath, JSON.stringify(data), { encoding: 'utf8', mode: 0o600 })
    await rename(temporaryPath, filePath)
  } catch {
    throw new StoreError(500, 'Chat sessions could not be saved. Please try again.')
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

function publicSession(session: StoredSession): ChatSession {
  return {
    id: session.id,
    name: session.name,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messages: session.messages.map(({ id, role, content }) => ({ id, role, content })),
    busy: session.pending !== null,
    won: session.won,
  }
}

function findSession(data: StoredData, ownerId: string, sessionId: string): StoredSession {
  const session = data.sessions.find((candidate) => candidate.id === sessionId && candidate.ownerId === ownerId)
  if (!session) throw new StoreError(404, 'This chat session was not found. Create a new session to play.')
  return session
}

function clearPending(session: StoredSession): void {
  if (!session.pending) return
  const request = session.requests.find((candidate) => candidate.id === session.pending?.requestId)
  if (request) request.status = 'failed'
  session.messages = session.messages.filter((message) => message.id !== session.pending?.userMessageId)
  session.pending = null
  session.updatedAt = new Date().toISOString()
}

function expirePending(data: StoredData): boolean {
  let changed = false
  for (const session of data.sessions) {
    if (session.pending && Date.now() - session.pending.startedAt >= PENDING_TIMEOUT_MS) {
      clearPending(session)
      changed = true
    }
  }
  return changed
}

function validateOwner(ownerId: string): void {
  if (typeof ownerId !== 'string' || !ownerId.trim() || ownerId.length > 200) {
    throw new StoreError(400, 'Please refresh the page to start your chat session.')
  }
}

export class ChatStore {
  private readonly filePath: string

  constructor(filePath: string) {
    this.filePath = resolve(filePath)
  }

  private async access<T>(action: (data: StoredData) => { value: T; changed: boolean }): Promise<T> {
    return withFileLock(this.filePath, async () => {
      const data = await loadData(this.filePath)
      const expired = expirePending(data)
      const result = action(data)
      if (expired || result.changed) await saveData(this.filePath, data)
      return result.value
    })
  }

  async listSessions(ownerId: string): Promise<ChatSession[]> {
    validateOwner(ownerId)
    return this.access((data) => ({
      value: data.sessions.filter((session) => session.ownerId === ownerId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map(publicSession),
      changed: false,
    }))
  }

  async createSession(ownerId: string, name: string): Promise<ChatSession> {
    validateOwner(ownerId)
    if (typeof name !== 'string' || !name.trim() || name.trim().length > MAX_SESSION_NAME_LENGTH) {
      throw new StoreError(400, `Give your session a name of 1–${MAX_SESSION_NAME_LENGTH} characters.`)
    }
    return this.access((data) => {
      const now = new Date().toISOString()
      const session: StoredSession = {
        id: randomUUID(), name: name.trim(), ownerId, createdAt: now, updatedAt: now,
        messages: [], requests: [], pending: null, won: false,
      }
      data.sessions.push(session)
      return { value: publicSession(session), changed: true }
    })
  }

  async beginTurn(ownerId: string, sessionId: string, userText: string, requestId: string): Promise<BeginTurnResult> {
    validateOwner(ownerId)
    if (typeof userText !== 'string' || !userText.trim() || userText.length > MAX_CHAT_INPUT_LENGTH) {
      throw new StoreError(400, `Write a message of 1–${MAX_CHAT_INPUT_LENGTH} characters.`)
    }
    if (typeof requestId !== 'string' || !requestId.trim() || requestId.length > 128) {
      throw new StoreError(400, 'This message could not be identified. Please try sending it again.')
    }
    return this.access<BeginTurnResult>((data) => {
      const session = findSession(data, ownerId, sessionId)
      const existingRequest = session.requests.find((request) => request.id === requestId)
      if (existingRequest && existingRequest.userText !== userText) {
        throw new StoreError(409, 'This message was already used for different text. Please send a new message.')
      }
      if (existingRequest?.status === 'completed') {
        const publicValue = publicSession(session)
        return { value: { session: publicValue, history: publicValue.messages, completed: true }, changed: false }
      }
      if (session.pending) throw new StoreError(409, 'A reply is already on its way. Please wait before sending another message.')
      if (session.messages.length + 2 > MAX_CHAT_MESSAGES) {
        throw new StoreError(409, 'This chat has reached 30 messages. Create a new session to keep playing.')
      }

      const message: ChatMessage = { id: randomUUID(), role: 'user', content: userText }
      session.messages.push(message)
      session.requests = session.requests.filter((request) => request.id !== requestId)
      session.requests.push({ id: requestId, userText, status: 'pending' })
      session.pending = { requestId, userMessageId: message.id, startedAt: Date.now() }
      session.updatedAt = new Date().toISOString()
      const publicValue = publicSession(session)
      return { value: { session: publicValue, history: publicValue.messages, completed: false }, changed: true }
    })
  }

  async completeTurn(ownerId: string, sessionId: string, requestId: string, assistantContent: string, won: boolean): Promise<ChatSession> {
    validateOwner(ownerId)
    if (typeof assistantContent !== 'string' || !assistantContent.trim()) {
      throw new StoreError(502, 'The assistant returned an empty reply. Please try again.')
    }
    return this.access((data) => {
      const session = findSession(data, ownerId, sessionId)
      const request = session.requests.find((candidate) => candidate.id === requestId)
      if (request?.status === 'completed') return { value: publicSession(session), changed: false }
      if (!session.pending || session.pending.requestId !== requestId || !request) {
        throw new StoreError(409, 'This reply has expired. Please send your message again.')
      }
      session.messages.push({ id: randomUUID(), role: 'assistant', content: assistantContent })
      request.status = 'completed'
      session.pending = null
      session.won = session.won || won
      session.updatedAt = new Date().toISOString()
      return { value: publicSession(session), changed: true }
    })
  }

  async failTurn(ownerId: string, sessionId: string, requestId: string): Promise<ChatSession> {
    validateOwner(ownerId)
    return this.access((data) => {
      const session = findSession(data, ownerId, sessionId)
      // A delayed failure must never remove another request's reserved turn.
      if (session.pending?.requestId !== requestId) return { value: publicSession(session), changed: false }
      clearPending(session)
      return { value: publicSession(session), changed: true }
    })
  }
}

export function createChatStore(filePath: string): ChatStore {
  return new ChatStore(filePath)
}

export function getChatStore(): ChatStore {
  const filePath = resolve(join(process.env.PROMPT_CHAT_DATA_DIR || join(process.cwd(), '.data'), 'prompt-chat-sessions.json'))
  // Create fresh instances so hot reloads use the current error classes.
  // Only the file-operation mutex needs to survive across module versions.
  return createChatStore(filePath)
}
