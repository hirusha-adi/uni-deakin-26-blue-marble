import { randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import {
  MAX_CHAT_INPUT_LENGTH,
  MAX_CHAT_MESSAGES,
  MAX_SESSION_NAME_LENGTH,
  type ChatMessage,
  type ChatSession,
} from '../promptChat'
import {
  closeChatDatabase,
  closeChatDatabases,
  getChatDatabase,
  type ChatDatabase,
} from './promptChatDatabase'

const PENDING_TIMEOUT_MS = 90_000

interface SessionRow {
  id: string
  owner_id: string
  name: string
  created_at: string
  updated_at: string
  won: number
  message_count: number
  pending_request_id: string | null
  pending_user_message_id: string | null
  pending_started_at: number | null
}

interface RequestRow {
  request_id: string
  user_text: string
  status: 'pending' | 'completed' | 'failed'
}

interface MessageRow extends ChatMessage {
  session_id: string
}

export type BeginTurnResult = {
  session: ChatSession
  history: ChatMessage[]
} & ({ completed: true; reservationId?: never } | { completed: false; reservationId: string })

export class StoreError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'StoreError'
  }
}

function storageError(problem: unknown): StoreError {
  return problem instanceof StoreError
    ? problem
    : new StoreError(500, 'Chat sessions could not be loaded. Please try again.')
}

function validateOwner(ownerId: string): void {
  if (typeof ownerId !== 'string' || !ownerId.trim() || ownerId.length > 200) {
    throw new StoreError(400, 'Please refresh the page to start your chat session.')
  }
}

function ownedSession(connection: ChatDatabase, ownerId: string, sessionId: string): SessionRow {
  const row = connection.statement('SELECT * FROM chat_sessions WHERE owner_id = ? AND id = ?')
    .get(ownerId, sessionId) as unknown as SessionRow | undefined
  if (!row) throw new StoreError(404, 'This chat session was not found. Create a new session to play.')
  return row
}

function requestRow(connection: ChatDatabase, sessionId: string, requestId: string): RequestRow | undefined {
  return connection.statement('SELECT request_id, user_text, status FROM chat_requests WHERE session_id = ? AND request_id = ?')
    .get(sessionId, requestId) as unknown as RequestRow | undefined
}

function publicSession(row: SessionRow, messages: ChatMessage[]): ChatSession {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messages: messages.map(({ id, role, content }) => ({ id, role, content })),
    busy: row.pending_request_id !== null,
    won: Boolean(row.won),
  }
}

function loadSession(connection: ChatDatabase, row: SessionRow): ChatSession {
  const messages = connection.statement('SELECT id, role, content FROM chat_messages WHERE session_id = ? ORDER BY ordinal')
    .all(row.id) as unknown as ChatMessage[]
  return publicSession(row, messages)
}

function listOwnerSessions(connection: ChatDatabase, ownerId: string): ChatSession[] {
  const sessions = connection.statement('SELECT * FROM chat_sessions WHERE owner_id = ? ORDER BY updated_at DESC, id')
    .all(ownerId) as unknown as SessionRow[]
  // Fetch this owner's history in one indexed join rather than one query per chat.
  const messages = connection.statement(`
    SELECT m.session_id, m.id, m.role, m.content
    FROM chat_sessions s JOIN chat_messages m ON m.session_id = s.id
    WHERE s.owner_id = ? ORDER BY m.session_id, m.ordinal
  `).all(ownerId) as unknown as MessageRow[]
  const bySession = new Map<string, ChatMessage[]>()
  for (const { session_id, id, role, content } of messages) {
    const history = bySession.get(session_id) ?? []
    history.push({ id, role, content })
    bySession.set(session_id, history)
  }
  return sessions.map((row) => publicSession(row, bySession.get(row.id) ?? []))
}

function clearPending(connection: ChatDatabase, row: SessionRow): void {
  if (row.pending_request_id === null) return
  connection.statement("UPDATE chat_requests SET status = 'failed' WHERE session_id = ? AND request_id = ?")
    .run(row.id, row.pending_request_id)
  connection.statement('DELETE FROM chat_messages WHERE session_id = ? AND id = ?')
    .run(row.id, row.pending_user_message_id)
  connection.statement(`
    UPDATE chat_sessions SET message_count = message_count - 1,
      pending_request_id = NULL, pending_user_message_id = NULL, pending_started_at = NULL, updated_at = ?
    WHERE id = ? AND owner_id = ?
  `).run(new Date().toISOString(), row.id, row.owner_id)
}

function expirePending(connection: ChatDatabase, ownerId: string): void {
  const expired = connection.statement(`
    SELECT * FROM chat_sessions WHERE owner_id = ? AND pending_started_at <= ?
  `).all(ownerId, Date.now() - PENDING_TIMEOUT_MS) as unknown as SessionRow[]
  for (const row of expired) clearPending(connection, row)
}

export class ChatStore {
  private readonly databasePath: string
  private readonly legacyFilePath: string

  constructor(databasePath: string, legacyFilePath?: string) {
    this.databasePath = resolve(databasePath)
    this.legacyFilePath = legacyFilePath === undefined
      ? join(dirname(this.databasePath), 'prompt-chat-sessions.json')
      : resolve(legacyFilePath)
  }

  private access<T>(ownerId: string, write: boolean, action: (connection: ChatDatabase) => T): T {
    let connection: ChatDatabase | undefined
    let inTransaction = false
    try {
      connection = getChatDatabase(this.databasePath, this.legacyFilePath)
      const { database } = connection
      // WAL readers get a snapshot without a write lock when no lease needs recovery.
      const hasExpired = !write && connection.statement(`
        SELECT 1 FROM chat_sessions WHERE owner_id = ? AND pending_started_at <= ? LIMIT 1
      `).get(ownerId, Date.now() - PENDING_TIMEOUT_MS) !== undefined
      const needsWrite = write || hasExpired
      database.exec(needsWrite ? 'BEGIN IMMEDIATE' : 'BEGIN')
      inTransaction = true
      if (needsWrite) {
        expirePending(connection, ownerId)
        database.exec('SAVEPOINT chat_action')
      }
      let value: T
      try {
        value = action(connection)
      } catch (problem) {
        if (needsWrite && problem instanceof StoreError) {
          // Commit expired leases, but never an unsuccessful action's partial writes.
          database.exec('ROLLBACK TO chat_action; RELEASE chat_action; COMMIT')
          inTransaction = false
        }
        throw problem
      }
      if (needsWrite) database.exec('RELEASE chat_action')
      database.exec('COMMIT')
      inTransaction = false
      return value
    } catch (problem) {
      if (inTransaction) {
        try { connection?.database.exec('ROLLBACK') } catch { /* Preserve the original error. */ }
      }
      throw storageError(problem)
    }
  }

  async listSessions(ownerId: string): Promise<ChatSession[]> {
    validateOwner(ownerId)
    return this.access(ownerId, false, (connection) => listOwnerSessions(connection, ownerId))
  }

  async createSession(ownerId: string, name: string): Promise<ChatSession> {
    validateOwner(ownerId)
    if (typeof name !== 'string' || !name.trim() || name.trim().length > MAX_SESSION_NAME_LENGTH) {
      throw new StoreError(400, `Give your session a name of 1–${MAX_SESSION_NAME_LENGTH} characters.`)
    }
    return this.access(ownerId, true, (connection) => {
      const id = randomUUID()
      const now = new Date().toISOString()
      connection.statement(`
        INSERT INTO chat_sessions (id, owner_id, name, created_at, updated_at, won, message_count)
        VALUES (?, ?, ?, ?, ?, 0, 0)
      `).run(id, ownerId, name.trim(), now, now)
      return { id, name: name.trim(), createdAt: now, updatedAt: now, messages: [], busy: false, won: false }
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
    return this.access<BeginTurnResult>(ownerId, true, (connection) => {
      const row = ownedSession(connection, ownerId, sessionId)
      const existing = requestRow(connection, sessionId, requestId)
      if (existing && existing.user_text !== userText) {
        throw new StoreError(409, 'This message was already used for different text. Please send a new message.')
      }
      if (existing?.status === 'completed') {
        const session = loadSession(connection, row)
        return { session, history: session.messages, completed: true }
      }
      if (row.pending_request_id !== null) {
        throw new StoreError(409, 'A reply is already on its way. Please wait before sending another message.')
      }
      if (row.message_count + 2 > MAX_CHAT_MESSAGES) {
        throw new StoreError(409, 'This chat has reached 30 messages. Create a new session to keep playing.')
      }
      const reservationId = randomUUID()
      connection.statement('INSERT INTO chat_messages (session_id, ordinal, id, role, content) VALUES (?, ?, ?, ?, ?)')
        .run(sessionId, row.message_count, reservationId, 'user', userText)
      connection.statement(`
        INSERT INTO chat_requests (session_id, request_id, user_text, status) VALUES (?, ?, ?, 'pending')
        ON CONFLICT(session_id, request_id) DO UPDATE SET status = 'pending'
      `).run(sessionId, requestId, userText)
      connection.statement(`
        UPDATE chat_sessions SET message_count = message_count + 1,
          pending_request_id = ?, pending_user_message_id = ?, pending_started_at = ?, updated_at = ?
        WHERE id = ? AND owner_id = ?
      `).run(requestId, reservationId, Date.now(), new Date().toISOString(), sessionId, ownerId)
      const session = loadSession(connection, ownedSession(connection, ownerId, sessionId))
      return { session, history: session.messages, completed: false, reservationId }
    })
  }

  async completeTurn(ownerId: string, sessionId: string, requestId: string, assistantContent: string, won: boolean, reservationId?: string): Promise<ChatSession> {
    validateOwner(ownerId)
    if (typeof assistantContent !== 'string' || !assistantContent.trim()) {
      throw new StoreError(502, 'The assistant returned an empty reply. Please try again.')
    }
    return this.access(ownerId, true, (connection) => {
      const row = ownedSession(connection, ownerId, sessionId)
      const request = requestRow(connection, sessionId, requestId)
      if (request?.status === 'completed') return loadSession(connection, row)
      if (row.pending_request_id !== requestId || request?.status !== 'pending'
        || (reservationId !== undefined && row.pending_user_message_id !== reservationId)) {
        throw new StoreError(409, 'This reply has expired. Please send your message again.')
      }
      connection.statement('INSERT INTO chat_messages (session_id, ordinal, id, role, content) VALUES (?, ?, ?, ?, ?)')
        .run(sessionId, row.message_count, randomUUID(), 'assistant', assistantContent)
      connection.statement("UPDATE chat_requests SET status = 'completed' WHERE session_id = ? AND request_id = ?")
        .run(sessionId, requestId)
      connection.statement(`
        UPDATE chat_sessions SET message_count = message_count + 1, won = MAX(won, ?),
          pending_request_id = NULL, pending_user_message_id = NULL, pending_started_at = NULL, updated_at = ?
        WHERE id = ? AND owner_id = ?
      `).run(Number(Boolean(won)), new Date().toISOString(), sessionId, ownerId)
      return loadSession(connection, ownedSession(connection, ownerId, sessionId))
    })
  }

  async failTurn(ownerId: string, sessionId: string, requestId: string, reservationId?: string): Promise<ChatSession> {
    validateOwner(ownerId)
    return this.access(ownerId, true, (connection) => {
      const row = ownedSession(connection, ownerId, sessionId)
      // A delayed response must never change a newer reservation, even on the same request ID.
      if (row.pending_request_id === requestId
        && (reservationId === undefined || row.pending_user_message_id === reservationId)) {
        clearPending(connection, row)
      }
      return loadSession(connection, ownedSession(connection, ownerId, sessionId))
    })
  }

  close(): void {
    closeChatDatabase(this.databasePath)
  }
}

export function createChatStore(databasePath: string, legacyFilePath?: string): ChatStore {
  return new ChatStore(databasePath, legacyFilePath)
}

export function closeChatStores(): void {
  closeChatDatabases()
}

export function getChatStore(): ChatStore {
  const databasePath = join(process.env.PROMPT_CHAT_DATA_DIR || join(process.cwd(), '.data'), 'prompt-chat-sessions.sqlite')
  // Connections and prepared statements are reused across requests and Next hot reloads.
  return createChatStore(databasePath)
}
