import {
  MAX_CHAT_INPUT_LENGTH,
  MAX_CHAT_MESSAGES,
  MAX_SESSION_NAME_LENGTH,
  type ChatMessage,
  type ChatSession,
} from './promptChat'

export const BROWSER_CHATS_STORAGE_KEY = 'blue-marble.prompt-chat.v1'

/** Small adapter so persistence can also be used without a browser. */
export interface ChatBrowserStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface BrowserChatSnapshot {
  sessions: ChatSession[]
  activeId: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const BROWSER_ID = /^[0-9a-f]{64}$/i
const MAX_ASSISTANT_LENGTH = 16_384
const MAX_CACHED_SESSIONS = 1000
const MAX_CACHE_LENGTH = 8 * 1024 * 1024

function emptySnapshot(): BrowserChatSnapshot {
  return { sessions: [], activeId: null }
}

function browserStorage(): ChatBrowserStorage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

function readMessage(value: unknown, index: number): ChatMessage | null {
  const role = index % 2 === 0 ? 'user' : 'assistant'
  if (!isRecord(value) || typeof value.id !== 'string' || !UUID.test(value.id)
    || value.role !== role
    || typeof value.content !== 'string' || !value.content.trim()
    || value.content.length > (value.role === 'user' ? MAX_CHAT_INPUT_LENGTH : MAX_ASSISTANT_LENGTH)) return null

  return { id: value.id, role, content: value.content }
}

/** Only copy the public contract; server ownership and request data never enter storage. */
function readSession(value: unknown): ChatSession | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !UUID.test(value.id)
    || typeof value.name !== 'string' || !value.name.trim() || value.name.length > MAX_SESSION_NAME_LENGTH
    || !isIsoDate(value.createdAt) || !isIsoDate(value.updatedAt)
    || typeof value.busy !== 'boolean' || typeof value.won !== 'boolean'
    || !Array.isArray(value.messages) || value.messages.length > MAX_CHAT_MESSAGES) return null

  const messages: ChatMessage[] = []
  const messageIds = new Set<string>()
  for (const [index, item] of value.messages.entries()) {
    const message = readMessage(item, index)
    if (!message || messageIds.has(message.id)) return null
    messages.push(message)
    messageIds.add(message.id)
  }

  return {
    id: value.id,
    name: value.name,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    messages,
    busy: value.busy,
    won: value.won,
  }
}

function readSnapshot(sessions: unknown, activeId: unknown): BrowserChatSnapshot | null {
  if (!Array.isArray(sessions) || sessions.length > MAX_CACHED_SESSIONS
    || (activeId !== null && (typeof activeId !== 'string' || !UUID.test(activeId)))) return null

  const validated: ChatSession[] = []
  const sessionIds = new Set<string>()
  for (const item of sessions) {
    const session = readSession(item)
    if (!session || sessionIds.has(session.id)) return null
    validated.push(session)
    sessionIds.add(session.id)
  }

  return {
    sessions: validated,
    activeId: typeof activeId === 'string' && sessionIds.has(activeId) ? activeId : null,
  }
}

/** Call only after the server confirms this browser's noncredential cache ID. */
export function readBrowserChats(browserId: string, storage = browserStorage()): BrowserChatSnapshot {
  if (!storage || !BROWSER_ID.test(browserId)) return emptySnapshot()
  try {
    const raw = storage.getItem(BROWSER_CHATS_STORAGE_KEY)
    if (raw === null) return emptySnapshot()
    if (raw.length > MAX_CACHE_LENGTH) throw new Error('Chat cache is too large.')
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value) || value.version !== 1 || value.browserId !== browserId) {
      throw new Error('Chat cache does not belong to this browser.')
    }
    const snapshot = readSnapshot(value.sessions, value.activeId)
    if (!snapshot) throw new Error('Chat cache is invalid.')
    return snapshot
  } catch {
    // Clearing a cookie must not expose history left under an older browser ID.
    clearBrowserChats(storage)
    return emptySnapshot()
  }
}

/** The server remains authoritative for ownership, history, and message limits. */
export function writeBrowserChats(
  browserId: string,
  sessions: readonly ChatSession[],
  activeId: string | null,
  storage = browserStorage(),
): boolean {
  if (!storage || !BROWSER_ID.test(browserId)) return false
  try {
    const snapshot = readSnapshot(sessions, activeId)
    if (!snapshot) return false
    const serialized = JSON.stringify({ version: 1, browserId, ...snapshot })
    if (serialized.length > MAX_CACHE_LENGTH) return false
    storage.setItem(BROWSER_CHATS_STORAGE_KEY, serialized)
    return true
  } catch {
    return false
  }
}

export function clearBrowserChats(storage = browserStorage()): boolean {
  if (!storage) return false
  try {
    storage.removeItem(BROWSER_CHATS_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}
