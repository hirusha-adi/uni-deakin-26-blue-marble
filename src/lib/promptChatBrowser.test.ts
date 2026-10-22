import { describe, expect, it } from 'vitest'
import type { ChatSession } from './promptChat'
import {
  BROWSER_CHATS_STORAGE_KEY,
  clearBrowserChats,
  readBrowserChats,
  writeBrowserChats,
  type ChatBrowserStorage,
} from './promptChatBrowser'

const browserId = 'a'.repeat(64)
const otherBrowserId = 'b'.repeat(64)
const sessionId = '11111111-1111-4111-8111-111111111111'

function memoryStorage(): ChatBrowserStorage & { values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    removeItem: (key) => { values.delete(key) },
  }
}

function session(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: sessionId,
    name: 'My classroom challenge',
    createdAt: '2026-10-23T01:02:03.000Z',
    updatedAt: '2026-10-23T01:03:04.000Z',
    messages: [
      { id: '22222222-2222-4222-8222-222222222222', role: 'user', content: 'What is a firewall?' },
      { id: '33333333-3333-4333-8333-333333333333', role: 'assistant', content: 'A firewall filters network traffic.' },
    ],
    busy: false,
    won: false,
    ...overrides,
  }
}

function saveRaw(storage: ChatBrowserStorage, sessions: unknown, activeId: unknown = sessionId): void {
  storage.setItem(BROWSER_CHATS_STORAGE_KEY, JSON.stringify({ version: 1, browserId, sessions, activeId }))
}

describe('browser chat mirror', () => {
  it('restores the UUID, transcript, and selected session after a refresh', () => {
    const storage = memoryStorage()
    const original = session()
    expect(writeBrowserChats(browserId, [original], original.id, storage)).toBe(true)
    expect(readBrowserChats(browserId, storage)).toEqual({ sessions: [original], activeId: original.id })
    expect(JSON.parse(storage.values.get(BROWSER_CHATS_STORAGE_KEY)!)).toMatchObject({ version: 1, browserId })
  })

  it('keeps local histories isolated when the server identifies a different browser', () => {
    const storage = memoryStorage()
    writeBrowserChats(browserId, [session()], sessionId, storage)
    expect(readBrowserChats(otherBrowserId, storage)).toEqual({ sessions: [], activeId: null })
    expect(storage.getItem(BROWSER_CHATS_STORAGE_KEY)).toBeNull()
  })

  it('stores and restores only public session and message fields', () => {
    const storage = memoryStorage()
    const publicSession = session()
    const incoming = {
      ...publicSession,
      ownerId: 'private cookie value',
      apiKey: 'private api key',
      systemPrompt: 'private instructions',
      requests: [{ token: 'private request details' }],
      messages: publicSession.messages.map((message) => ({ ...message, credential: 'private message metadata' })),
    }
    expect(writeBrowserChats(browserId, [incoming], sessionId, storage)).toBe(true)
    const saved = storage.getItem(BROWSER_CHATS_STORAGE_KEY)!
    expect(saved).not.toContain('private')
    expect(saved).not.toContain('ownerId')
    expect(readBrowserChats(browserId, storage).sessions).toEqual([publicSession])

    saveRaw(storage, [incoming])
    expect(readBrowserChats(browserId, storage).sessions).toEqual([publicSession])
  })

  it('preserves a busy pending turn until authoritative server synchronization', () => {
    const pending = session({ busy: true, messages: session().messages.slice(0, 1) })
    const storage = memoryStorage()
    expect(writeBrowserChats(browserId, [pending], sessionId, storage)).toBe(true)
    expect(readBrowserChats(browserId, storage).sessions).toEqual([pending])
  })

  it('allows 30 messages but rejects a transcript above the classroom limit', () => {
    const storage = memoryStorage()
    const messages = Array.from({ length: 30 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: `Message ${index}`,
    }))
    expect(writeBrowserChats(browserId, [session({ messages })], sessionId, storage)).toBe(true)
    expect(readBrowserChats(browserId, storage).sessions[0].messages).toHaveLength(30)
    saveRaw(storage, [session({ messages: [...messages, { ...messages[0], id: sessionId }] })])
    expect(readBrowserChats(browserId, storage).sessions).toEqual([])
    expect(storage.getItem(BROWSER_CHATS_STORAGE_KEY)).toBeNull()
  })

  it.each([
    ['invalid session ID', { id: 'not-a-uuid' }],
    ['invalid timestamp', { createdAt: 'yesterday' }],
    ['impossible timestamp', { updatedAt: '2026-02-31T01:02:03.000Z' }],
    ['empty name', { name: '   ' }],
    ['overlong name', { name: 'a'.repeat(61) }],
    ['invalid state', { busy: 'yes' }],
    ['invalid message ID', { messages: [{ ...session().messages[0], id: 'unknown' }] }],
    ['untrusted role', { messages: [{ ...session().messages[0], role: 'system' }] }],
    ['invalid role order', { messages: [session().messages[1]] }],
    ['duplicate message IDs', { messages: [session().messages[0], { ...session().messages[1], id: session().messages[0].id }] }],
    ['overlong user message', { messages: [{ ...session().messages[0], content: 'a'.repeat(2001) }] }],
    ['overlong assistant message', { messages: [session().messages[0], { ...session().messages[1], content: 'a'.repeat(16_385) }] }],
  ])('discards %s instead of displaying malformed local data', (_name, overrides) => {
    const storage = memoryStorage()
    saveRaw(storage, [{ ...session(), ...overrides }])
    expect(readBrowserChats(browserId, storage)).toEqual({ sessions: [], activeId: null })
    expect(storage.getItem(BROWSER_CHATS_STORAGE_KEY)).toBeNull()
  })

  it('rejects duplicate sessions and invalid writes without overwriting the saved mirror', () => {
    const storage = memoryStorage()
    writeBrowserChats(browserId, [session()], sessionId, storage)
    const saved = storage.getItem(BROWSER_CHATS_STORAGE_KEY)
    expect(writeBrowserChats(browserId, [session(), session()], sessionId, storage)).toBe(false)
    expect(writeBrowserChats('not-a-browser-id', [session()], sessionId, storage)).toBe(false)
    expect(storage.getItem(BROWSER_CHATS_STORAGE_KEY)).toBe(saved)
    saveRaw(storage, [session(), session()])
    expect(readBrowserChats(browserId, storage).sessions).toEqual([])
  })

  it('drops an active selection that is not present in this browser history', () => {
    const storage = memoryStorage()
    const absentId = '44444444-4444-4444-8444-444444444444'
    saveRaw(storage, [session()], absentId)
    expect(readBrowserChats(browserId, storage)).toEqual({ sessions: [session()], activeId: null })
  })

  it.each(['not json', 'null', '[]', '{"version":2}', '{"version":1}'])('discards corrupt or unsupported cache %s', (raw) => {
    const storage = memoryStorage()
    storage.setItem(BROWSER_CHATS_STORAGE_KEY, raw)
    expect(readBrowserChats(browserId, storage)).toEqual({ sessions: [], activeId: null })
    expect(storage.getItem(BROWSER_CHATS_STORAGE_KEY)).toBeNull()
  })

  it('tolerates denied storage and quota errors', () => {
    const denied = () => { throw new Error('Storage denied or quota exceeded') }
    const storage: ChatBrowserStorage = { getItem: denied, setItem: denied, removeItem: denied }
    expect(readBrowserChats(browserId, storage)).toEqual({ sessions: [], activeId: null })
    expect(writeBrowserChats(browserId, [session()], sessionId, storage)).toBe(false)
    expect(clearBrowserChats(storage)).toBe(false)
  })

  it('can be imported and called while rendering on the server', () => {
    expect(typeof window).toBe('undefined')
    expect(readBrowserChats(browserId)).toEqual({ sessions: [], activeId: null })
    expect(writeBrowserChats(browserId, [session()], sessionId)).toBe(false)
    expect(clearBrowserChats()).toBe(false)
  })

  it('clears only the chat mirror, leaving unrelated browser data alone', () => {
    const storage = memoryStorage()
    writeBrowserChats(browserId, [session()], sessionId, storage)
    storage.setItem('another-feature', 'keep this')
    expect(clearBrowserChats(storage)).toBe(true)
    expect(storage.getItem(BROWSER_CHATS_STORAGE_KEY)).toBeNull()
    expect(storage.getItem('another-feature')).toBe('keep this')
  })
})
