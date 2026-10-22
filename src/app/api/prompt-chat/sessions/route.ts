import { NextRequest } from 'next/server'
import { MAX_SESSION_NAME_LENGTH } from '../../../../lib/promptChat'
import { chatError, chatJson, getChatOwner, readChatBody } from '../../../../lib/server/promptChatHttp'
import { getChatStore, StoreError } from '../../../../lib/server/promptChatStore'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const owner = getChatOwner(request)
  try {
    const { name } = await readChatBody(request)
    if (typeof name !== 'string' || !name.trim() || name.trim().length > MAX_SESSION_NAME_LENGTH) {
      throw new StoreError(400, `Give your session a name of 1–${MAX_SESSION_NAME_LENGTH} characters.`)
    }
    const session = await getChatStore().createSession(owner, name.trim())
    return chatJson(request, owner, { session }, 201)
  } catch (problem) {
    return chatError(request, owner, problem)
  }
}
