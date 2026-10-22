/** Public chat contracts only. Secrets and provider calls live on the server. */
export const MAX_CHAT_MESSAGES = 30
export const MAX_CHAT_TURNS = MAX_CHAT_MESSAGES / 2
export const MAX_CHAT_INPUT_LENGTH = 2000
export const MAX_SESSION_NAME_LENGTH = 60

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

export interface ChatSession {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  messages: ChatMessage[]
  busy: boolean
  won: boolean
}
