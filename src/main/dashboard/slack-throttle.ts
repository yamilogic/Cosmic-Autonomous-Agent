/**
 * Per-token Slack limiter: caps concurrent calls and honours Retry-After
 * across every caller that shares a token. Keys are token hashes only —
 * a key must be safe to log, never the token itself.
 */
import { createHash } from 'node:crypto'

/** Slack tolerates a small burst per token; 2 in flight stays well under 429s. */
const MAX_IN_FLIGHT_PER_TOKEN = 2

interface Gate {
  inFlight: number
  /** No new call on this key starts before this epoch-ms. */
  blockedUntilMs: number
  /** FIFO waiters — a queued project never starves behind later arrivals. */
  queue: Array<() => void>
  wakeTimer: ReturnType<typeof setTimeout> | null
}

const gates = new Map<string, Gate>()

function gateFor(tokenKey: string): Gate {
  let gate = gates.get(tokenKey)
  if (!gate) {
    gate = { inFlight: 0, blockedUntilMs: 0, queue: [], wakeTimer: null }
    gates.set(tokenKey, gate)
  }
  return gate
}

function canStart(gate: Gate): boolean {
  return gate.inFlight < MAX_IN_FLIGHT_PER_TOKEN && Date.now() >= gate.blockedUntilMs
}

function pump(tokenKey: string): void {
  const gate = gates.get(tokenKey)
  if (!gate) return
  while (gate.queue.length > 0 && canStart(gate)) {
    const start = gate.queue.shift() as () => void
    start()
  }
  if (gate.wakeTimer !== null) {
    clearTimeout(gate.wakeTimer)
    gate.wakeTimer = null
  }
  if (gate.queue.length > 0 && gate.blockedUntilMs > Date.now()) {
    gate.wakeTimer = setTimeout(() => {
      gate.wakeTimer = null
      pump(tokenKey)
    }, gate.blockedUntilMs - Date.now())
  }
  if (gate.inFlight === 0 && gate.queue.length === 0 && gate.wakeTimer === null) {
    gates.delete(tokenKey)
  }
}

/** Stable, log-safe identity for a token. */
export function slackTokenKey(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 16)
}

/** Run fn under the per-token concurrency cap, queued FIFO. */
export function withSlackLimit<T>(tokenKey: string, fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const gate = gateFor(tokenKey)
    const start = (): void => {
      gate.inFlight += 1
      fn()
        .then(resolve, reject)
        .finally(() => {
          gate.inFlight -= 1
          pump(tokenKey)
        })
    }
    if (gate.queue.length === 0 && canStart(gate)) {
      start()
      return
    }
    gate.queue.push(start)
    pump(tokenKey)
  })
}

/** A call hit the limit: hold every new start on this key for retryAfterMs. */
export function reportSlackRateLimit(tokenKey: string, retryAfterMs: number): void {
  const gate = gateFor(tokenKey)
  gate.blockedUntilMs = Math.max(gate.blockedUntilMs, Date.now() + Math.max(0, retryAfterMs))
  pump(tokenKey)
}
