/**
 * resolveSettings(projectId) — the single place that decides which API key and
 * models the AI features use.
 *
 * Order (per field): project override (unless "use global") → global config →
 * built-in default model. The raw key never leaves the main process; public
 * views carry a mask only.
 */

import { NimProvider } from './ai-provider'
import { AiSettingsStore, maskKey } from './ai-settings-store'
import type {
  AiProviderId,
  AiSettingsSource,
  DashboardAiModelsResult,
  DashboardAiSettingsSavePayload,
  DashboardAiSettingsView
} from '../../shared/dashboard-contract'

export const DEFAULT_EMBEDDING_MODEL = 'nvidia/llama-3.2-nv-embedqa-1b-v2'

export interface AiDefaults {
  chatModel: string
  embeddingModel?: string
  fallbackModel?: string
}

export interface ResolvedAiSettings {
  provider: AiProviderId
  /** Chat model. Kept as `model` for existing insight callers. */
  model: string
  chatModel: string
  embeddingModel: string
  modelFallback?: string
  /** Plain key — main process only. Never include this in a public view. */
  apiKey: string | null
  modelSource: AiSettingsSource
  chatModelSource: AiSettingsSource
  embeddingModelSource: AiSettingsSource
  keySource: AiSettingsSource
}

interface AiSettingsServiceOptions {
  store: AiSettingsStore
  defaults: AiDefaults
  timeoutMs?: number
  maxTokens?: number
  enableThinking?: boolean
}

const MAX_CACHED_PROVIDERS = 8

function sourceOf(...values: Array<string | null | undefined>): AiSettingsSource {
  if (values[0]) return 'project'
  if (values[1]) return 'global'
  if (values[2]) return 'default'
  return 'none'
}

export class AiSettingsService {
  private readonly store: AiSettingsStore
  private readonly defaults: AiDefaults
  private readonly timeoutMs: number | undefined
  private readonly maxTokens: number | undefined
  private readonly enableThinking: boolean
  private readonly providers = new Map<string, NimProvider>()

  constructor(options: AiSettingsServiceOptions) {
    this.store = options.store
    this.defaults = options.defaults
    this.timeoutMs = options.timeoutMs
    this.maxTokens = options.maxTokens
    this.enableThinking = options.enableThinking ?? false
  }

  /** Resolve the effective key/models for one project (or the dashboard). */
  async resolveSettings(projectId?: string): Promise<ResolvedAiSettings> {
    const global = await this.store.readGlobal()
    const project = projectId ? await this.store.readProject(projectId) : null
    const useGlobal = !project || project.useGlobal !== false

    const projectKey = useGlobal ? null : await this.store.readKey(project)
    const globalKey = await this.store.readKey(global)
    const apiKey = projectKey ?? globalKey
    const keySource: AiSettingsSource = projectKey ? 'project' : globalKey ? 'global' : 'none'

    const projectChat = useGlobal ? null : (project?.chatModel?.trim() ?? null)
    const globalChat = global.chatModel?.trim() || null
    const chatModel = projectChat ?? globalChat ?? this.defaults.chatModel

    const projectEmbedding = useGlobal ? null : (project?.embeddingModel?.trim() ?? null)
    const globalEmbedding = global.embeddingModel?.trim() || null
    const embeddingModel =
      projectEmbedding ??
      globalEmbedding ??
      this.defaults.embeddingModel?.trim() ??
      DEFAULT_EMBEDDING_MODEL

    return {
      provider: (!useGlobal && project?.provider) || global.provider || 'nvidia-nim',
      model: chatModel,
      chatModel,
      embeddingModel,
      modelFallback: this.defaults.fallbackModel,
      apiKey,
      modelSource: sourceOf(projectChat, globalChat, this.defaults.chatModel),
      chatModelSource: sourceOf(projectChat, globalChat, this.defaults.chatModel),
      embeddingModelSource: sourceOf(
        projectEmbedding,
        globalEmbedding,
        this.defaults.embeddingModel ?? DEFAULT_EMBEDDING_MODEL
      ),
      keySource
    }
  }

  /** A ready provider, or null when no key is configured anywhere. */
  async getProvider(projectId?: string): Promise<NimProvider | null> {
    const resolved = await this.resolveSettings(projectId)
    if (!resolved.apiKey) return null
    const cacheKey = `${resolved.apiKey}\u0000${resolved.chatModel}\u0000${resolved.modelFallback ?? ''}`
    const cached = this.providers.get(cacheKey)
    if (cached) return cached

    const provider = new NimProvider({
      apiKey: resolved.apiKey,
      modelPrimary: resolved.chatModel,
      modelFallback: resolved.modelFallback,
      timeoutMs: this.timeoutMs,
      maxTokens: this.maxTokens,
      enableThinking: this.enableThinking
    })
    if (this.providers.size >= MAX_CACHED_PROVIDERS) {
      const oldest = this.providers.keys().next().value
      if (oldest) this.providers.delete(oldest)
    }
    this.providers.set(cacheKey, provider)
    return provider
  }

  /** Renderer-safe view: masks instead of keys. */
  async publicView(projectId?: string): Promise<DashboardAiSettingsView> {
    const global = await this.store.readGlobal()
    const globalKey = await this.store.readKey(global)
    const project = projectId ? await this.store.readProject(projectId) : null
    const projectKey = project ? await this.store.readKey(project) : null
    const effective = await this.resolveSettings(projectId)

    return {
      global: {
        provider: global.provider ?? 'nvidia-nim',
        model: global.chatModel ?? null,
        embeddingModel: global.embeddingModel ?? null,
        apiKeyMask: maskKey(globalKey),
        hasKey: Boolean(globalKey),
        status: global.status ?? 'not-configured',
        lastVerifiedAt: global.lastVerifiedAt ?? null
      },
      project: projectId
        ? {
            provider: project?.provider ?? 'nvidia-nim',
            model: project?.chatModel ?? null,
            embeddingModel: project?.embeddingModel ?? null,
            apiKeyMask: maskKey(projectKey),
            hasKey: Boolean(projectKey),
            status: project?.status ?? 'not-configured',
            lastVerifiedAt: project?.lastVerifiedAt ?? null,
            useGlobal: project?.useGlobal !== false
          }
        : null,
      effective: {
        provider: effective.provider,
        model: effective.chatModel,
        chatModel: effective.chatModel,
        embeddingModel: effective.embeddingModel,
        modelSource: effective.chatModelSource,
        chatModelSource: effective.chatModelSource,
        embeddingModelSource: effective.embeddingModelSource,
        keySource: effective.keySource,
        apiKeyMask: maskKey(effective.apiKey)
      }
    }
  }

  async save(payload: DashboardAiSettingsSavePayload): Promise<DashboardAiSettingsView> {
    if (payload.provider && payload.provider !== 'nvidia-nim') {
      throw new Error('Unsupported AI provider')
    }
    if (payload.apiKey && payload.apiKey.length > 512) {
      throw new Error('API key is too long')
    }
    if (payload.model && payload.model.length > 200) {
      throw new Error('Chat model id is too long')
    }
    if (payload.embeddingModel && payload.embeddingModel.length > 200) {
      throw new Error('Embedding model id is too long')
    }

    const patch = {
      provider: payload.provider,
      model: payload.model,
      embeddingModel: payload.embeddingModel,
      apiKey: payload.apiKey,
      useGlobal: payload.useGlobal
    }
    if (payload.projectId) {
      await this.store.saveProject(payload.projectId, patch)
      return this.publicView(payload.projectId)
    }
    await this.store.saveGlobal(patch)
    // A changed key is unverified until the user runs the test.
    if (payload.apiKey !== undefined) {
      await this.store.markVerified('not-configured')
    }
    return this.publicView()
  }

  /** Verify the effective key with a small provider call. No key is stored. */
  async testConnection(
    projectId?: string
  ): Promise<{ ok: boolean; error?: string; models?: number }> {
    const resolved = await this.resolveSettings(projectId)
    if (!resolved.apiKey) {
      return { ok: false, error: 'No API key configured yet.' }
    }
    try {
      const provider = await this.getProvider(projectId)
      const models = await provider!.listModels()
      if (!projectId || resolved.keySource === 'global') {
        await this.store.markVerified('ok')
      }
      return { ok: true, models: models.length }
    } catch (err) {
      if (!projectId || resolved.keySource === 'global') {
        await this.store.markVerified('invalid')
      }
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Could not reach NVIDIA'
      }
    }
  }

  async listModels(projectId?: string): Promise<DashboardAiModelsResult> {
    const resolved = await this.resolveSettings(projectId)
    if (!resolved.apiKey) {
      return {
        models: [],
        embeddingModels: [],
        source: resolved.keySource,
        error: 'No API key configured yet.'
      }
    }
    try {
      const provider = await this.getProvider(projectId)
      const all = (await provider!.listModels()).filter(Boolean)
      const embeddingModels = [...new Set(all.filter((id) => /embed/i.test(id)))].sort()
      const models = [...new Set(all.filter((id) => !/embed/i.test(id)))].sort()
      return {
        models,
        embeddingModels,
        source: resolved.keySource
      }
    } catch (err) {
      return {
        models: [],
        embeddingModels: [],
        source: resolved.keySource,
        error: err instanceof Error ? err.message : 'Could not load the model list'
      }
    }
  }

  async clearProject(projectId: string): Promise<void> {
    await this.store.clearProject(projectId)
  }

  /** How many projects currently inherit the global AI fields. */
  async usageCounts(): Promise<{ projects: number; usingGlobalAi: number }> {
    const projectIds = await this.store.listProjectIds()
    let usingGlobalAi = 0
    for (const projectId of projectIds) {
      const project = await this.store.readProject(projectId)
      if (!project || project.useGlobal !== false) usingGlobalAi += 1
    }
    return { projects: projectIds.length, usingGlobalAi }
  }
}
