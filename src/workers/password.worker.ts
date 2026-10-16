import { createAttackPlan, PasswordAttack, type AttackConfig } from '../lib/passwordEngine'

interface WorkerStart {
  type: 'start'
  config: AttackConfig
  candidatesPerSecond: number
}

// A dedicated worker enumerates and compares guesses without blocking the page.
// Its timer deliberately slows the lesson down; this is not a cracking benchmark.
let timer: ReturnType<typeof setTimeout> | undefined
self.onmessage = (event: MessageEvent<WorkerStart>) => {
  if (timer) clearTimeout(timer)
  try {
    const { config, candidatesPerSecond } = event.data
    const attack = new PasswordAttack(createAttackPlan(config))
    const started = performance.now()
    const initial = attack.snapshot()
    self.postMessage({ type: 'snapshot', snapshot: initial, newGuesses: [] })
    if (initial.status !== 'running') return
    const delay = 100
    const batchSize = Math.max(1, Math.min(2500, Math.floor(candidatesPerSecond / 10)))
    const tick = () => {
      const newGuesses: string[] = []
      const snapshot = attack.step(batchSize, candidate => newGuesses.push(candidate))
      snapshot.elapsedMs = performance.now() - started
      self.postMessage({ type: 'snapshot', snapshot, newGuesses })
      if (snapshot.status === 'running') timer = setTimeout(tick, delay)
    }
    timer = setTimeout(tick, delay)
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Unable to start this demo.' })
  }
}
