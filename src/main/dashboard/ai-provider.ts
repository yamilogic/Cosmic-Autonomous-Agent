/** NVIDIA NIM provider (v2.2) — OpenAI-compatible chat for dashboard insights.
 * Universal: one key + model pair in .env, used everywhere; falls back
 * automatically from primary to fallback model. No raw secrets ever logged.
 *
 * Reasoning models (nemotron-3.x) spend the whole token budget on
 * "reasoning_content" and then return an empty answer, so the request can
 * disable thinking explicitly (`chat_template_kwargs.enable_thinking`).
 */

const DEFAULT_BASE_URL = 'https://integrate.api.nvidia.com/v1'

export interface NimChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface NimChatOptions {
  maxTokens?: number
  temperature?: number
  timeoutMs?: number
}

export interface NimProviderConfig {
  apiKey: string
  modelPrimary: string
  modelFallback?: string
  baseUrl?: string
  timeoutMs?: number
  /** Disable the model's reasoning trace (fast + always answers). */
  enableThinking?: boolean
  /** Default completion budget per call. */
  maxTokens?: number
}

export interface NimChatResult {
  content: string
  modelUsed: string
  tokens: number
}

export interface NimStreamOptions extends NimChatOptions {
  signal?: AbortSignal
}

/** HTTP failures keep the old `nim http <status>` message and add the status. */
export class NimHttpError extends Error {
  readonly status: number
  readonly retryAfterMs: number | undefined

  constructor(status: number, message: string, retryAfterMs?: number) {
    super(message)
    this.name = 'NimHttpError'
    this.status = status
    this.retryAfterMs = retryAfterMs
  }
}

function abortError(): Error {
  const err = new Error('The operation was aborted')
  err.name = 'AbortError'
  return err
}

function isAbort(err: unknown, signal?: AbortSignal): boolean {
  void err
  // Only a caller-initiated abort suppresses the fallback; the internal
  // timeout still tries the secondary model.
  return signal?.aborted === true
}

function retryAfterMsOf(res: Response): number | undefined {
  const raw = res.headers.get('retry-after')
  if (!raw) return undefined
  const seconds = Number(raw)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined
}

/**
 * Read an OpenAI-compatible SSE body. Robust to arbitrary chunk boundaries,
 * CRLF, comments, blank lines, malformed JSON and a missing trailing newline.
 * Yields only non-empty `choices[0].delta.content` strings.
 */
export async function* readSseContent(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): AsyncGenerator<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const consumeLine = function* (line: string): Generator<string> {
    const clean = line.endsWith('\r') ? line.slice(0, -1) : line
    if (!clean.startsWith('data:')) return
    const data = clean.slice(5).trimStart()
    if (!data || data === '[DONE]') return
    let parsed: unknown
    try {
      parsed = JSON.parse(data)
    } catch {
      return
    }
    const choices = (parsed as { choices?: Array<{ delta?: { content?: unknown } }> })?.choices
    const piece = choices?.[0]?.delta?.content
    if (typeof piece === 'string' && piece.length > 0) yield piece
  }

  try {
    for (;;) {
      if (signal?.aborted) throw abortError()
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let index = buffer.indexOf('\n')
      while (index >= 0) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 1)
        yield* consumeLine(line)
        index = buffer.indexOf('\n')
      }
    }
    buffer += decoder.decode()
    if (buffer.length > 0) yield* consumeLine(buffer)
  } finally {
    reader.releaseLock()
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export class NimProvider {
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly defaultTimeoutMs: number
  private readonly defaultMaxTokens: number
  private readonly enableThinking: boolean
  readonly modelPrimary: string
  readonly modelFallback: string | undefined

  constructor(config: NimProviderConfig) {
    if (!config.apiKey) throw new Error('NIM api key missing')
    this.apiKey = config.apiKey
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '')
    this.modelPrimary = config.modelPrimary
    this.modelFallback = config.modelFallback || undefined
    this.defaultTimeoutMs = config.timeoutMs ?? 90_000
    this.defaultMaxTokens = config.maxTokens ?? 2000
    this.enableThinking = config.enableThinking ?? false
  }

  private async chatOnce(
    model: string,
    messages: NimChatMessage[],
    opts: NimChatOptions
  ): Promise<NimChatResult> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? this.defaultTimeoutMs)
    try {
      const payload: Record<string, unknown> = {
        model,
        messages,
        max_tokens: opts.maxTokens ?? this.defaultMaxTokens,
        temperature: opts.temperature ?? 0.2
      }
      if (!this.enableThinking) {
        payload.chat_template_kwargs = { enable_thinking: false }
      }
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      })
      if (!res.ok) {
        throw new NimHttpError(
          res.status,
          `nim http ${res.status}`,
          res.status === 429 ? retryAfterMsOf(res) : undefined
        )
      }
      const body = (await res.json()) as {
        model?: string
        choices?: Array<{ message?: { content?: string }; finish_reason?: string }>
        usage?: { total_tokens?: number }
      }
      const content = body.choices?.[0]?.message?.content ?? ''
      if (!content.trim()) throw new Error('nim empty content')
      return {
        content,
        modelUsed: body.model ?? model,
        tokens: body.usage?.total_tokens ?? 0
      }
    } finally {
      clearTimeout(timer)
    }
  }

  /** Try primary, then fallback — network/timeout/HTTP errors only. */
  async chat(messages: NimChatMessage[], opts: NimChatOptions = {}): Promise<NimChatResult> {
    let primaryError: unknown
    try {
      return await this.chatOnce(this.modelPrimary, messages, opts)
    } catch (err) {
      primaryError = err
      if (!this.modelFallback) throw err
    }
    try {
      return await this.chatOnce(this.modelFallback, messages, opts)
    } catch (err) {
      throw new Error(
        `nim primary failed (${errorMessage(primaryError)}); fallback failed (${errorMessage(err)})`
      )
    }
  }

  /** Live model catalog (also used by tests via injected base). */
  async listModels(): Promise<string[]> {
    const res = await fetch(`${this.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${this.apiKey}` }
    })
    if (!res.ok) throw new Error(`nim models http ${res.status}`)
    const body = (await res.json()) as { data?: Array<{ id?: string }> }
    return (body.data ?? []).map((m) => m.id ?? '').filter(Boolean)
  }

  private async *streamOnce(
    model: string,
    messages: NimChatMessage[],
    opts: NimStreamOptions
  ): AsyncGenerator<string> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? this.defaultTimeoutMs)
    const onAbort = (): void => controller.abort()
    if (opts.signal) {
      if (opts.signal.aborted) {
        clearTimeout(timer)
        throw abortError()
      }
      opts.signal.addEventListener('abort', onAbort, { once: true })
    }
    try {
      const payload: Record<string, unknown> = {
        model,
        messages,
        max_tokens: opts.maxTokens ?? this.defaultMaxTokens,
        temperature: opts.temperature ?? 0.2,
        stream: true
      }
      if (!this.enableThinking) {
        payload.chat_template_kwargs = { enable_thinking: false }
      }
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream'
        },
        body: JSON.stringify(payload)
      })
      if (!res.ok) {
        throw new NimHttpError(
          res.status,
          `nim http ${res.status}`,
          res.status === 429 ? retryAfterMsOf(res) : undefined
        )
      }
      if (!res.body) throw new Error('nim stream had no body')
      yield* readSseContent(res.body, controller.signal)
    } catch (err) {
      if (isAbort(err, opts.signal)) throw abortError()
      throw err
    } finally {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
    }
  }

  /**
   * Stream a chat completion. Falls back to the secondary model only when the
   * primary fails before emitting any text, so output is never duplicated.
   */
  async *streamChat(
    messages: NimChatMessage[],
    opts: NimStreamOptions = {}
  ): AsyncGenerator<string> {
    let emitted = false
    let primaryError: unknown
    try {
      for await (const piece of this.streamOnce(this.modelPrimary, messages, opts)) {
        emitted = true
        yield piece
      }
      return
    } catch (err) {
      primaryError = err
      if (isAbort(err, opts.signal) || emitted || !this.modelFallback) throw err
    }
    try {
      yield* this.streamOnce(this.modelFallback, messages, opts)
    } catch (err) {
      throw new Error(
        `nim primary failed (${errorMessage(primaryError)}); fallback failed (${errorMessage(err)})`
      )
    }
  }

  /**
   * Chat that must answer with JSON. The reply is validated and, when the
   * model wraps it in prose, retried once with a stricter instruction.
   */
  async chatJson(
    messages: NimChatMessage[],
    opts: NimChatOptions = {}
  ): Promise<{ data: Record<string, unknown>; content: string; modelUsed: string }> {
    let lastError: Error | null = null
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const ask: NimChatMessage[] =
        attempt === 0
          ? messages
          : [
              ...messages,
              {
                role: 'user',
                content: 'Reply with ONLY the JSON object — no prose, no markdown fences.'
              }
            ]
      const res = await this.chat(ask, opts)
      const data = extractJsonObject(res.content)
      if (data) {
        return { data, content: res.content, modelUsed: res.modelUsed }
      }
      lastError = new Error('nim reply was not valid JSON')
    }
    throw lastError ?? new Error('nim reply was not valid JSON')
  }
}

/** Extract the first JSON object from a model reply (tolerates prose/code fences). */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidates = [fenced?.[1], text]
  for (const candidate of candidates) {
    if (!candidate) continue
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start < 0 || end <= start) continue
    try {
      const parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      // try next candidate
    }
  }
  return null
}
