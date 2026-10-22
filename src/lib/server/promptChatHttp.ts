import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { ChatProviderError } from './promptChatProvider'
import { StoreError } from './promptChatStore'

const OWNER_COOKIE = 'blue-marble-chat-owner'
const MAX_BODY_BYTES = 16_384
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isChatId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

export function getChatOwner(request: NextRequest) {
  const existing = request.cookies.get(OWNER_COOKIE)?.value
  return isChatId(existing) ? existing : randomUUID()
}

/** A public cache namespace, never an authorization credential. */
export function getChatBrowserId(owner: string) {
  return createHash('sha256').update(`blue-marble-browser:${owner}`).digest('hex')
}

// Next may normalize the route URL to localhost internally. Use the actual
// HTTP Host for origin checks and cookie policy, preserving the request scheme.
function requestUrl(request: NextRequest) {
  const url = new URL(request.url)
  const host = request.headers.get('host')
  if (host) url.host = host
  return url
}

export function chatJson(request: NextRequest, owner: string, data: Record<string, unknown>, status = 200) {
  const response = NextResponse.json({ ...data, browserId: getChatBrowserId(owner) }, {
    status,
    headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' },
  })
  const url = requestUrl(request)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  // Mint the anonymous identity once; regular replies keep its cookie unchanged.
  if (request.cookies.get(OWNER_COOKIE)?.value !== owner) {
    response.cookies.set(OWNER_COOKIE, owner, {
      httpOnly: true,
      sameSite: 'lax',
      secure: !local && (process.env.NODE_ENV === 'production' || url.protocol === 'https:'),
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    })
  }
  return response
}

export function chatError(request: NextRequest, owner: string, problem: unknown) {
  if (problem instanceof StoreError || problem instanceof ChatProviderError) {
    return chatJson(request, owner, { error: problem.message }, problem.status)
  }
  return chatJson(request, owner, { error: 'The chat could not load. Please try again or tell your instructor.' }, 500)
}

export async function readChatBody(request: NextRequest): Promise<Record<string, unknown>> {
  const origin = request.headers.get('origin')
  if ((origin && origin !== requestUrl(request).origin) || request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new StoreError(403, 'Open the challenge on this website before sending messages.')
  }
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new StoreError(415, 'Send a JSON request.')
  }
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES || !request.body) {
    throw new StoreError(413, 'That request is too large or empty.')
  }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BODY_BYTES) {
        await reader.cancel()
        throw new StoreError(413, 'That request is too large.')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }

  try {
    const data: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Expected object')
    return data as Record<string, unknown>
  } catch {
    throw new StoreError(400, 'The request could not be read. Please try again.')
  }
}
