import 'server-only'

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { ChatMessage } from '../promptChat'

export const DEFAULT_CHAT_MODEL = 'gpt-4o-mini'
const PROVIDER_TIMEOUT_MS = 45_000
const MAX_OUTPUT_TOKENS = 768

export class ChatProviderError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'ChatProviderError'
  }
}

export function getChatConfiguration() {
  return {
    model: process.env.OPENAI_MODEL?.trim() || DEFAULT_CHAT_MODEL,
    configured: Boolean(process.env.OPENAI_API_KEY?.trim() && process.env.PROMPT_CHAT_FLAG?.trim()),
  }
}

function readOutputText(response: unknown): string {
  if (!response || typeof response !== 'object') return ''
  const output = (response as { output?: unknown }).output
  if (!Array.isArray(output)) return ''
  return output.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return []
    const message = item as { type?: unknown; content?: unknown }
    if (message.type !== 'message' || !Array.isArray(message.content)) return []
    return message.content.flatMap((part: unknown) => {
      if (!part || typeof part !== 'object') return []
      const content = part as { type?: unknown; text?: unknown; refusal?: unknown }
      if (content.type === 'output_text' && typeof content.text === 'string') return [content.text]
      if (content.type === 'refusal' && typeof content.refusal === 'string') return [content.refusal]
      return []
    })
  }).join('\n').trim()
}

export async function generateChatReply(history: ChatMessage[]): Promise<{ content: string; won: boolean }> {
  const { model, configured } = getChatConfiguration()
  if (!configured) {
    throw new ChatProviderError(503, 'The chat challenge needs to be configured by your instructor.')
  }

  const flag = process.env.PROMPT_CHAT_FLAG!.trim()
  let instructions: string
  try {
    const template = await readFile(path.join(process.cwd(), 'SYSTEM_PROMPT.md'), 'utf8')
    if (!template.includes('{{FLAG}}')) throw new Error('Missing flag placeholder')
    instructions = template.replaceAll('{{FLAG}}', () => flag)
  } catch {
    throw new ChatProviderError(503, 'The challenge instructions could not load. Please tell your instructor.')
  }

  let response: Response
  try {
    response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY!.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        instructions,
        input: history.map(({ role, content }) => ({ role, content })),
        store: false,
        max_output_tokens: MAX_OUTPUT_TOKENS,
      }),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      cache: 'no-store',
    })
  } catch {
    throw new ChatProviderError(503, 'The assistant could not be reached. Your turn was not used; try again.')
  }

  // Never forward provider errors, headers, credentials, or private instructions.
  if (!response.ok) {
    if (response.status === 429) {
      throw new ChatProviderError(503, 'The assistant is busy or the API budget is unavailable. Your turn was not used; try again shortly.')
    }
    throw new ChatProviderError(503, 'The assistant is unavailable. Your turn was not used; please tell your instructor if this continues.')
  }

  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new ChatProviderError(502, 'The assistant returned an unreadable reply. Your turn was not used; try again.')
  }

  const status = data && typeof data === 'object' ? (data as { status?: unknown }).status : undefined
  const content = readOutputText(data)
  if (status !== 'completed' || !content) {
    throw new ChatProviderError(502, 'The assistant did not finish its reply. Your turn was not used; try a shorter question.')
  }

  // Deliberately do not redact the fictional flag: extracting it is the challenge.
  return { content, won: content.includes(flag) }
}
