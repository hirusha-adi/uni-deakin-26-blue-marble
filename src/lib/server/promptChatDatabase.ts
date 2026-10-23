import { chmodSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { MAX_CHAT_MESSAGES, type ChatMessage, type ChatSession } from '../promptChat'

interface LegacyRequest {
  id: string
  userText: string
  status: 'pending' | 'completed' | 'failed'
}

interface LegacySession extends Omit<ChatSession, 'busy'> {
  ownerId: string
  requests: LegacyRequest[]
  pending: { requestId: string; userMessageId: string; startedAt: number } | null
}

interface LegacyData {
  version: 1
  sessions: LegacySession[]
}

export interface ChatDatabase {
  database: DatabaseSync
  statement(sql: string): StatementSync
}

// Connections and prepared statements survive Next.js development hot reloads.
const shared = globalThis as typeof globalThis & {
  __blueMarbleChatDatabases?: Map<string, ChatDatabase>
}
const databases = shared.__blueMarbleChatDatabases ??= new Map()

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isMessage(value: unknown): value is ChatMessage {
  return isRecord(value) && typeof value.id === 'string'
    && (value.role === 'user' || value.role === 'assistant')
    && typeof value.content === 'string'
}

function isLegacyRequest(value: unknown): value is LegacyRequest {
  return isRecord(value) && typeof value.id === 'string'
    && typeof value.userText === 'string'
    && (value.status === 'pending' || value.status === 'completed' || value.status === 'failed')
}

function isLegacySession(value: unknown): value is LegacySession {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string'
    || typeof value.ownerId !== 'string' || typeof value.createdAt !== 'string'
    || typeof value.updatedAt !== 'string' || typeof value.won !== 'boolean'
    || !Array.isArray(value.messages) || !value.messages.every(isMessage)
    || value.messages.length > MAX_CHAT_MESSAGES
    || !Array.isArray(value.requests) || !value.requests.every(isLegacyRequest)) return false

  const messages = value.messages as ChatMessage[]
  const requests = value.requests as LegacyRequest[]
  if (messages.some((message, index) => message.role !== (index % 2 === 0 ? 'user' : 'assistant'))
    || new Set(messages.map((message) => message.id)).size !== messages.length
    || new Set(requests.map((request) => request.id)).size !== requests.length
    || requests.filter((request) => request.status === 'completed').length !== Math.floor(messages.length / 2)) return false

  const pendingRequests = requests.filter((request) => request.status === 'pending')
  if (value.pending === null) return messages.length % 2 === 0 && pendingRequests.length === 0

  const pending = value.pending
  const lastMessage = messages.at(-1)
  return isRecord(pending) && typeof pending.requestId === 'string'
    && typeof pending.userMessageId === 'string' && typeof pending.startedAt === 'number'
    && Number.isSafeInteger(pending.startedAt) && messages.length % 2 === 1
    && lastMessage?.id === pending.userMessageId
    && pendingRequests.length === 1 && pendingRequests[0].id === pending.requestId
    && pendingRequests[0].userText === lastMessage.content
}

function readLegacyData(filePath: string): LegacyData | undefined {
  let contents: string
  try {
    contents = readFileSync(filePath, 'utf8')
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return undefined
    throw error
  }

  const data: unknown = JSON.parse(contents)
  if (!isRecord(data) || data.version !== 1 || !Array.isArray(data.sessions)
    || !data.sessions.every(isLegacySession)
    || new Set(data.sessions.map((session) => session.id)).size !== data.sessions.length) {
    throw new Error('Invalid legacy chat data')
  }
  return data as unknown as LegacyData
}

const schema = `
  CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    owner_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    won INTEGER NOT NULL CHECK (won IN (0, 1)),
    message_count INTEGER NOT NULL CHECK (message_count BETWEEN 0 AND ${MAX_CHAT_MESSAGES}),
    pending_request_id TEXT,
    pending_user_message_id TEXT,
    pending_started_at INTEGER,
    CHECK (
      (pending_request_id IS NULL AND pending_user_message_id IS NULL
        AND pending_started_at IS NULL AND message_count % 2 = 0)
      OR (pending_request_id IS NOT NULL AND pending_user_message_id IS NOT NULL
        AND pending_started_at IS NOT NULL AND message_count % 2 = 1)
    )
  ) STRICT;
  CREATE INDEX IF NOT EXISTS chat_sessions_owner_updated
    ON chat_sessions (owner_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS chat_sessions_owner_pending
    ON chat_sessions (owner_id, pending_started_at) WHERE pending_started_at IS NOT NULL;
  CREATE TABLE IF NOT EXISTS chat_messages (
    session_id TEXT NOT NULL REFERENCES chat_sessions (id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND ${MAX_CHAT_MESSAGES - 1}),
    id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    PRIMARY KEY (session_id, ordinal),
    UNIQUE (session_id, id),
    CHECK (role = CASE WHEN ordinal % 2 = 0 THEN 'user' ELSE 'assistant' END)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS chat_requests (
    session_id TEXT NOT NULL REFERENCES chat_sessions (id) ON DELETE CASCADE,
    request_id TEXT NOT NULL,
    user_text TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
    PRIMARY KEY (session_id, request_id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS chat_metadata (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  ) STRICT;
`

function importLegacyData(database: DatabaseSync, data: LegacyData): void {
  const insertSession = database.prepare(`
    INSERT INTO chat_sessions (
      id, owner_id, name, created_at, updated_at, won, message_count,
      pending_request_id, pending_user_message_id, pending_started_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertMessage = database.prepare(`
    INSERT INTO chat_messages (session_id, ordinal, id, role, content) VALUES (?, ?, ?, ?, ?)
  `)
  const insertRequest = database.prepare(`
    INSERT INTO chat_requests (session_id, request_id, user_text, status) VALUES (?, ?, ?, ?)
  `)
  for (const session of data.sessions) {
    insertSession.run(
      session.id, session.ownerId, session.name, session.createdAt, session.updatedAt,
      Number(session.won), session.messages.length, session.pending?.requestId ?? null,
      session.pending?.userMessageId ?? null, session.pending?.startedAt ?? null,
    )
    session.messages.forEach((message, ordinal) => {
      insertMessage.run(session.id, ordinal, message.id, message.role, message.content)
    })
    for (const request of session.requests) {
      insertRequest.run(session.id, request.id, request.userText, request.status)
    }
  }
}

function initialize(database: DatabaseSync, legacyFilePath: string): void {
  database.exec('BEGIN IMMEDIATE')
  try {
    const version = database.prepare('PRAGMA user_version').get()?.user_version
    if (version !== 0 && version !== 1) throw new Error('Unsupported chat database version')

    database.exec(schema)
    const imported = database.prepare('SELECT value FROM chat_metadata WHERE key = ?')
      .get('legacy_json_imported')
    if (!imported) {
      const data = readLegacyData(legacyFilePath)
      if (data) importLegacyData(database, data)
      database.prepare('INSERT INTO chat_metadata (key, value) VALUES (?, ?)')
        .run('legacy_json_imported', '1')
    }
    database.exec('PRAGMA user_version = 1')
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export function getChatDatabase(databasePath: string, legacyFilePath?: string): ChatDatabase {
  const resolvedPath = resolve(databasePath)
  const existing = databases.get(resolvedPath)
  if (existing) return existing

  mkdirSync(dirname(resolvedPath), { recursive: true, mode: 0o700 })
  const database = new DatabaseSync(resolvedPath)
  try {
    // SQLite creates its WAL and shared-memory files using the database's mode.
    chmodSync(resolvedPath, 0o600)
    database.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL')
    initialize(database, resolve(legacyFilePath ?? join(dirname(resolvedPath), 'prompt-chat-sessions.json')))
    const statements = new Map<string, StatementSync>()
    const connection: ChatDatabase = {
      database,
      statement(sql) {
        let statement = statements.get(sql)
        if (!statement) {
          statement = database.prepare(sql)
          statements.set(sql, statement)
        }
        return statement
      },
    }
    databases.set(resolvedPath, connection)
    return connection
  } catch (error) {
    database.close()
    throw error
  }
}

export function closeChatDatabase(databasePath: string): void {
  const resolvedPath = resolve(databasePath)
  const connection = databases.get(resolvedPath)
  if (!connection) return
  databases.delete(resolvedPath)
  connection.database.close()
}

export function closeChatDatabases(): void {
  for (const databasePath of databases.keys()) closeChatDatabase(databasePath)
}
