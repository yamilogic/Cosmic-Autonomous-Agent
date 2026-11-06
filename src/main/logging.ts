import type {
  LogCategory,
  LogEntry,
  LogFilter,
  LogLevel
} from '../shared/ipc-contract'

const TOKEN_PATTERNS = [
  /xox[a-zA-Z]-[A-Za-z0-9-]+/g,
  /nvapi-[A-Za-z0-9-]+/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi
]

const MAX_LOG_ENTRIES = 2000
let logBuffer: LogEntry[] = []
let entrySequence = 0
let retentionMs = 15 * 60 * 1000 // 15 minutes default (0 = session only / no auto-expiry)

const subscribers = new Set<(entry: LogEntry) => void>()

function redactString(value: string): string {
  let redacted = value
  for (const pattern of TOKEN_PATTERNS) {
    redacted = redacted.replace(pattern, '[REDACTED]')
  }
  return redacted
}

export function redact(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactString(value)
  }

  if (Array.isArray(value)) {
    return value.map(redact)
  }

  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (/token|secret|password|authorization|key|cookie/i.test(key)) {
        out[key] = '[REDACTED]'
      } else {
        out[key] = redact(nested)
      }
    }
    return out
  }

  return value
}

export function sweepExpiredLogs(): number {
  if (retentionMs <= 0) return 0
  const cutoff = Date.now() - retentionMs
  const initialCount = logBuffer.length
  logBuffer = logBuffer.filter((entry) => {
    const entryTime = new Date(entry.ts).getTime()
    return !isNaN(entryTime) && entryTime >= cutoff
  })
  return initialCount - logBuffer.length
}

// Background sweeper running every 30 seconds
const sweeperInterval = setInterval(() => {
  sweepExpiredLogs()
}, 30000)
if (sweeperInterval.unref) {
  sweeperInterval.unref()
}

function write(
  level: LogLevel,
  message: string,
  meta?: unknown,
  category: LogCategory = 'system'
): LogEntry {
  sweepExpiredLogs()

  const entry: LogEntry = {
    id: `log_${Date.now()}_${++entrySequence}`,
    level,
    category,
    message: redactString(message),
    ...(meta !== undefined ? { meta: redact(meta) } : {}),
    ts: new Date().toISOString()
  }

  logBuffer.push(entry)
  if (logBuffer.length > MAX_LOG_ENTRIES) {
    logBuffer.shift()
  }

  const line = JSON.stringify(entry)
  if (level === 'error') {
    console.error(line)
  } else if (level === 'warn') {
    console.warn(line)
  } else {
    console.log(line)
  }

  for (const sub of subscribers) {
    try {
      sub(entry)
    } catch {
      // Ignore subscriber failure
    }
  }

  return entry
}

export const log = {
  debug: (message: string, meta?: unknown, category: LogCategory = 'system'): LogEntry =>
    write('debug', message, meta, category),
  info: (message: string, meta?: unknown, category: LogCategory = 'system'): LogEntry =>
    write('info', message, meta, category),
  warn: (message: string, meta?: unknown, category: LogCategory = 'system'): LogEntry =>
    write('warn', message, meta, category),
  error: (message: string, meta?: unknown, category: LogCategory = 'error'): LogEntry =>
    write('error', message, meta, category),
  security: (message: string, meta?: unknown): LogEntry =>
    write('security', message, meta, 'sec'),
  ui: (message: string, meta?: unknown): LogEntry =>
    write('info', message, meta, 'ui'),
  nav: (message: string, meta?: unknown): LogEntry =>
    write('info', message, meta, 'nav'),
  ipc: (message: string, meta?: unknown): LogEntry =>
    write('info', message, meta, 'ipc'),
  sync: (message: string, meta?: unknown): LogEntry =>
    write('info', message, meta, 'sync'),
  action: (
    category: LogCategory,
    level: LogLevel,
    message: string,
    meta?: unknown
  ): LogEntry => write(level, message, meta, category),

  getRecent: (filter?: LogFilter): LogEntry[] => {
    sweepExpiredLogs()
    let list = [...logBuffer]

    if (filter?.level && filter.level !== 'all') {
      list = list.filter((e) => e.level === filter.level)
    }
    if (filter?.category && filter.category !== 'all') {
      list = list.filter((e) => e.category === filter.category)
    }
    if (filter?.query && filter.query.trim()) {
      const q = filter.query.toLowerCase().trim()
      list = list.filter(
        (e) =>
          e.message.toLowerCase().includes(q) ||
          e.category.toLowerCase().includes(q) ||
          (e.meta ? JSON.stringify(e.meta).toLowerCase().includes(q) : false)
      )
    }

    return list
  },

  setRetention: (minutes: number): void => {
    if (minutes <= 0) {
      retentionMs = 0 // unlimited / until closed
    } else {
      retentionMs = minutes * 60 * 1000
    }
    sweepExpiredLogs()
  },

  getRetentionMinutes: (): number => {
    return retentionMs <= 0 ? 0 : Math.round(retentionMs / 60000)
  },

  clear: (): void => {
    logBuffer = []
  },

  export: (): { ok: boolean; count: number; content: string } => {
    sweepExpiredLogs()
    const content = logBuffer.map((e) => JSON.stringify(e)).join('\n')
    return {
      ok: true,
      count: logBuffer.length,
      content
    }
  },

  subscribe: (listener: (entry: LogEntry) => void): (() => void) => {
    subscribers.add(listener)
    return () => {
      subscribers.delete(listener)
    }
  }
}
