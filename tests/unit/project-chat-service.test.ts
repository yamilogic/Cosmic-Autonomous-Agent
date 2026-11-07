import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NimHttpError,
  type NimChatMessage,
  type NimStreamOptions
} from '../../src/main/dashboard/ai-provider'
import type { ResolvedAiSettings } from '../../src/main/dashboard/ai-settings'
import type { ResolvedProjectSettings } from '../../src/main/dashboard/config-service'
import type { ChatMessageCandidate } from '../../src/main/dashboard/chat-retrieval'
import { PROJECT_CHAT_NO_ANSWER } from '../../src/main/dashboard/chat-prompts'
import {
  ProjectChatService,
  mapChatError,
  type ChatProvider
} from '../../src/main/dashboard/project-chat-service'
import type {
  DashboardProject,
  DashboardProjectChatDoneEvent,
  DashboardProjectChatErrorEvent
} from '../../src/shared/dashboard-contract'

const dirs: string[] = []

function project(): DashboardProject {
  return {
    id: 'p1',
    name: 'Acme',
    clientName: 'Acme',
    profileId: 'pf1',
    teamId: 'T1',
    appId: 'slack',
    tokenSource: 'oauth',
    monitors: [{ channelId: 'C1', channelName: 'client-dev' }],
    createdAt: '2026-01-01T00:00:00.000Z'
  }
}

function ai(overrides: Partial<ResolvedAiSettings> = {}): ResolvedAiSettings {
  return {
    provider: 'nvidia-nim',
    model: 'test-model',
    chatModel: 'test-model',
    embeddingModel: 'test-embed',
    apiKey: 'nvapi-supersecret-9999',
    modelSource: 'global',
    chatModelSource: 'global',
    embeddingModelSource: 'global',
    keySource: 'global',
    ...overrides
  }
}

function settings(overrides: Partial<ResolvedAiSettings> = {}): ResolvedProjectSettings {
  return {
    client: {
      token: 'xoxb-client',
      workspaceName: 'Acme',
      teamId: 'T1',
      channels: [{ channelId: 'C1', channelName: 'client-dev' }],
      source: 'project',
      mappedWorkspaceId: null,
      mappedWorkspaceName: null
    },
    ourSlack: {
      token: null,
      workspaceName: null,
      teamId: null,
      channels: [],
      source: 'none'
    },
    ai: ai(overrides)
  }
}

function evidence(): ChatMessageCandidate {
  return {
    source: 'client',
    channelId: 'C1',
    channelName: 'client-dev',
    ts: '1000.000001',
    user: 'U_CLIENT',
    text: 'The client asked us to start on Monday.',
    atMs: 1_000_000
  }
}

function providerFromChunks(chunks: string[]): ChatProvider {
  return {
    async *streamChat() {
      for (const chunk of chunks) yield chunk
    }
  }
}

function providerFromError(err: Error): ChatProvider {
  return {
    streamChat() {
      throw err
    }
  }
}

interface SinkLog {
  chunks: string[]
  done: DashboardProjectChatDoneEvent[]
  errors: DashboardProjectChatErrorEvent[]
  finished: Promise<void>
}

function makeSink(): { log: SinkLog; sink: Parameters<ProjectChatService['start']>[1] } {
  let release!: () => void
  const finished = new Promise<void>((resolve) => {
    release = resolve
  })
  const log: SinkLog = { chunks: [], done: [], errors: [], finished }
  return {
    log,
    sink: {
      chunk: (event) => log.chunks.push(event.chunk),
      done: (event) => {
        log.done.push(event)
        release()
      },
      error: (event) => {
        log.errors.push(event)
        release()
      }
    }
  }
}

const QUESTION = 'What did the client ask?'

function buildService(options: {
  rootDir: string
  resolved?: ResolvedProjectSettings
  provider?: ChatProvider
  providerFactory?: (input: { apiKey: string; model: string }) => ChatProvider
  retrieve?: (
    projectId: string,
    query: string
  ) => Promise<{
    recent: ChatMessageCandidate[]
    matches: ChatMessageCandidate[]
  }>
  captured?: NimChatMessage[][]
}): ProjectChatService {
  return new ProjectChatService({
    rootDir: options.rootDir,
    monitorStore: { listProjects: async () => [project()] },
    configService: { resolveSettings: async () => options.resolved ?? settings() },
    insightEngine: { existingInsight: async () => null },
    retriever: {
      retrieve:
        options.retrieve ??
        (async () => ({ recent: [evidence()], matches: [] as ChatMessageCandidate[] }))
    },
    providerFactory:
      options.providerFactory ??
      (() => options.provider ?? providerFromChunks(['The client asked to start on Monday.']))
  })
}

describe('ProjectChatService', () => {
  let rootDir: string

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'project-chat-'))
    dirs.push(rootDir)
  })

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })))
  })

  it('streams visible text, maps short ids to host refs and saves both turns', async () => {
    const { log, sink } = makeSink()
    let capturedMessages: NimChatMessage[] = []
    const service = buildService({
      rootDir,
      providerFactory: () => ({
        async *streamChat(messages) {
          capturedMessages = messages
          yield 'The client asked '
          yield 'to start on Monday.\nSOURCES: ["m1"]'
        }
      })
    })

    const started = await service.start({ projectId: 'p1', message: QUESTION }, sink)
    expect(started.ok).toBe(true)
    await log.finished

    expect(log.errors).toEqual([])
    expect(log.done).toHaveLength(1)
    const done = log.done[0]
    expect(done).toMatchObject({
      projectId: 'p1',
      content: 'The client asked to start on Monday.',
      stopped: false
    })
    if (started.ok) expect(done.runId).toBe(started.runId)
    expect(done.sources).toEqual([
      {
        source: 'client',
        channelId: 'C1',
        channelName: 'client-dev',
        ts: '1000.000001'
      }
    ])
    expect(log.chunks.join('')).toBe('The client asked to start on Monday.')
    expect(log.chunks.join('')).not.toContain('SOURCES')
    expect(log.chunks.join('')).not.toContain('m1')

    expect(capturedMessages.at(-1)).toEqual({ role: 'user', content: QUESTION })
    const history = await service.loadHistory('p1')
    expect(history.map((message) => message.role)).toEqual(['user', 'assistant'])
    expect(history[0]).toMatchObject({ role: 'user', content: QUESTION })
    expect(history[1].sources).toEqual(done.sources)
  })

  it('returns no sources for the exact no-answer fallback', async () => {
    const { log, sink } = makeSink()
    const service = buildService({
      rootDir,
      provider: providerFromChunks([`${PROJECT_CHAT_NO_ANSWER}\nSOURCES: ["m1"]`])
    })

    await service.start({ projectId: 'p1', message: QUESTION }, sink)
    await log.finished

    expect(log.done[0].content).toBe(PROJECT_CHAT_NO_ANSWER)
    expect(log.done[0].sources).toEqual([])
    const history = await service.loadHistory('p1')
    expect(history.at(-1)?.sources).toEqual([])
  })

  it('drops source ids the host did not put in the context', async () => {
    const { log, sink } = makeSink()
    const service = buildService({
      rootDir,
      provider: providerFromChunks(['Answer from memory.\nSOURCES: ["m1", "m9", "m1"]'])
    })

    await service.start({ projectId: 'p1', message: QUESTION }, sink)
    await log.finished

    expect(log.done[0].sources).toHaveLength(1)
    expect(log.done[0].sources[0].ts).toBe('1000.000001')
  })

  it('saves a stopped partial answer without sources', async () => {
    const { log, sink } = makeSink()
    let cancelRun: () => void = () => {}
    const provider: ChatProvider = {
      async *streamChat() {
        yield 'Partial answer that keeps going long enough to stream.'
        cancelRun()
        const err = new Error('The operation was aborted')
        err.name = 'AbortError'
        throw err
      }
    }
    const service = buildService({ rootDir, provider })
    cancelRun = () => service.cancel('p1')

    await service.start({ projectId: 'p1', message: QUESTION }, sink)
    await log.finished

    const done = log.done[0]
    expect(done.stopped).toBe(true)
    expect(done.sources).toEqual([])
    expect(done.content).toBe('Partial answer that keeps going long enough to stream.')
    const history = await service.loadHistory('p1')
    expect(history.at(-1)).toMatchObject({
      role: 'assistant',
      stopped: true,
      content: done.content
    })
    expect(history.at(-1)?.sources).toBeUndefined()
  })

  it.each([
    [401, 'AUTH_INVALID', false],
    [403, 'AUTH_INVALID', false],
    [429, 'RATE_LIMITED', true],
    [500, 'NETWORK', true],
    [503, 'NETWORK', true]
  ])('maps HTTP %i to %s and keeps only the user turn', async (status, code, retryable) => {
    const { log, sink } = makeSink()
    const service = buildService({
      rootDir,
      provider: providerFromError(new NimHttpError(status, `nim http ${status}: failed`))
    })

    await service.start({ projectId: 'p1', message: QUESTION }, sink)
    await log.finished

    expect(log.done).toEqual([])
    expect(log.errors).toHaveLength(1)
    expect(log.errors[0]).toMatchObject({ code, retryable })
    const history = await service.loadHistory('p1')
    expect(history.map((message) => message.role)).toEqual(['user'])
  })

  it('maps connection failures to a retryable NETWORK error', async () => {
    const { log, sink } = makeSink()
    const service = buildService({
      rootDir,
      provider: providerFromError(new TypeError('fetch failed'))
    })

    await service.start({ projectId: 'p1', message: QUESTION }, sink)
    await log.finished

    expect(log.errors[0]).toMatchObject({ code: 'NETWORK', retryable: true })
    expect(log.errors[0].error).toContain('Could not reach NVIDIA')
  })

  it('treats an empty answer as an error and saves no assistant turn', async () => {
    const { log, sink } = makeSink()
    const service = buildService({ rootDir, provider: providerFromChunks(['']) })

    await service.start({ projectId: 'p1', message: QUESTION }, sink)
    await log.finished

    expect(log.errors[0]).toMatchObject({ code: 'INTERNAL', retryable: true })
    expect(log.errors[0].error).toContain('empty answer')
    const history = await service.loadHistory('p1')
    expect(history.map((message) => message.role)).toEqual(['user'])
  })

  it('refuses to start without a key and never builds a provider', async () => {
    const { log, sink } = makeSink()
    const providerFactory = vi.fn()
    const service = buildService({ rootDir, resolved: settings({ apiKey: null }), providerFactory })

    const result = await service.start({ projectId: 'p1', message: QUESTION }, sink)

    expect(result).toMatchObject({ ok: false, code: 'AI_KEY_MISSING' })
    expect(providerFactory).not.toHaveBeenCalled()
    expect(log.done).toEqual([])
    expect(log.errors).toEqual([])
  })

  it('rejects a second send while a reply is streaming', async () => {
    const { log, sink } = makeSink()
    let cancelRun: () => void = () => {}
    const provider: ChatProvider = {
      async *streamChat(_messages, opts?: NimStreamOptions) {
        yield 'working'
        await new Promise<void>((resolve) => {
          if (opts?.signal?.aborted) return resolve()
          opts?.signal?.addEventListener('abort', () => resolve(), { once: true })
        })
        cancelRun()
        const err = new Error('The operation was aborted')
        err.name = 'AbortError'
        throw err
      }
    }
    const service = buildService({ rootDir, provider })
    cancelRun = () => service.cancel('p1')

    const first = await service.start({ projectId: 'p1', message: QUESTION }, sink)
    expect(first.ok).toBe(true)
    const second = await service.start({ projectId: 'p1', message: 'Another question' }, sink)
    expect(second).toMatchObject({ ok: false, code: 'RUN_ACTIVE' })

    if (first.ok) expect(service.cancel('p1', first.runId)).toBe(true)
    await log.finished
    expect(service.isRunning('p1')).toBe(false)
  })

  it('retries without appending the user turn twice', async () => {
    await mkdir(join(rootDir, 'chat'), { recursive: true })
    await writeFile(
      join(rootDir, 'chat', 'p1.json'),
      JSON.stringify([{ role: 'user', content: QUESTION, atIso: '2026-10-01T00:00:00.000Z' }]),
      'utf8'
    )
    const { log, sink } = makeSink()
    let capturedMessages: NimChatMessage[] = []
    const service = buildService({
      rootDir,
      providerFactory: () => ({
        async *streamChat(messages) {
          capturedMessages = messages
          yield 'Retried answer.'
        }
      })
    })

    const result = await service.start({ projectId: 'p1', message: QUESTION, retry: true }, sink)
    expect(result.ok).toBe(true)
    await log.finished

    const history = await service.loadHistory('p1')
    expect(history.map((message) => message.role)).toEqual(['user', 'assistant'])
    expect(
      history.filter((message) => message.role === 'user' && message.content === QUESTION)
    ).toHaveLength(1)
    expect(
      capturedMessages.filter((message) => message.role === 'user' && message.content === QUESTION)
    ).toHaveLength(1)
  })

  it('caps stored history at 200 messages', async () => {
    await mkdir(join(rootDir, 'chat'), { recursive: true })
    const seeded = Array.from({ length: 200 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `h-${index}`,
      atIso: '2026-10-01T00:00:00.000Z'
    }))
    await writeFile(join(rootDir, 'chat', 'p1.json'), JSON.stringify(seeded), 'utf8')
    const { log, sink } = makeSink()
    const service = buildService({ rootDir, provider: providerFromChunks(['Answer.']) })

    await service.start({ projectId: 'p1', message: QUESTION }, sink)
    await log.finished

    const history = await service.loadHistory('p1')
    expect(history).toHaveLength(200)
    expect(history[0].content).toBe('h-2')
    expect(history.at(-1)?.role).toBe('assistant')
  })

  it('clears history and reports an empty thread', async () => {
    const { log, sink } = makeSink()
    const service = buildService({ rootDir, provider: providerFromChunks(['Answer.']) })

    await service.start({ projectId: 'p1', message: QUESTION }, sink)
    await log.finished
    expect(await service.loadHistory('p1')).toHaveLength(2)

    await service.clearHistory('p1')
    expect(await service.loadHistory('p1')).toEqual([])
    const raw = await readFile(join(rootDir, 'chat', 'p1.json'), 'utf8')
    expect(JSON.parse(raw)).toEqual([])
  })

  it('returns a status with exactly four renderer-safe fields', async () => {
    const service = buildService({ rootDir })

    const status = await service.status('p1')

    expect(Object.keys(status).sort()).toEqual(['hasKey', 'keySource', 'model', 'modelSource'])
    expect(status).toEqual({
      hasKey: true,
      model: 'test-model',
      modelSource: 'global',
      keySource: 'global'
    })
    const serialized = JSON.stringify(status)
    expect(serialized).not.toContain('nvapi-supersecret-9999')
    expect(serialized).not.toContain('••••')
  })

  it('rejects missing or malformed input and unknown projects', async () => {
    const { sink } = makeSink()
    const service = buildService({ rootDir })

    expect(await service.start({ projectId: '', message: QUESTION }, sink)).toMatchObject({
      ok: false,
      code: 'PROJECT_NOT_FOUND'
    })
    expect(await service.start({ projectId: '../evil', message: QUESTION }, sink)).toMatchObject({
      ok: false,
      code: 'PROJECT_NOT_FOUND'
    })
    expect(await service.start({ projectId: 'p1', message: '   ' }, sink)).toMatchObject({
      ok: false,
      code: 'INTERNAL'
    })
    await expect(service.status('missing')).rejects.toMatchObject({
      code: 'PROJECT_NOT_FOUND'
    })
  })

  it('refuses to cancel a run id that does not match', async () => {
    expect(buildService({ rootDir }).cancel('p1', 'nope')).toBe(false)
  })
})

describe('mapChatError', () => {
  it('passes through ProjectChatError and handles aborted timeouts', () => {
    const timeout = new Error('The operation was aborted')
    timeout.name = 'AbortError'
    expect(mapChatError(timeout)).toMatchObject({ code: 'NETWORK', retryable: true })
    expect(mapChatError(new Error('timeout while reading'))).toMatchObject({
      code: 'NETWORK',
      retryable: true
    })
    expect(mapChatError(new Error('boom'))).toMatchObject({ code: 'INTERNAL', retryable: true })
  })
})
