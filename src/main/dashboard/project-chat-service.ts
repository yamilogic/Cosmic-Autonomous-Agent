import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  DashboardProjectChatChunkEvent,
  DashboardProjectChatDoneEvent,
  DashboardProjectChatErrorCode,
  DashboardProjectChatErrorEvent,
  DashboardProjectChatMessage,
  DashboardProjectChatPayload,
  DashboardProjectChatSourceRef,
  DashboardProjectChatStartResult,
  DashboardProjectChatStatus
} from '../../shared/dashboard-contract'
import {
  NimHttpError,
  NimProvider,
  type NimChatMessage,
  type NimStreamOptions
} from './ai-provider'
import type { ResolvedAiSettings } from './ai-settings'
import { buildChatMessages } from './chat-context'
import { PROJECT_CHAT_NO_ANSWER } from './chat-prompts'
import type { ProjectChatRetriever } from './chat-retrieval'
import { SourceStreamFilter, resolveSourceRefs } from './chat-sources'
import type { ConfigService } from './config-service'
import type { InsightEngine } from './insight-engine'
import type { MonitorStore } from './monitor-store'
import type { DashboardChatService } from './chat-service'
import type { DashboardSyncEngine } from './sync-engine'
import type { DashboardScheduleStore } from './schedule-store'
import { detectAgentAction, executeAgentAction, formatChannelPermissionsContext } from './agent-action-engine'

const MAX_HISTORY = 200
const PROJECT_ID_RE = /^[A-Za-z0-9_-]{1,100}$/

export interface ChatProvider {
  streamChat(messages: NimChatMessage[], opts?: NimStreamOptions): AsyncGenerator<string>
}

export type ChatProviderFactory = (input: { apiKey: string; model: string }) => ChatProvider

export interface ProjectChatSink {
  chunk(event: DashboardProjectChatChunkEvent): void
  done(event: DashboardProjectChatDoneEvent): void
  error(event: DashboardProjectChatErrorEvent): void
}

export interface ProjectChatDeps {
  rootDir: string
  monitorStore: Pick<MonitorStore, 'listProjects'> & Partial<Pick<MonitorStore, 'upsertProject'>>
  configService: Pick<ConfigService, 'resolveSettings'>
  insightEngine: Pick<InsightEngine, 'existingInsight'>
  retriever: ProjectChatRetriever
  /** Tests inject a provider; production builds a NimProvider per run. */
  providerFactory?: ChatProviderFactory
  chatService?: DashboardChatService
  syncEngine?: DashboardSyncEngine
  scheduleStore?: DashboardScheduleStore
}

export class ProjectChatError extends Error {
  readonly code: DashboardProjectChatErrorCode
  readonly retryable: boolean

  constructor(code: DashboardProjectChatErrorCode, message: string, retryable = false) {
    super(message)
    this.name = 'ProjectChatError'
    this.code = code
    this.retryable = retryable
  }
}

interface ActiveRun {
  runId: string
  controller: AbortController
}

function isSourceRef(value: unknown): value is DashboardProjectChatSourceRef {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    (row.source === 'client' || row.source === 'ours') &&
    typeof row.channelId === 'string' &&
    typeof row.channelName === 'string' &&
    typeof row.ts === 'string'
  )
}

function normalizeMessage(value: unknown): DashboardProjectChatMessage | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (row.role !== 'user' && row.role !== 'assistant') return null
  if (typeof row.content !== 'string') return null
  const message: DashboardProjectChatMessage = {
    role: row.role,
    content: row.content,
    atIso: typeof row.atIso === 'string' ? row.atIso : new Date(0).toISOString()
  }
  if (Array.isArray(row.sources)) {
    message.sources = row.sources.filter(isSourceRef)
  }
  if (row.stopped === true) message.stopped = true
  return message
}

function httpStatusOf(err: unknown): number | null {
  if (err instanceof NimHttpError) return err.status
  const match = err instanceof Error ? err.message.match(/nim http (\d{3})/) : null
  return match ? Number(match[1]) : null
}

export function mapChatError(err: unknown): ProjectChatError {
  if (err instanceof ProjectChatError) return err
  const status = httpStatusOf(err)
  if (status === 401 || status === 403) {
    return new ProjectChatError(
      'AUTH_INVALID',
      'Your NVIDIA API key was rejected. Check it in Settings.',
      false
    )
  }
  if (status === 429) {
    return new ProjectChatError(
      'RATE_LIMITED',
      'NVIDIA is rate-limiting requests. Try again in a moment.',
      true
    )
  }
  if (status !== null && status >= 500) {
    return new ProjectChatError(
      'NETWORK',
      'NVIDIA is unavailable right now. Retry in a moment.',
      true
    )
  }
  const text = err instanceof Error ? err.message : String(err)
  if (err instanceof Error && err.name === 'AbortError') {
    return new ProjectChatError('NETWORK', 'The answer timed out. Retry in a moment.', true)
  }
  if (/fetch failed|ECONN|ENOTFOUND|network|timeout/i.test(text)) {
    return new ProjectChatError(
      'NETWORK',
      'Could not reach NVIDIA. Check your connection and retry.',
      true
    )
  }
  return new ProjectChatError('INTERNAL', 'Chat failed. Retry in a moment.', true)
}

export class ProjectChatService {
  private readonly rootDir: string
  private readonly monitorStore: ProjectChatDeps['monitorStore']
  private readonly configService: ProjectChatDeps['configService']
  private readonly insightEngine: ProjectChatDeps['insightEngine']
  private readonly retriever: ProjectChatRetriever
  private readonly providerFactory: ChatProviderFactory
  private readonly chatService?: DashboardChatService
  private readonly syncEngine?: DashboardSyncEngine
  private readonly scheduleStore?: DashboardScheduleStore
  private readonly runs = new Map<string, ActiveRun>()

  constructor(deps: ProjectChatDeps) {
    this.rootDir = join(deps.rootDir, 'chat')
    this.monitorStore = deps.monitorStore
    this.configService = deps.configService
    this.insightEngine = deps.insightEngine
    this.retriever = deps.retriever
    this.chatService = deps.chatService
    this.syncEngine = deps.syncEngine
    this.scheduleStore = deps.scheduleStore
    this.providerFactory =
      deps.providerFactory ??
      ((input) =>
        new NimProvider({ apiKey: input.apiKey, modelPrimary: input.model, timeoutMs: 120_000 }))
  }

  private runKey(projectId: string, channelId?: string, sourceId?: string): string {
    const cleanCh = channelId?.trim().replace(/[^a-zA-Z0-9_-]/g, '_')
    const cleanSrc = sourceId?.trim().replace(/[^a-zA-Z0-9_-]/g, '_')
    return cleanCh ? `${projectId}:ch:${cleanCh}` : cleanSrc ? `${projectId}:src:${cleanSrc}` : projectId
  }

  private filePath(projectId: string, channelId?: string, sourceId?: string): string {
    if (!PROJECT_ID_RE.test(projectId)) {
      throw new ProjectChatError('PROJECT_NOT_FOUND', 'Invalid project id.')
    }
    const cleanCh = channelId?.trim().replace(/[^a-zA-Z0-9_-]/g, '_')
    const cleanSrc = sourceId?.trim().replace(/[^a-zA-Z0-9_-]/g, '_')
    const suffix = cleanCh ? `_ch_${cleanCh}` : cleanSrc ? `_src_${cleanSrc}` : ''
    return join(this.rootDir, `${projectId}${suffix}.json`)
  }

  /** Chat files are per project: an id with no project must not touch them. */
  private async assertProjectKnown(projectId: string): Promise<void> {
    if (!PROJECT_ID_RE.test(projectId)) {
      throw new ProjectChatError('PROJECT_NOT_FOUND', 'Invalid project id.')
    }
    const project = (await this.monitorStore.listProjects()).find((p) => p.id === projectId)
    if (!project) {
      throw new ProjectChatError('PROJECT_NOT_FOUND', 'This project no longer exists.')
    }
  }

  async loadHistory(
    projectId: string,
    channelId?: string,
    sourceId?: string
  ): Promise<DashboardProjectChatMessage[]> {
    await this.assertProjectKnown(projectId)
    try {
      const raw = await readFile(this.filePath(projectId, channelId, sourceId), 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      return parsed
        .map(normalizeMessage)
        .filter((message): message is DashboardProjectChatMessage => message !== null)
        .slice(-MAX_HISTORY)
    } catch {
      return []
    }
  }

  async clearHistory(projectId: string, channelId?: string, sourceId?: string): Promise<void> {
    await this.assertProjectKnown(projectId)
    await mkdir(this.rootDir, { recursive: true })
    await writeFile(this.filePath(projectId, channelId, sourceId), '[]', 'utf8')
  }

  private async saveHistory(
    projectId: string,
    messages: DashboardProjectChatMessage[],
    channelId?: string,
    sourceId?: string
  ): Promise<void> {
    await mkdir(this.rootDir, { recursive: true })
    const target = this.filePath(projectId, channelId, sourceId)
    const tmp = `${target}.tmp`
    await writeFile(tmp, JSON.stringify(messages.slice(-MAX_HISTORY)), 'utf8')
    await rename(tmp, target)
  }

  private async appendMessage(
    projectId: string,
    message: DashboardProjectChatMessage,
    channelId?: string,
    sourceId?: string
  ): Promise<void> {
    await this.assertProjectKnown(projectId)
    const history = await this.loadHistory(projectId, channelId, sourceId)
    history.push(message)
    await this.saveHistory(projectId, history, channelId, sourceId)
  }

  isRunning(projectId: string, channelId?: string, sourceId?: string): boolean {
    const key = this.runKey(projectId, channelId, sourceId)
    return this.runs.has(key) || this.runs.has(projectId)
  }

  async status(projectId: string): Promise<DashboardProjectChatStatus> {
    const project = (await this.monitorStore.listProjects()).find((p) => p.id === projectId)
    if (!project) throw new ProjectChatError('PROJECT_NOT_FOUND', 'This project no longer exists.')
    const settings = await this.configService.resolveSettings(projectId)
    return {
      hasKey: Boolean(settings.ai.apiKey),
      model: settings.ai.chatModel,
      modelSource: settings.ai.chatModelSource,
      keySource: settings.ai.keySource
    }
  }

  async start(
    payload: DashboardProjectChatPayload,
    sink: ProjectChatSink
  ): Promise<DashboardProjectChatStartResult> {
    const projectId = typeof payload?.projectId === 'string' ? payload.projectId.trim() : ''
    const message = typeof payload?.message === 'string' ? payload.message.trim() : ''
    if (!projectId) {
      return { ok: false, code: 'PROJECT_NOT_FOUND', error: 'A project id is required.' }
    }
    if (!PROJECT_ID_RE.test(projectId)) {
      return { ok: false, code: 'PROJECT_NOT_FOUND', error: 'Invalid project id.' }
    }
    if (!message) {
      return { ok: false, code: 'INTERNAL', error: 'Type a message first.' }
    }

    const project = (await this.monitorStore.listProjects()).find((p) => p.id === projectId)
    if (!project) {
      return { ok: false, code: 'PROJECT_NOT_FOUND', error: 'This project no longer exists.' }
    }
    const channelId = typeof payload?.channelId === 'string' && payload.channelId.trim() ? payload.channelId.trim() : undefined
    const sourceId = typeof payload?.sourceId === 'string' && payload.sourceId.trim() ? payload.sourceId.trim() : undefined
    const rKey = this.runKey(projectId, channelId, sourceId)

    if (this.runs.has(rKey) || this.runs.has(projectId)) {
      return {
        ok: false,
        code: 'RUN_ACTIVE',
        error: 'A reply is already streaming. Stop it or wait for it to finish.'
      }
    }

    let settings: { ai: ResolvedAiSettings }
    try {
      settings = await this.configService.resolveSettings(projectId)
    } catch (err) {
      const mapped = mapChatError(err)
      return { ok: false, code: mapped.code, error: mapped.message }
    }
    if (!settings.ai.apiKey) {
      return {
        ok: false,
        code: 'AI_KEY_MISSING',
        error: 'No AI key is set for this project.'
      }
    }

    const runId = randomUUID()
    const controller = new AbortController()
    const apiKey = settings.ai.apiKey
    this.runs.set(rKey, { runId, controller })
    void this.execute(
      projectId,
      runId,
      message,
      payload.retry === true,
      apiKey,
      settings.ai,
      project.manualCompletion,
      controller,
      sink,
      channelId,
      sourceId
    )
    return { ok: true, runId }
  }

  private async execute(
    projectId: string,
    runId: string,
    question: string,
    retry: boolean,
    apiKey: string,
    settings: ResolvedAiSettings,
    manualCompletion: number | undefined,
    controller: AbortController,
    sink: ProjectChatSink,
    channelId?: string,
    sourceId?: string
  ): Promise<void> {
    const rKey = this.runKey(projectId, channelId, sourceId)
    try {
      const history = await this.loadHistory(projectId, channelId, sourceId)
      if (!retry) {
        await this.appendMessage(
          projectId,
          {
            role: 'user',
            content: question,
            atIso: new Date().toISOString()
          },
          channelId,
          sourceId
        )
      }

      // Check if user prompt is an autonomous agent command (e.g. Slack post, read channel, scrape, schedule)
      const project = (await this.monitorStore.listProjects()).find((p) => p.id === projectId)
      const directAction = project ? detectAgentAction(question, project, channelId) : null
      if (directAction && project) {
        const actionRes = await executeAgentAction(directAction, {
          projectId,
          project,
          chatService: this.chatService,
          syncEngine: this.syncEngine,
          scheduleStore: this.scheduleStore,
          monitorStore: this.monitorStore
        })
        if (actionRes.handled) {
          sink.chunk({ projectId, runId, chunk: actionRes.replyMarkdown })
          await this.appendMessage(
            projectId,
            {
              role: 'assistant',
              content: actionRes.replyMarkdown,
              atIso: new Date().toISOString()
            },
            channelId,
            sourceId
          )
          sink.done({ projectId, runId, content: actionRes.replyMarkdown, sources: [], stopped: false })
          return
        }
      }

      const last = history.at(-1)
      const contextHistory =
        retry && last?.role === 'user' && last.content === question ? history.slice(0, -1) : history

      const insight = await this.insightEngine.existingInsight(projectId)
      const retrieval = await this.retriever.retrieve(projectId, question)
      let channelPermissionsContext = project ? formatChannelPermissionsContext(project) : undefined

      // If scoped to a channel, inject recent scraped channel messages directly into the context!
      if (channelId && this.chatService) {
        try {
          const page = await this.chatService.loadMessages({
            projectId,
            channelId,
            source: 'client',
            limit: 15
          })
          if (page.messages && page.messages.length > 0) {
            const chName = page.messages[0].channelName || channelId
            const recentLines = page.messages
              .slice(-10)
              .map(
                (m) =>
                  `  - [${m.atIso ? new Date(m.atIso).toLocaleTimeString() : ''}] ${m.userName || m.userId}: "${m.text}"`
              )
              .join('\n')
            const activeChannelInfo = `\n\nCURRENT SCOPED VIEW: User is directly inside channel #${chName} (id: ${channelId}).\nLATEST MESSAGES IN THIS CHANNEL:\n${recentLines}`
            channelPermissionsContext = channelPermissionsContext
              ? `${channelPermissionsContext}\n${activeChannelInfo}`
              : activeChannelInfo
          }
        } catch {
          // fallback silently
        }
      }
      const built = buildChatMessages({
        insight,
        manualCompletion,
        retrieval,
        history: contextHistory,
        question,
        channelPermissionsContext
      })

      if (controller.signal.aborted) {
        sink.done({ projectId, runId, content: '', sources: [], stopped: true })
        return
      }

      const provider = this.providerFactory({
        apiKey,
        model: settings.chatModel
      })
      const filter = new SourceStreamFilter()
      let aborted = false

      try {
        for await (const chunk of provider.streamChat(built.messages, {
          signal: controller.signal,
          temperature: 0.3
        })) {
          const visible = filter.push(chunk)
          if (visible) sink.chunk({ projectId, runId, chunk: visible })
        }
      } catch (err) {
        if (controller.signal.aborted) {
          aborted = true
        } else {
          throw err
        }
      }

      const finished = filter.finish()
      if (finished.tail) sink.chunk({ projectId, runId, chunk: finished.tail })

      if (aborted) {
        const content = finished.content
        if (content.trim()) {
          await this.appendMessage(
            projectId,
            {
              role: 'assistant',
              content,
              atIso: new Date().toISOString(),
              stopped: true
            },
            channelId,
            sourceId
          )
        }
        sink.done({ projectId, runId, content, sources: [], stopped: true })
        return
      }

      const content = finished.content
      if (!content.trim()) {
        throw new ProjectChatError('INTERNAL', 'The model returned an empty answer.', true)
      }

      // Check if LLM emitted an action block that needs execution
      const modelAction = project ? detectAgentAction(content, project, channelId) : null
      if (modelAction && project) {
        const actionRes = await executeAgentAction(modelAction, {
          projectId,
          project,
          chatService: this.chatService,
          syncEngine: this.syncEngine,
          scheduleStore: this.scheduleStore,
          monitorStore: this.monitorStore
        })
        if (actionRes.handled) {
          // Cleanly replace or wrap raw action JSON block:
          // Strip the raw {"action": ...} or ```action ... ``` block so it doesn't duplicate!
          const cleanText = content
            .replace(/```action[\s\S]*?```/gi, '')
            .replace(/\{[\s\r\n]*"action"[\s\S]*?\}/gi, '')
            .replace(/<!--\s*ACTION_?CARD[\s\S]*?-->/gi, '')
            .trim()
          const combined = cleanText ? `${cleanText}\n\n${actionRes.replyMarkdown}` : actionRes.replyMarkdown
          sink.chunk({ projectId, runId, chunk: `\n\n${actionRes.replyMarkdown}` })
          await this.appendMessage(
            projectId,
            {
              role: 'assistant',
              content: combined,
              atIso: new Date().toISOString()
            },
            channelId,
            sourceId
          )
          sink.done({ projectId, runId, content: combined, sources: [], stopped: false })
          return
        }
      }

      const sources =
        content === PROJECT_CHAT_NO_ANSWER ? [] : resolveSourceRefs(finished.ids, built.refs)
      await this.appendMessage(
        projectId,
        {
          role: 'assistant',
          content,
          atIso: new Date().toISOString(),
          sources
        },
        channelId,
        sourceId
      )
      sink.done({ projectId, runId, content, sources, stopped: false })
    } catch (err) {
      const mapped = mapChatError(err)
      sink.error({
        projectId,
        runId,
        code: mapped.code,
        error: mapped.message,
        retryable: mapped.retryable
      })
    } finally {
      const current = this.runs.get(rKey)
      if (current?.runId === runId) this.runs.delete(rKey)
    }
  }

  cancel(projectId: string, runId?: string, channelId?: string, sourceId?: string): boolean {
    const rKey = this.runKey(projectId, channelId, sourceId)
    const run = this.runs.get(rKey) || this.runs.get(projectId)
    if (!run) return false
    if (runId && run.runId !== runId) return false
    run.controller.abort()
    return true
  }
}
