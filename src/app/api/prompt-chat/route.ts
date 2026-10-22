import { NextRequest } from 'next/server'
import { getChatConfiguration } from '../../../lib/server/promptChatProvider'
import { chatError, chatJson, getChatOwner } from '../../../lib/server/promptChatHttp'
import { getChatStore } from '../../../lib/server/promptChatStore'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const owner = getChatOwner(request)
  try {
    const sessions = await getChatStore().listSessions(owner)
    return chatJson(request, owner, { sessions, ...getChatConfiguration() })
  } catch (problem) {
    return chatError(request, owner, problem)
  }
}
