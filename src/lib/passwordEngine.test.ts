import { describe, expect, it } from 'vitest'
import { buildDictionary, createBruteForcePlan, createDictionaryPlan, PasswordAttack } from './passwordEngine'

describe('brute force enumeration', () => {
  it('enumerates short candidates first, retaining leading zeroes', () => {
    const plan = createBruteForcePlan('00', '01', 3)
    expect(Array.from({ length: plan.total }, (_, i) => plan.candidateAt(i))).toEqual([
      '0', '1', '00', '01', '10', '11', '000', '001', '010', '011', '100', '101', '110', '111',
    ])
  })

  it('counts the actual successful comparison and stops there', () => {
    const attack = new PasswordAttack(createBruteForcePlan('042', '0123456789', 3))
    const result = attack.step(1000)
    expect(result.status).toBe('found')
    expect(result.attempts).toBe(153)
    expect(result.currentGuess).toBe('042')
    expect(attack.step(1000)).toEqual(result)
  })

  it('handles a one-character alphabet and de-duplicates symbols', () => {
    const plan = createBruteForcePlan('aaa', 'aa', 3)
    expect(plan.total).toBe(3)
    expect([0, 1, 2].map(plan.candidateAt)).toEqual(['a', 'aa', 'aaa'])
    expect(new PasswordAttack(plan).step(3).status).toBe('found')
  })

  it('enumerates complete Unicode symbols', () => {
    const plan = createBruteForcePlan('🔒a', 'a🔒', 2)
    expect(plan.candidateAt(4)).toBe('🔒a')
    expect(new PasswordAttack(plan).step(6).status).toBe('found')
  })

  it('reports excluded targets before making guesses', () => {
    const outside = new PasswordAttack(createBruteForcePlan('cat', '012', 3)).step(10)
    const tooLong = new PasswordAttack(createBruteForcePlan('0000', '01', 3)).step(10)
    expect(outside.status).toBe('unsupported')
    expect(outside.attempts).toBe(0)
    expect(tooLong.status).toBe('unsupported')
  })

  it('reports a safety limit without claiming to exhaust the full search', () => {
    const plan = createBruteForcePlan('11', '01', 2, 4)
    const result = new PasswordAttack(plan).step(100)
    expect(plan.fullTotal).toBe('6')
    expect(result.status).toBe('limited')
    expect(result.attempts).toBe(4)
    expect(result.currentGuess).toBe('01')
  })

  it('preserves batch progress and recognises a match at the attempt limit', () => {
    const attack = new PasswordAttack(createBruteForcePlan('01', '01', 2, 4))
    expect(attack.step(2)).toMatchObject({ status: 'running', attempts: 2, currentGuess: '1' })
    expect(attack.step(2)).toMatchObject({ status: 'found', attempts: 4, matched: '01' })
  })

  it('rejects empty alphabets, invalid lengths, caps, and candidate indexes', () => {
    expect(() => createBruteForcePlan('a', '', 1)).toThrow()
    expect(() => createBruteForcePlan('a', 'ab', 1.5)).toThrow()
    expect(() => createBruteForcePlan('a', 'ab', 7)).toThrow()
    expect(() => createBruteForcePlan('a', 'ab', 1, 0)).toThrow()
    const plan = createBruteForcePlan('a', 'ab', 1)
    expect(() => plan.candidateAt(-1)).toThrow(RangeError)
    expect(() => plan.candidateAt(2)).toThrow(RangeError)
  })
})

describe('dictionary attacks', () => {
  it('trims and de-duplicates lines while retaining spaces inside phrases', () => {
    expect(buildDictionary(' password \r\n\npassword\nblue marble\n123456')).toEqual(['password', 'blue marble', '123456'])
  })

  it('adds predictable variants in a stable, de-duplicated order', () => {
    expect(buildDictionary('hello', true)).toEqual(['hello', 'HELLO', 'Hello', 'hello1', 'hello123', 'hello!', 'hello2026'])
    const attack = new PasswordAttack(createDictionaryPlan('hello123', 'hello', true))
    expect(attack.step(50)).toMatchObject({ status: 'found', attempts: 5, matched: 'hello123' })
  })

  it('reports an exhausted list for an absent password', () => {
    const attack = new PasswordAttack(createDictionaryPlan('missing', 'one\ntwo', false))
    expect(attack.step(50)).toMatchObject({ status: 'exhausted', attempts: 2 })
  })

  it('compares the entire password with case sensitivity', () => {
    expect(new PasswordAttack(createDictionaryPlan('Password', 'password', false)).step(1).status).toBe('exhausted')
    expect(new PasswordAttack(createDictionaryPlan('pass', 'password', false)).step(1).status).toBe('exhausted')
    expect(new PasswordAttack(createDictionaryPlan('Password', 'password', true)).step(100)).toMatchObject({ status: 'found', matched: 'Password' })
  })

  it('rejects empty and excessive wordlists', () => {
    expect(() => createDictionaryPlan('a', '\n  ', false)).toThrow()
    expect(() => createDictionaryPlan('a', 'b'.repeat(129), false)).toThrow()
    expect(() => createDictionaryPlan('a', Array.from({ length: 10001 }, (_, i) => String(i)).join('\n'), false)).toThrow()
  })
})

describe('complete attempt stream', () => {
  it('emits every brute-force comparison once across batches, including the final match', () => {
    const plan = createBruteForcePlan('042', '0123456789', 3)
    const attack = new PasswordAttack(plan)
    const guesses: string[] = []
    const collect = (candidate: string) => { guesses.push(candidate) }
    expect(attack.step(100, collect)).toMatchObject({ status: 'running', attempts: 100 })
    expect(guesses).toHaveLength(100)
    expect(attack.step(100, collect)).toMatchObject({ status: 'found', attempts: 153 })
    expect(guesses).toEqual(Array.from({ length: 153 }, (_, index) => plan.candidateAt(index)))
    expect(guesses[0]).toBe('0')
    expect(guesses.at(-1)).toBe('042')
    attack.step(100, collect)
    expect(guesses).toHaveLength(153)
  })

  it('retains all dictionary comparisons rather than just the recent snapshot tail', () => {
    const words = Array.from({ length: 30 }, (_, index) => `word${index}`)
    const attack = new PasswordAttack(createDictionaryPlan('missing', words.join('\n'), false))
    const guesses: string[] = []
    const collect = (candidate: string) => { guesses.push(candidate) }
    attack.step(12, collect)
    attack.step(12, collect)
    const last = attack.step(12, collect)
    expect(last).toMatchObject({ status: 'exhausted', attempts: 30 })
    expect(last.recentGuesses).toHaveLength(7)
    expect(guesses).toEqual(words)
  })

  it('never emits untried comparisons for capped or unsupported searches', () => {
    const guesses: string[] = []
    const collect = (candidate: string) => { guesses.push(candidate) }
    const capped = new PasswordAttack(createBruteForcePlan('11', '01', 2, 4))
    expect(capped.step(100, collect)).toMatchObject({ status: 'limited', attempts: 4 })
    expect(guesses).toEqual(['0', '1', '00', '01'])
    capped.step(100, collect)
    new PasswordAttack(createBruteForcePlan('x', '01', 2)).step(100, collect)
    expect(guesses).toEqual(['0', '1', '00', '01'])
  })
})
