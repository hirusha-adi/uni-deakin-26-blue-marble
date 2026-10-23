import { NextRequest } from 'next/server'
import { MAX_CHAT_INPUT_LENGTH, type ChatSession } from '../../../../lib/promptChat'
import { ChatProviderError, generateChatReply } from '../../../../lib/server/promptChatProvider'
import { chatError, chatJson, getChatOwner, isChatId, readChatBody } from '../../../../lib/server/promptChatHttp'
import { getChatStore, StoreError } from '../../../../lib/server/promptChatStore'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const owner = getChatOwner(request)
  const store = getChatStore()
  let pending: { sessionId: string; requestId: string; reservationId: string } | undefined
  try {
    const { sessionId, message, requestId } = await readChatBody(request)
    if (!isChatId(sessionId) || !isChatId(requestId)) {
      throw new StoreError(400, 'Select a chat session and try again.')
    }
    if (typeof message !== 'string' || !message.trim() || message.length > MAX_CHAT_INPUT_LENGTH) {
      throw new StoreError(400, `Write a message of 1–${MAX_CHAT_INPUT_LENGTH} characters.`)
    }
    const turn = await store.beginTurn(owner, sessionId, message.trim(), requestId)
    if (turn.completed) return chatJson(request, owner, { session: turn.session })
    pending = { sessionId, requestId, reservationId: turn.reservationId }
    const reply = await generateChatReply(turn.history)
    const session = await store.completeTurn(owner, sessionId, requestId, reply.content, reply.won, turn.reservationId)
    return chatJson(request, owner, { session })
  } catch (problem) {
    let session: ChatSession | undefined
    if (pending) {
      try {
        session = await store.failTurn(owner, pending.sessionId, pending.requestId, pending.reservationId)
      } catch {
        // A failed disk write must not replace the original safe error with internal details.
      }
    }
    if (problem instanceof ChatProviderError && session) {
      return chatJson(request, owner, { error: problem.message, session }, problem.status)
    }
    return chatError(request, owner, problem)
  }
}
