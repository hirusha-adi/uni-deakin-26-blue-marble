export const MAX_ATTEMPTS = 1_000_000
export const MAX_DICTIONARY_WORDS = 10_000

export type AttackMethod = 'brute' | 'dictionary'
export type AttackStatus = 'running' | 'found' | 'exhausted' | 'limited' | 'unsupported'

export interface AttackConfig {
  method: AttackMethod
  target: string
  alphabet: string
  maxLength: number
  wordlist: string
  variations: boolean
}

export interface AttackPlan {
  target: string
  total: number
  fullTotal: string
  capped: boolean
  unsupportedReason?: string
  candidateAt: (index: number) => string
}

export interface AttackSnapshot {
  status: AttackStatus
  attempts: number
  total: number
  fullTotal: string
  currentGuess: string
  recentGuesses: string[]
  matched?: string
  reason?: string
  elapsedMs: number
}

export function buildDictionary(wordlist: string, variations = false): string[] {
  const words: string[] = []
  const seen = new Set<string>()
  for (const line of wordlist.split(/\r?\n/)) {
    const word = line.trim()
    if (!word) continue
    const candidates = variations
      ? [word, word.toLowerCase(), word.toUpperCase(), word[0].toUpperCase() + word.slice(1), `${word}1`, `${word}123`, `${word}!`, `${word}2026`]
      : [word]
    for (const candidate of candidates) {
      if (!seen.has(candidate)) {
        seen.add(candidate)
        words.push(candidate)
      }
    }
  }
  return words
}

export function createBruteForcePlan(target: string, alphabet: string, maxLength: number, attemptCap = MAX_ATTEMPTS): AttackPlan {
  const symbols = [...new Set(Array.from(alphabet))]
  if (!symbols.length || symbols.length > 64) throw new Error('Choose between 1 and 64 unique characters for the alphabet.')
  if (!Number.isInteger(maxLength) || maxLength < 1 || maxLength > 6) throw new Error('Maximum length must be a whole number from 1 to 6.')
  if (!Number.isInteger(attemptCap) || attemptCap < 1 || attemptCap > MAX_ATTEMPTS) throw new Error('Attempt limit must be between 1 and 1,000,000.')

  const base = symbols.length
  const counts = Array.from({ length: maxLength }, (_, i) => base ** (i + 1))
  const fullTotal = counts.reduce((sum, count) => sum + count, 0)
  const targetSymbols = Array.from(target)
  let unsupportedReason: string | undefined
  if (!targetSymbols.length) unsupportedReason = 'Enter a demo password before starting.'
  else if (targetSymbols.length > maxLength) unsupportedReason = 'This password is longer than your maximum length. Increase the length or try another password.'
  else if (targetSymbols.some((symbol) => !symbols.includes(symbol))) unsupportedReason = 'This password contains characters outside your alphabet. Add those characters or choose another preset.'

  return {
    target,
    total: Math.min(fullTotal, attemptCap),
    fullTotal: String(fullTotal),
    capped: fullTotal > attemptCap,
    unsupportedReason,
    candidateAt(index: number) {
      if (!Number.isInteger(index) || index < 0 || index >= Math.min(fullTotal, attemptCap)) throw new RangeError('Candidate index is outside this attack plan.')
      let offset = index
      let length = 1
      while (offset >= counts[length - 1]) {
        offset -= counts[length - 1]
        length += 1
      }
      const characters = Array<string>(length)
      for (let position = length - 1; position >= 0; position -= 1) {
        characters[position] = symbols[offset % base]
        offset = Math.floor(offset / base)
      }
      return characters.join('')
    },
  }
}

export function createDictionaryPlan(target: string, wordlist: string, variations: boolean): AttackPlan {
  if (wordlist.length > 300_000) throw new Error('Keep the demo wordlist under 300,000 characters.')
  const words = buildDictionary(wordlist, variations)
  if (!words.length) throw new Error('Add at least one word to the dictionary, one per line.')
  if (words.length > MAX_DICTIONARY_WORDS) throw new Error('Keep the dictionary under 10,000 unique candidates, including variations.')
  if (words.some((word) => word.length > 128)) throw new Error('Keep each dictionary candidate under 129 characters.')
  return {
    target,
    total: words.length,
    fullTotal: String(words.length),
    capped: false,
    unsupportedReason: target ? undefined : 'Enter a demo password before starting.',
    candidateAt(index: number) {
      if (!Number.isInteger(index) || index < 0 || index >= words.length) throw new RangeError('Candidate index is outside this attack plan.')
      return words[index]
    },
  }
}

export function createAttackPlan(config: AttackConfig): AttackPlan {
  if (config.target.length > 128) throw new Error('Keep the demo password under 129 characters.')
  return config.method === 'brute'
    ? createBruteForcePlan(config.target, config.alphabet, config.maxLength)
    : createDictionaryPlan(config.target, config.wordlist, config.variations)
}

export class PasswordAttack {
  private nextIndex = 0
  private recentGuesses: string[] = []
  private status: AttackStatus
  private matched?: string

  constructor(readonly plan: AttackPlan) {
    this.status = plan.unsupportedReason ? 'unsupported' : 'running'
  }

  step(batchSize: number, onAttempt?: (candidate: string) => void): AttackSnapshot {
    if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error('Batch size must be a positive whole number.')
    if (this.status !== 'running') return this.snapshot()
    const end = Math.min(this.nextIndex + batchSize, this.plan.total)
    for (; this.nextIndex < end;) {
      const candidate = this.plan.candidateAt(this.nextIndex)
      this.nextIndex += 1
      onAttempt?.(candidate)
      this.recentGuesses.push(candidate)
      if (this.recentGuesses.length > 7) this.recentGuesses.shift()
      if (candidate === this.plan.target) {
        this.status = 'found'
        this.matched = candidate
        break
      }
    }
    if (this.status === 'running' && this.nextIndex >= this.plan.total) this.status = this.plan.capped ? 'limited' : 'exhausted'
    return this.snapshot()
  }

  snapshot(): AttackSnapshot {
    return {
      status: this.status,
      attempts: this.nextIndex,
      total: this.plan.total,
      fullTotal: this.plan.fullTotal,
      currentGuess: this.recentGuesses.at(-1) ?? '',
      recentGuesses: [...this.recentGuesses],
      matched: this.matched,
      reason: this.plan.unsupportedReason,
      elapsedMs: 0,
    }
  }
}
