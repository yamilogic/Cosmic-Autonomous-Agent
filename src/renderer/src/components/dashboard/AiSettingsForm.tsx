import type React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  AiProviderId,
  AiSettingsSource,
  DashboardAiSettingsView
} from '../../../../shared/dashboard-contract'
import { AiModelCombobox } from './AiModelCombobox'

const SOURCE_LABEL: Record<AiSettingsSource, string> = {
  project: 'project override',
  global: 'global config',
  default: 'built-in default',
  none: 'not configured'
}

const KEY_SOURCE_LABEL: Record<AiSettingsSource, string> = {
  project: 'project key',
  global: 'global key',
  default: 'no key',
  none: 'no key'
}

interface AiSettingsFormProps {
  /** Omit for the dashboard-level (global) settings. */
  projectId?: string
}

export default function AiSettingsForm({ projectId }: AiSettingsFormProps): React.ReactElement {
  const [view, setView] = useState<DashboardAiSettingsView | null>(null)
  const [useGlobal, setUseGlobal] = useState(true)
  const [provider, setProvider] = useState<AiProviderId>('nvidia-nim')
  const [model, setModel] = useState('')
  const [embeddingModel, setEmbeddingModel] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [embeddingModels, setEmbeddingModels] = useState<string[]>([])
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [loadingModels, setLoadingModels] = useState(true)
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const isProject = Boolean(projectId)
  const editable = isProject ? !useGlobal : true

  const loadModels = useCallback(async (): Promise<void> => {
    try {
      const result = await window.api.dashboard.listAiModels(projectId ? { projectId } : undefined)
      setModels(result.models)
      setEmbeddingModels(result.embeddingModels)
      setModelsError(result.error ?? null)
    } catch (err) {
      setModels([])
      setEmbeddingModels([])
      setModelsError(err instanceof Error ? err.message : 'Could not load models')
    } finally {
      setLoadingModels(false)
    }
  }, [projectId])

  useEffect(() => {
    let cancelled = false
    window.api.dashboard
      .getAiSettings(projectId ? { projectId } : undefined)
      .then((next) => {
        if (cancelled) return
        setView(next)
        setUseGlobal(next.project ? next.project.useGlobal : true)
        setProvider(next.project?.provider ?? next.global.provider)
        setModel((projectId ? next.project?.model : next.global.model) ?? '')
        setEmbeddingModel(
          (projectId ? next.project?.embeddingModel : next.global.embeddingModel) ?? ''
        )
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load AI settings')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    window.api.dashboard
      .listAiModels(projectId ? { projectId } : undefined)
      .then((result) => {
        if (cancelled) return
        setModels(result.models)
        setEmbeddingModels(result.embeddingModels)
        setModelsError(result.error ?? null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setModels([])
        setEmbeddingModels([])
        setModelsError(err instanceof Error ? err.message : 'Could not load models')
      })
      .finally(() => {
        if (!cancelled) setLoadingModels(false)
      })

    return () => {
      cancelled = true
    }
  }, [projectId])

  const modelOptions = useMemo(() => {
    const all = new Set(models)
    if (view?.effective?.chatModel) all.add(view.effective.chatModel)
    const stored = isProject ? view?.project?.model : view?.global?.model
    if (stored) all.add(stored)
    return Array.from(all).sort()
  }, [models, view, isProject])

  const embeddingOptions = useMemo(() => {
    const all = new Set(embeddingModels)
    if (view?.effective?.embeddingModel) all.add(view.effective.embeddingModel)
    const stored = isProject ? view?.project?.embeddingModel : view?.global?.embeddingModel
    if (stored) all.add(stored)
    return Array.from(all).sort()
  }, [embeddingModels, view, isProject])

  const storedHasKey = isProject ? Boolean(view?.project?.hasKey) : Boolean(view?.global?.hasKey)
  const storedMask = isProject ? view?.project?.apiKeyMask : view?.global.apiKeyMask
  // A reset is only useful when a project field actually changes the effective
  // value; an override that stores nothing is already equivalent to global.
  const projectOverrideActive =
    isProject &&
    Boolean(
      view?.project &&
      !view.project.useGlobal &&
      (view.project.model || view.project.embeddingModel || view.project.hasKey)
    )

  const keyHint = ((): string => {
    if (!view || !view.effective) return ''
    if (isProject && useGlobal) {
      if (view.effective.keySource === 'none') return 'No key configured anywhere — AI stays off.'
      return `This project uses the ${KEY_SOURCE_LABEL[view.effective.keySource]} ${view.effective.apiKeyMask ?? ''}`.trim()
    }
    if (storedHasKey) return `Saved: ${storedMask}`
    if (view.effective.keySource !== 'none') {
      return `No key here — falls back to the ${KEY_SOURCE_LABEL[view.effective.keySource]}`
    }
    return 'No key saved yet'
  })()

  const save = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    setNotice(null)
    setTestResult(null)
    try {
      const trimmedKey = apiKey.trim()
      const payload = isProject
        ? useGlobal
          ? { projectId, useGlobal: true, provider }
          : {
              projectId,
              useGlobal: false,
              provider,
              model: model.trim() || null,
              embeddingModel: embeddingModel.trim() || null,
              ...(trimmedKey ? { apiKey: trimmedKey } : {})
            }
        : {
            provider,
            model: model.trim() || null,
            embeddingModel: embeddingModel.trim() || null,
            ...(trimmedKey ? { apiKey: trimmedKey } : {})
          }
      const next = await window.api.dashboard.saveAiSettings(payload)
      setView(next)
      setApiKey('')
      setNotice('Saved. Run Test connection to verify.')
      setLoadingModels(true)
      await loadModels()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save AI settings')
    } finally {
      setSaving(false)
    }
  }

  const resetToGlobal = async (): Promise<void> => {
    if (!isProject) return
    setResetting(true)
    setError(null)
    setNotice(null)
    setTestResult(null)
    try {
      const next = await window.api.dashboard.saveAiSettings({ projectId, useGlobal: true })
      setView(next)
      setUseGlobal(true)
      setModel('')
      setEmbeddingModel('')
      setProvider(next.global.provider)
      setNotice('Now using global config.')
      setLoadingModels(true)
      await loadModels()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset to global config')
    } finally {
      setResetting(false)
    }
  }

  const test = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    setError(null)
    try {
      const result = await window.api.dashboard.testAi(projectId ? { projectId } : undefined)
      if (result.ok) {
        setTestResult(`Connected. ${result.models ?? 0} models available.`)
        setView(await window.api.dashboard.getAiSettings(projectId ? { projectId } : undefined))
      } else {
        setTestResult(result.error ?? 'Connection failed.')
      }
    } catch (err) {
      setTestResult(err instanceof Error ? err.message : 'Connection failed.')
    } finally {
      setTesting(false)
    }
  }

  const clearKey = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const next = await window.api.dashboard.saveAiSettings(
        isProject ? { projectId, apiKey: null } : { apiKey: null }
      )
      setView(next)
      setNotice('Saved key cleared')
      setLoadingModels(true)
      await loadModels()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not clear the key')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      className="ai-settings"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      {isProject ? (
        <label className="ai-settings-toggle">
          <input
            type="checkbox"
            checked={useGlobal}
            onChange={(e) => {
              setUseGlobal(e.target.checked)
              setNotice(null)
            }}
          />
          <span>
            <b>Use global config</b>
            <small>Off: the fields below override only the values you fill in.</small>
          </span>
        </label>
      ) : null}

      {isProject && useGlobal && view ? (
        <div style={{ padding: '6px 0', fontSize: '13px', color: 'var(--text-muted)' }}>
          Using global key: <span className="proj-token-chip">{view.global?.apiKeyMask || '••••'}</span> · Global model: <span style={{ color: 'var(--text)' }}>{view.global?.model || 'nvidia/nemotron-3.5-super-vl-120b-a12b'}</span>
        </div>
      ) : null}

      {projectOverrideActive && view ? (
        <div className="ai-settings-override" data-testid="ai-project-override">
          <span>
            <b>Project override is active</b> — chat uses {view.effective?.chatModel}.
          </span>
          <button
            type="button"
            className="dash-subtle"
            disabled={saving || resetting}
            onClick={() => void resetToGlobal()}
          >
            {resetting ? 'Resetting…' : 'Reset to global'}
          </button>
        </div>
      ) : null}

      <label className="ai-settings-field">
        <span>Provider</span>
        <select
          value={provider}
          disabled={!editable || saving}
          onChange={(e) => setProvider(e.target.value as AiProviderId)}
        >
          <option value="nvidia-nim">NVIDIA NIM</option>
        </select>
      </label>

      <label className="ai-settings-field">
        <span>Chat model</span>
        <AiModelCombobox
          value={model}
          options={modelOptions}
          inheritLabel={isProject ? 'Inherit from global' : 'Use built-in default'}
          disabled={!editable || loading || saving}
          onChange={(newVal) => setModel(newVal)}
          onRefresh={() => {
            setLoadingModels(true)
            setModelsError(null)
            void loadModels()
          }}
          refreshing={loadingModels}
          data-testid="chat-model-combobox"
        />
        {modelsError ? <small className="ai-settings-hint is-error">{modelsError}</small> : null}
      </label>

      <label className="ai-settings-field">
        <span>Embedding model</span>
        <AiModelCombobox
          value={embeddingModel}
          options={embeddingOptions}
          inheritLabel={isProject ? 'Inherit from global' : 'Use built-in embedding default'}
          disabled={!editable || loading || saving}
          onChange={(newVal) => setEmbeddingModel(newVal)}
          data-testid="embedding-model-combobox"
        />
        <small className="ai-settings-hint" style={{ color: 'var(--warn)' }}>
          ⚠ Used when the agent indexes this project’s messages. Changing it requires a re-index.
        </small>
      </label>

      <label className="ai-settings-field">
        <span>API key</span>
        <div className="ai-settings-inline">
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            disabled={!editable || saving}
            placeholder={storedHasKey ? 'Paste a new key to replace the saved one' : 'nvapi-…'}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <button
            type="button"
            className="dash-subtle"
            disabled={!editable}
            onClick={() => setShowKey((prev) => !prev)}
          >
            {showKey ? 'Hide' : 'Show'}
          </button>
        </div>
        <small className="ai-settings-hint">{keyHint}</small>
      </label>

      <div className="ai-settings-effective" data-testid="ai-effective">
        <span className="ai-settings-label">Effective now</span>
        <b>
          {view?.effective
            ? `${view.effective.chatModel} · ${view.effective.embeddingModel}`
            : '…'}
        </b>
        <span className="ai-settings-hint">
          Chat: {SOURCE_LABEL[view?.effective?.chatModelSource ?? 'none']} · Embedding:{' '}
          {SOURCE_LABEL[view?.effective?.embeddingModelSource ?? 'none']} ·{' '}
          {KEY_SOURCE_LABEL[view?.effective?.keySource ?? 'none']}
          {view?.effective?.apiKeyMask ? ` ${view.effective.apiKeyMask}` : ''}
        </span>
        {view?.global?.lastVerifiedAt ? (
          <span className="ai-settings-hint">
            Last checked {new Date(view.global.lastVerifiedAt).toLocaleString()}
          </span>
        ) : null}
      </div>

      {testResult ? (
        <p
          className={
            testResult.startsWith('Connected') ? 'ai-settings-notice' : 'ai-settings-error'
          }
        >
          {testResult}
        </p>
      ) : null}
      {error ? <p className="ai-settings-error">{error}</p> : null}
      {notice ? <p className="ai-settings-notice">{notice}</p> : null}

      <div className="ai-settings-actions">
        <button type="submit" className="dash-primary" disabled={saving || loading}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          className="dash-subtle"
          disabled={testing || saving}
          onClick={() => void test()}
        >
          {testing ? 'Testing…' : 'Test connection'}
        </button>
        {storedHasKey ? (
          <button
            type="button"
            className="dash-subtle"
            disabled={saving}
            onClick={() => void clearKey()}
          >
            {isProject ? 'Clear project key' : 'Clear global key'}
          </button>
        ) : null}
      </div>

      <p className="ai-settings-hint">
        Keys are encrypted with the OS keychain in the main process and never sent back to this
        window — only the mask is shown.
      </p>
    </form>
  )
}
