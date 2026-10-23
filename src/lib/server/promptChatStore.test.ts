import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { promisify } from 'node:util'
import ts from 'typescript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeChatStores, createChatStore, StoreError } from './promptChatStore'

const execFileAsync = promisify(execFile)

async function buildChildStore(directory: string): Promise<string> {
  // Run the actual store in separate Node processes, outside Vitest's module cache.
  const outputDirectory = join(directory, 'child-store')
  await mkdir(outputDirectory, { recursive: true })
  const compilerOptions = { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  await Promise.all([
    ['../promptChat.ts', 'promptChat.mjs'],
    ['./promptChatStore.ts', 'promptChatStore.mjs'],
    ['./promptChatDatabase.ts', 'promptChatDatabase.mjs'],
  ].map(async ([sourcePath, outputName]) => {
    const source = (await readFile(new URL(sourcePath, import.meta.url), 'utf8'))
      .replaceAll("from '../promptChat'", "from './promptChat.mjs'")
      .replaceAll("from './promptChatDatabase'", "from './promptChatDatabase.mjs'")
      .replaceAll("from './promptChatStore'", "from './promptChatStore.mjs'")
    await writeFile(join(outputDirectory, outputName), ts.transpileModule(source, { compilerOptions }).outputText)
  }))
  return join(outputDirectory, 'promptChatStore.mjs')
}

describe('durable prompt chat sessions', () => {
  let directory: string
  let filePath: string
  let store: ReturnType<typeof createChatStore>

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'blue-marble-chat-'))
    filePath = join(directory, 'nested', 'sessions.sqlite')
    store = createChatStore(filePath)
  })

  afterEach(async () => {
    vi.useRealTimers()
    closeChatStores()
    await rm(directory, { recursive: true, force: true })
  })

  it('stores normalized records in a native SQLite database with WAL enabled', async () => {
    const session = await store.createSession('student-a', 'SQLite storage')
    await store.beginTurn('student-a', session.id, 'What is a database?', 'request-1')
    await store.completeTurn('student-a', session.id, 'request-1', 'An organized collection of data.', false)

    expect((await readFile(filePath)).subarray(0, 16).toString()).toBe('SQLite format 3\u0000')
    const database = new DatabaseSync(filePath, { readOnly: true })
    try {
      expect(database.prepare('PRAGMA journal_mode').get()).toMatchObject({ journal_mode: 'wal' })
      const tables = database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all()
      expect(tables.map(({ name }) => name)).toEqual(expect.arrayContaining(['chat_sessions', 'chat_messages', 'chat_requests']))
      expect(database.prepare('SELECT count(*) AS count FROM chat_sessions').get()).toMatchObject({ count: 1 })
      expect(database.prepare('SELECT count(*) AS count FROM chat_messages').get()).toMatchObject({ count: 2 })
      expect(database.prepare('SELECT count(*) AS count FROM chat_requests').get()).toMatchObject({ count: 1 })
    } finally {
      database.close()
    }
  })

  it('persists SQL-looking names, owners, messages, and request IDs as ordinary text', async () => {
    const owner = "student'); DROP TABLE chat_sessions; --"
    const name = "Robert'); DROP TABLE chat_messages; --"
    const prompt = "' UNION SELECT owner_id FROM chat_sessions; --"
    const reply = 'SELECT * FROM chat_messages;\n<script>alert("hello")</script>'
    const requestId = "request'); DELETE FROM chat_requests; --"
    const session = await store.createSession(owner, name)
    await store.beginTurn(owner, session.id, prompt, requestId)
    const completed = await store.completeTurn(owner, session.id, requestId, reply, false)
    store.close()

    const reopened = createChatStore(filePath)
    expect(await reopened.listSessions(owner)).toEqual([completed])
    expect(completed.name).toBe(name)
    expect(completed.messages.map(({ content }) => content)).toEqual([prompt, reply])
    expect((await reopened.createSession('another-student', 'Still available')).messages).toEqual([])
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

  it('reserves a turn atomically across independent Node processes', async () => {
    const session = await store.createSession('student-a', 'Process concurrency')
    const modulePath = await buildChildStore(directory)
    const childScript = `
      import { pathToFileURL } from 'node:url';
      const { createChatStore } = await import(pathToFileURL(process.argv[1]).href);
      const childStore = createChatStore(process.argv[2]);
      process.stdout.write('ready\\n');
      await new Promise((resolve) => process.stdin.once('data', resolve));
      try {
        await childStore.beginTurn('student-a', process.argv[3], process.argv[4], process.argv[4]);
        process.stdout.write('reserved');
      } catch (error) {
        if (error.status !== 409) throw error;
        process.stdout.write('busy');
      } finally {
        childStore.close();
      }
    `
    const workers = ['request-1', 'request-2'].map((requestId) => {
      const done = execFileAsync(process.execPath, [
        '--input-type=module', '--eval', childScript, modulePath, filePath, session.id, requestId,
      ])
      const ready = new Promise<void>((resolve, reject) => {
        done.child.stdout!.once('data', () => resolve())
        void done.catch(reject)
      })
      return { done, ready }
    })
    let outcomes: Awaited<(typeof workers)[number]['done']>[]
    try {
      await Promise.all(workers.map(({ ready }) => ready))
      // Both processes are loaded before either attempts to reserve the same turn.
      for (const { done } of workers) done.child.stdin!.end('go')
      outcomes = await Promise.all(workers.map(({ done }) => done))
    } finally {
      for (const { done } of workers) done.child.kill()
    }
    expect(outcomes.map(({ stdout }) => stdout.replace('ready\n', '')).sort()).toEqual(['busy', 'reserved'])
    expect((await store.listSessions('student-a'))[0]).toMatchObject({
      busy: true,
      messages: [{ id: expect.any(String), role: 'user', content: expect.stringMatching(/^request-[12]$/) }],
    })
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

  it('rejects late completions and ignores late failures for an expired reservation retried with the same request ID', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-23T00:00:00.000Z'))
    const session = await store.createSession('student-a', 'Same-ID retry')
    const original = await store.beginTurn('student-a', session.id, 'Same prompt', 'request-1')
    vi.setSystemTime(new Date('2026-10-23T00:01:30.000Z'))
    const retry = await createChatStore(filePath).beginTurn('student-a', session.id, 'Same prompt', 'request-1')
    expect(retry.reservationId).toBeTruthy()
    expect(retry.reservationId).not.toBe(original.reservationId)

    await expect(store.completeTurn('student-a', session.id, 'request-1', 'Stale response', true, original.reservationId))
      .rejects.toMatchObject({ status: 409 })
    expect(await store.failTurn('student-a', session.id, 'request-1', original.reservationId)).toEqual(retry.session)
    const finished = await store.completeTurn('student-a', session.id, 'request-1', 'Current response', false, retry.reservationId)
    expect(finished.messages.map(({ content }) => content)).toEqual(['Same prompt', 'Current response'])
    expect(finished.won).toBe(false)
  })

  it('validates input before accepting a session or message', async () => {
    await expect(store.createSession('student-a', ' ')).rejects.toBeInstanceOf(StoreError)
    await expect(store.createSession('student-a', 'x'.repeat(61))).rejects.toMatchObject({ status: 400 })
    const session = await store.createSession('student-a', 'Validation')
    await expect(store.beginTurn('student-a', session.id, 'x'.repeat(2001), 'request-1')).rejects.toMatchObject({ status: 400 })
    await expect(store.beginTurn('student-a', session.id, 'Hello', '')).rejects.toMatchObject({ status: 400 })
  })

  it('fails closed without overwriting a corrupt database', async () => {
    closeChatStores()
    await mkdir(dirname(filePath), { recursive: true })
    const contents = 'This is not a SQLite database.'
    await writeFile(filePath, contents, 'utf8')
    await expect(createChatStore(filePath).createSession('student-a', 'Reset?')).rejects.toMatchObject({ status: 500 })
    expect(await readFile(filePath, 'utf8')).toBe(contents)
  })

  it('imports legacy sessions once, preserving ownership, history, retries, wins, and active turns', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const now = new Date('2026-10-23T00:00:00.000Z')
    vi.setSystemTime(now)
    const legacyPath = join(dirname(filePath), 'prompt-chat-sessions.json')
    const completedId = randomUUID()
    const pendingId = randomUUID()
    const history = [
      { id: randomUUID(), role: 'user', content: 'Legacy prompt' },
      { id: randomUUID(), role: 'assistant', content: 'Legacy winning reply' },
    ]
    const pendingMessage = { id: randomUUID(), role: 'user', content: 'Still waiting' }
    const metadata = { createdAt: now.toISOString(), updatedAt: now.toISOString() }
    const legacy = {
      version: 1,
      sessions: [
        {
          id: completedId, ownerId: 'student-a', name: 'Saved winner', ...metadata,
          messages: history, won: true, pending: null,
          requests: [
            { id: 'completed-request', userText: 'Legacy prompt', status: 'completed' },
            { id: 'failed-request', userText: 'Earlier failed prompt', status: 'failed' },
          ],
        },
        {
          id: pendingId, ownerId: 'student-b', name: 'Pending reply', ...metadata,
          messages: [pendingMessage], won: false,
          requests: [{ id: 'pending-request', userText: pendingMessage.content, status: 'pending' }],
          pending: { requestId: 'pending-request', userMessageId: pendingMessage.id, startedAt: now.getTime() },
        },
      ],
    }
    const original = JSON.stringify(legacy)
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(legacyPath, original, 'utf8')

    const imported = (await store.listSessions('student-a'))[0]
    expect(imported).toEqual({ id: completedId, name: 'Saved winner', ...metadata, messages: history, busy: false, won: true })
    expect(await store.listSessions('unrelated-student')).toEqual([])
    expect((await store.beginTurn('student-a', completedId, 'Legacy prompt', 'completed-request')).completed).toBe(true)
    await expect(store.beginTurn('student-a', completedId, 'Changed prompt', 'failed-request')).rejects.toMatchObject({ status: 409 })
    const pending = (await store.listSessions('student-b'))[0]
    expect(pending).toEqual({ id: pendingId, name: 'Pending reply', ...metadata, messages: [pendingMessage], busy: true, won: false })
    const finished = await store.completeTurn('student-b', pendingId, 'pending-request', 'Arrived after migration', false)
    expect(finished.messages.map(({ content }) => content)).toEqual(['Still waiting', 'Arrived after migration'])
    expect(finished.busy).toBe(false)
    expect(await readFile(legacyPath, 'utf8')).toBe(original)

    store.close()
    // The database is authoritative after import; an old backup must never be reapplied.
    await writeFile(legacyPath, '{broken legacy backup', 'utf8')
    const reopened = createChatStore(filePath)
    expect(await reopened.listSessions('student-a')).toEqual([imported])
    expect(await reopened.listSessions('student-b')).toEqual([finished])
  })

  it.each([
    '{broken JSON',
    JSON.stringify({ version: 2, sessions: [] }),
    JSON.stringify({ version: 1, sessions: [{ id: randomUUID(), messages: [] }] }),
  ])('fails closed when the legacy backup is malformed (%#)', async (contents) => {
    const legacyPath = join(directory, 'legacy.json')
    await writeFile(legacyPath, contents, 'utf8')
    const importing = createChatStore(filePath, legacyPath)
    await expect(importing.createSession('student-a', 'Do not reset history')).rejects.toMatchObject({ status: 500 })
    expect(await readFile(legacyPath, 'utf8')).toBe(contents)
    await expect(createChatStore(filePath, legacyPath).listSessions('student-a')).rejects.toMatchObject({ status: 500 })
  })
})
