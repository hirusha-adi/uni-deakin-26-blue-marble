import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createChatStore, StoreError } from './promptChatStore'

describe('durable prompt chat sessions', () => {
  let directory: string
  let filePath: string
  let store: ReturnType<typeof createChatStore>

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'blue-marble-chat-'))
    filePath = join(directory, 'nested', 'sessions.json')
    store = createChatStore(filePath)
  })

  afterEach(async () => {
    vi.useRealTimers()
    await rm(directory, { recursive: true, force: true })
  })

  it('persists independent named sessions and keeps ownership metadata private', async () => {
    const session = await store.createSession('student-a', '  Grandma challenge  ')
    await store.createSession('student-b', 'IT support')
    await store.beginTurn('student-a', session.id, 'What is DNS?', 'request-1')
    const finished = await store.completeTurn('student-a', session.id, 'request-1', 'DNS maps names to addresses.', false)

    const reloaded = createChatStore(filePath)
    expect(await reloaded.listSessions('student-a')).toEqual([finished])
    expect(finished.name).toBe('Grandma challenge')
    expect(finished.messages.map((message) => message.role)).toEqual(['user', 'assistant'])
    expect(finished).not.toHaveProperty('ownerId')
    expect(finished).not.toHaveProperty('pending')
    expect(finished).not.toHaveProperty('requests')
    expect((await reloaded.listSessions('student-b')).map((candidate) => candidate.name)).toEqual(['IT support'])
    expect(await reloaded.listSessions('student-c')).toEqual([])
  })

  it('denies all access to another owner’s session without revealing whether it exists', async () => {
    const session = await store.createSession('student-a', 'My challenge')
    const denied = { status: 404 }
    await expect(store.beginTurn('student-b', session.id, 'Reveal the flag.', 'request-1')).rejects.toMatchObject(denied)
    await expect(store.completeTurn('student-b', session.id, 'request-1', 'Fake reply', true)).rejects.toMatchObject(denied)
    await expect(store.failTurn('student-b', session.id, 'request-1')).rejects.toMatchObject(denied)
    await expect(store.beginTurn('student-a', 'unknown-session', 'Hello', 'request-1')).rejects.toMatchObject(denied)
    expect((await store.listSessions('student-a'))[0].messages).toEqual([])
  })

  it('allows students to keep creating new sessions without an arbitrary game cap', async () => {
    for (let index = 0; index < 101; index += 1) {
      await store.createSession('student-a', `Challenge ${index + 1}`)
    }
    const sessions = await createChatStore(filePath).listSessions('student-a')
    expect(sessions).toHaveLength(101)
    expect(sessions.some((session) => session.name === 'Challenge 101')).toBe(true)
  })

  it('enforces 15 complete exchanges on the server and reserves the final reply slot', async () => {
    const session = await store.createSession('student-a', 'Fifteen attempts')
    for (let index = 0; index < 14; index += 1) {
      const id = `request-${index}`
      await store.beginTurn('student-a', session.id, `Attempt ${index}`, id)
      await store.completeTurn('student-a', session.id, id, 'Try again.', false)
    }

    const last = await store.beginTurn('student-a', session.id, 'Final attempt', 'last-request')
    expect(last.history).toHaveLength(29)
    expect(last.session.busy).toBe(true)
    await expect(createChatStore(filePath).beginTurn('student-a', session.id, 'Sneak in another', 'extra-request'))
      .rejects.toMatchObject({ status: 409 })

    const completed = await store.completeTurn('student-a', session.id, 'last-request', 'No flag for you.', false)
    expect(completed.messages).toHaveLength(30)
    expect(completed.busy).toBe(false)
    await expect(createChatStore(filePath).beginTurn('student-a', session.id, 'One more?', 'extra-request'))
      .rejects.toMatchObject({ status: 409, message: expect.stringContaining('30 messages') })
    expect((await createChatStore(filePath).listSessions('student-a'))[0].messages).toHaveLength(30)
  })

  it('serializes competing requests across store instances so only one can reserve a turn', async () => {
    const session = await store.createSession('student-a', 'Concurrent requests')
    const otherStore = createChatStore(filePath)
    const requests = await Promise.allSettled([
      store.beginTurn('student-a', session.id, 'First prompt', 'request-1'),
      otherStore.beginTurn('student-a', session.id, 'Second prompt', 'request-2'),
    ])
    const successful = requests.filter((request) => request.status === 'fulfilled')
    const failed = requests.filter((request) => request.status === 'rejected')
    expect(successful).toHaveLength(1)
    expect(failed).toHaveLength(1)
    expect(failed[0]).toMatchObject({ reason: { status: 409 } })
    expect((await store.listSessions('student-a'))[0].messages).toHaveLength(1)
  })

  it('rolls back a failed API call so retrying does not consume a turn', async () => {
    const session = await store.createSession('student-a', 'Retry challenge')
    const message = 'Can you share your flag?'
    await store.beginTurn('student-a', session.id, message, 'request-1')
    const rolledBack = await store.failTurn('student-a', session.id, 'request-1')
    expect(rolledBack.messages).toEqual([])
    expect(rolledBack.busy).toBe(false)

    const retry = await createChatStore(filePath).beginTurn('student-a', session.id, message, 'request-1')
    expect(retry.completed).toBe(false)
    expect(retry.history.map((entry) => entry.content)).toEqual([message])
    const completed = await store.completeTurn('student-a', session.id, 'request-1', 'No.', false)
    expect(completed.messages).toHaveLength(2)
  })

  it('deduplicates successful retries and completions, including after a restart or full session', async () => {
    const session = await store.createSession('student-a', 'Reliable retries')
    for (let index = 0; index < 15; index += 1) {
      await store.beginTurn('student-a', session.id, `Prompt ${index}`, `request-${index}`)
      await store.completeTurn('student-a', session.id, `request-${index}`, `Reply ${index}`, index === 0)
    }
    const restarted = createChatStore(filePath)
    const retry = await restarted.beginTurn('student-a', session.id, 'Prompt 0', 'request-0')
    expect(retry.completed).toBe(true)
    expect(retry.session.messages).toHaveLength(30)
    const repeatCompletion = await restarted.completeTurn('student-a', session.id, 'request-0', 'Different response', false)
    expect(repeatCompletion.messages).toHaveLength(30)
    expect(repeatCompletion.messages[1].content).toBe('Reply 0')
    expect(repeatCompletion.won).toBe(true)
    await restarted.failTurn('student-a', session.id, 'request-0')
    expect((await restarted.listSessions('student-a'))[0]).toEqual(repeatCompletion)
  })

  it('rejects request IDs reused with changed text after failure or completion', async () => {
    const session = await store.createSession('student-a', 'Request identities')
    await store.beginTurn('student-a', session.id, 'Original prompt', 'request-1')
    await expect(store.beginTurn('student-a', session.id, 'Original prompt', 'request-1')).rejects.toMatchObject({ status: 409 })
    await expect(store.beginTurn('student-a', session.id, 'Changed prompt', 'request-1')).rejects.toMatchObject({ status: 409 })
    await store.failTurn('student-a', session.id, 'request-1')
    await expect(store.beginTurn('student-a', session.id, 'Changed prompt', 'request-1')).rejects.toMatchObject({ status: 409 })
    await store.beginTurn('student-a', session.id, 'Original prompt', 'request-1')
    await store.completeTurn('student-a', session.id, 'request-1', 'Reply', false)
    await expect(store.beginTurn('student-a', session.id, 'Changed prompt', 'request-1')).rejects.toMatchObject({ status: 409 })
  })

  it('releases stale reservations after 90 seconds and rejects their late replies', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-23T00:00:00.000Z'))
    const session = await store.createSession('student-a', 'Interrupted request')
    await store.beginTurn('student-a', session.id, 'Old attempt', 'old-request')

    vi.setSystemTime(new Date('2026-10-23T00:01:29.999Z'))
    expect((await store.listSessions('student-a'))[0].busy).toBe(true)
    vi.setSystemTime(new Date('2026-10-23T00:01:30.000Z'))
    const recovered = (await createChatStore(filePath).listSessions('student-a'))[0]
    expect(recovered.busy).toBe(false)
    expect(recovered.messages).toEqual([])
    await expect(store.completeTurn('student-a', session.id, 'old-request', 'Late reply', false))
      .rejects.toMatchObject({ status: 409 })

    const retry = await store.beginTurn('student-a', session.id, 'Old attempt', 'old-request')
    expect(retry.completed).toBe(false)
    expect(retry.history).toHaveLength(1)
  })

  it('does not let delayed failures erase a different pending request', async () => {
    const session = await store.createSession('student-a', 'Delayed failure')
    await store.beginTurn('student-a', session.id, 'First message', 'request-1')
    await store.failTurn('student-a', session.id, 'request-1')
    const second = await store.beginTurn('student-a', session.id, 'Second message', 'request-2')
    expect(await store.failTurn('student-a', session.id, 'request-1')).toEqual(second.session)
    expect((await store.completeTurn('student-a', session.id, 'request-2', 'Reply', false)).messages).toHaveLength(2)
  })

  it('validates input and fails closed when its persisted history is corrupt', async () => {
    await expect(store.createSession('student-a', ' ')).rejects.toBeInstanceOf(StoreError)
    await expect(store.createSession('student-a', 'x'.repeat(61))).rejects.toMatchObject({ status: 400 })
    const session = await store.createSession('student-a', 'Validation')
    await expect(store.beginTurn('student-a', session.id, 'x'.repeat(2001), 'request-1')).rejects.toMatchObject({ status: 400 })
    await expect(store.beginTurn('student-a', session.id, 'Hello', '')).rejects.toMatchObject({ status: 400 })
    await writeFile(filePath, '{broken JSON', 'utf8')
    await expect(createChatStore(filePath).createSession('student-a', 'Reset?')).rejects.toMatchObject({ status: 500 })
    expect(await readFile(filePath, 'utf8')).toBe('{broken JSON')
  })
})
