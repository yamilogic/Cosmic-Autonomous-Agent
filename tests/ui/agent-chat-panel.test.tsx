// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AgentChatPanel from '../../src/renderer/src/components/dashboard/AgentChatPanel'
import type {
  DashboardProjectChatChunkEvent,
  DashboardProjectChatDoneEvent,
  DashboardProjectChatErrorEvent,
  DashboardProjectChatHistoryResult,
  DashboardProjectChatMessage,
  DashboardProjectChatSourceRef,
  DashboardProjectChatStartResult,
  DashboardProjectChatStatus
} from '../../src/shared/dashboard-contract'

type StartResult = DashboardProjectChatStartResult

const SOURCE: DashboardProjectChatSourceRef = {
  source: 'client',
  channelId: 'C1',
  channelName: 'client-dev',
  ts: '1000.000001'
}

function status(overrides: Partial<DashboardProjectChatStatus> = {}): DashboardProjectChatStatus {
  return {
    hasKey: true,
    model: 'meta/llama-3.3-70b',
    modelSource: 'project',
    keySource: 'project',
    ...overrides
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((release) => {
    resolve = release
  })
  return { promise, resolve }
}

interface Harness {
  history: ReturnType<typeof vi.fn>
  status: ReturnType<typeof vi.fn>
  projectChat: ReturnType<typeof vi.fn>
  cancelProjectChat: ReturnType<typeof vi.fn>
  clearProjectChat: ReturnType<typeof vi.fn>
  emitChunk: (event: DashboardProjectChatChunkEvent) => void
  emitDone: (event: DashboardProjectChatDoneEvent) => void
  emitError: (event: DashboardProjectChatErrorEvent) => void
  emitConfigChanged: () => void
}

function installApi(
  options: {
    history?: DashboardProjectChatMessage[]
    status?: DashboardProjectChatStatus
    projectChat?: (payload: {
      projectId: string
      message: string
      retry?: boolean
    }) => Promise<StartResult>
  } = {}
): Harness {
  const chunkListeners = new Set<(event: DashboardProjectChatChunkEvent) => void>()
  const doneListeners = new Set<(event: DashboardProjectChatDoneEvent) => void>()
  const errorListeners = new Set<(event: DashboardProjectChatErrorEvent) => void>()
  const configListeners = new Set<() => void>()

  const history = vi.fn(async (): Promise<DashboardProjectChatHistoryResult> => ({
    messages: options.history ?? []
  }))
  const statusMock = vi.fn(async () => options.status ?? status())
  const projectChat = vi.fn(
    options.projectChat ?? (async () => ({ ok: true as const, runId: 'run-1' }))
  )
  const cancelProjectChat = vi.fn(async () => ({ ok: true }))
  const clearProjectChat = vi.fn(async () => ({ ok: true }))

  const dashboard = {
    getProjectChatHistory: history,
    getProjectChatStatus: statusMock,
    projectChat,
    cancelProjectChat,
    clearProjectChat,
    onProjectChatChunk: (callback: (event: DashboardProjectChatChunkEvent) => void) => {
      chunkListeners.add(callback)
      return () => {
        chunkListeners.delete(callback)
      }
    },
    onProjectChatDone: (callback: (event: DashboardProjectChatDoneEvent) => void) => {
      doneListeners.add(callback)
      return () => {
        doneListeners.delete(callback)
      }
    },
    onProjectChatError: (callback: (event: DashboardProjectChatErrorEvent) => void) => {
      errorListeners.add(callback)
      return () => {
        errorListeners.delete(callback)
      }
    },
    onConfigChanged: (callback: () => void) => {
      configListeners.add(callback)
      return () => {
        configListeners.delete(callback)
      }
    }
  }

  window.api = { dashboard } as unknown as Window['api']

  return {
    history,
    status: statusMock,
    projectChat,
    cancelProjectChat,
    clearProjectChat,
    emitChunk: (event) => chunkListeners.forEach((callback) => callback(event)),
    emitDone: (event) => doneListeners.forEach((callback) => callback(event)),
    emitError: (event) => errorListeners.forEach((callback) => callback(event)),
    emitConfigChanged: () => configListeners.forEach((callback) => callback())
  }
}

function renderPanel(
  options: {
    initialQuestion?: string | null
    onConsumeInitial?: () => void
    onOpenSettings?: () => void
    onOpenSource?: (ref: DashboardProjectChatSourceRef) => void
    mode?: 'project' | 'agentwork' | 'schedules'
  } = {}
): void {
  render(
    <AgentChatPanel
      projectName="Acme"
      projectId="p1"
      mode={options.mode ?? 'project'}
      initialQuestion={options.initialQuestion}
      onConsumeInitial={options.onConsumeInitial}
      onOpenSettings={options.onOpenSettings}
      onOpenSource={options.onOpenSource}
    />
  )
}

async function waitForEmptyState(): Promise<void> {
  await screen.findByText('Ask about Acme')
}

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
})

describe('AgentChatPanel', () => {
  it('shows the effective model and a project source badge, and opens AI settings', async () => {
    installApi()
    const onOpenSettings = vi.fn()
    renderPanel({ onOpenSettings })

    const chip = await screen.findByTestId('chat-model-chip')
    expect(chip.textContent).toContain('meta/llama-3.3-70b')
    expect(chip.textContent).toContain('Custom')
    expect(chip.getAttribute('data-model-source')).toBe('project')
    expect(chip.getAttribute('title')).toContain('Key: project')

    fireEvent.click(chip)

    expect(onOpenSettings).toHaveBeenCalledTimes(1)
    expect(window.location.hash).toBe('#project-ai-settings')
  })

  it.each([
    ['global', 'Global'],
    ['default', 'Default']
  ] as const)('labels a %s model source', async (modelSource, label) => {
    installApi({ status: status({ modelSource, keySource: modelSource }) })
    renderPanel()

    const chip = await screen.findByTestId('chat-model-chip')
    expect(chip.textContent).toContain(label)
    expect(chip.getAttribute('data-model-source')).toBe(modelSource)
  })

  it('pauses the composer and offers settings when no key is configured', async () => {
    installApi({ status: status({ hasKey: false, modelSource: 'default', keySource: 'none' }) })
    const onOpenSettings = vi.fn()
    renderPanel({ onOpenSettings })

    expect(
      await screen.findByText(/No AI key is set for this project\. Answers are paused\./)
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'No AI key' })).toBeTruthy()
    const composer = screen.getByLabelText('Ask about this project') as HTMLTextAreaElement
    expect(composer.disabled).toBe(true)
    expect(composer.placeholder).toBe('Add an AI key to start chatting')

    fireEvent.click(screen.getByRole('button', { name: 'Open AI settings' }))
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
    expect(window.location.hash).toBe('#project-ai-settings')
  })

  it('renders stored messages with markdown and opens a cited source', async () => {
    installApi({
      history: [
        {
          role: 'assistant',
          content: 'Kickoff is **Monday**.',
          atIso: '2026-10-25T10:00:00.000Z',
          sources: [SOURCE]
        }
      ]
    })
    const onOpenSource = vi.fn()
    renderPanel({ onOpenSource })

    expect(await screen.findByText('Monday')).toBeTruthy()
    const source = screen.getByRole('button', { name: '#client-dev' })
    expect(source.getAttribute('title')).toBe('Client Slack · 1000.000001')

    fireEvent.click(source)
    expect(onOpenSource).toHaveBeenCalledWith(SOURCE)
  })

  it('streams a reply, then renders the final answer and its sources', async () => {
    const start = deferred<StartResult>()
    const harness = installApi({ projectChat: () => start.promise })
    renderPanel()
    await waitForEmptyState()

    const composer = screen.getByLabelText('Ask about this project')
    fireEvent.change(composer, { target: { value: 'What changed?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(harness.projectChat).toHaveBeenCalledWith({
      projectId: 'p1',
      message: 'What changed?'
    })
    expect(screen.getByText('What changed?')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy()

    await act(async () => {
      start.resolve({ ok: true, runId: 'run-1' })
    })
    await act(async () => {
      harness.emitChunk({ projectId: 'p1', runId: 'run-1', chunk: 'Kickoff is ' })
    })
    expect(screen.getByText('Kickoff is')).toBeTruthy()

    await act(async () => {
      harness.emitDone({
        projectId: 'p1',
        runId: 'run-1',
        content: 'Kickoff is **Monday**.',
        sources: [SOURCE],
        stopped: false
      })
    })

    expect(await screen.findByText('Monday')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
    expect(screen.getByRole('button', { name: '#client-dev' })).toBeTruthy()
    expect((composer as HTMLTextAreaElement).value).toBe('')
  })

  it('ignores events tagged for another project or run', async () => {
    const start = deferred<StartResult>()
    const harness = installApi({ projectChat: () => start.promise })
    renderPanel()
    await waitForEmptyState()
    fireEvent.change(screen.getByLabelText('Ask about this project'), {
      target: { value: 'What changed?' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await act(async () => {
      start.resolve({ ok: true, runId: 'run-1' })
    })

    await act(async () => {
      harness.emitChunk({ projectId: 'other', runId: 'run-1', chunk: 'foreign' })
      harness.emitDone({
        projectId: 'p1',
        runId: 'run-2',
        content: 'stale',
        sources: [],
        stopped: false
      })
      harness.emitChunk({ projectId: 'p1', runId: 'run-1', chunk: 'mine' })
    })

    expect(screen.getByText('mine')).toBeTruthy()
    expect(screen.queryByText('foreign')).toBeNull()
    expect(screen.queryByText('stale')).toBeNull()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy()
  })

  it('stops the active run with its run id', async () => {
    const start = deferred<StartResult>()
    const harness = installApi({ projectChat: () => start.promise })
    renderPanel()
    await waitForEmptyState()
    fireEvent.change(screen.getByLabelText('Ask about this project'), {
      target: { value: 'What changed?' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await act(async () => {
      start.resolve({ ok: true, runId: 'run-1' })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))

    await waitFor(() =>
      expect(harness.cancelProjectChat).toHaveBeenCalledWith({
        projectId: 'p1',
        runId: 'run-1'
      })
    )
    expect(screen.getByRole('button', { name: 'Stopping…' })).toBeTruthy()
  })

  it('keeps the user turn after a mid-stream error and retries without duplicating it', async () => {
    const first = deferred<StartResult>()
    let calls = 0
    const projectChat = vi.fn((): Promise<StartResult> => {
      calls += 1
      return calls === 1 ? first.promise : Promise.resolve({ ok: true as const, runId: 'run-2' })
    })
    const harness = installApi({ projectChat })
    renderPanel()
    await waitForEmptyState()
    fireEvent.change(screen.getByLabelText('Ask about this project'), {
      target: { value: 'What changed?' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await act(async () => {
      first.resolve({ ok: true, runId: 'run-1' })
    })

    await act(async () => {
      harness.emitError({
        projectId: 'p1',
        runId: 'run-1',
        code: 'NETWORK',
        error: 'Could not reach NVIDIA. Check your connection and retry.',
        retryable: true
      })
    })

    expect(screen.getByRole('alert').textContent).toContain('Could not reach NVIDIA')
    expect(screen.getByText('What changed?')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(projectChat).toHaveBeenCalledTimes(2))
    expect(projectChat).toHaveBeenLastCalledWith({
      projectId: 'p1',
      message: 'What changed?',
      retry: true
    })
    expect(screen.getAllByText('What changed?')).toHaveLength(1)
  })

  it('surfaces a rejected start and removes the optimistic user turn', async () => {
    const harness = installApi({
      projectChat: async () => ({
        ok: false,
        code: 'AI_KEY_MISSING',
        error: 'No AI key is set for this project.'
      })
    })
    renderPanel()
    await waitForEmptyState()
    fireEvent.change(screen.getByLabelText('Ask about this project'), {
      target: { value: 'What changed?' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('No AI key is set for this project.')
    )
    expect(screen.queryByText('What changed?')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    await waitFor(() => expect(harness.status).toHaveBeenCalledTimes(2))
  })

  it('clears the conversation after confirmation', async () => {
    const harness = installApi({
      history: [
        { role: 'user', content: 'Old question', atIso: '2026-10-24T10:00:00.000Z' },
        {
          role: 'assistant',
          content: 'Old answer',
          atIso: '2026-10-24T10:00:05.000Z',
          sources: []
        }
      ]
    })
    renderPanel()

    expect(await screen.findByText('Old question')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear chat' }))
    expect(screen.getByRole('alert').textContent).toContain('Clear chat?')

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    await waitFor(() => expect(harness.clearProjectChat).toHaveBeenCalledWith('p1'))
    await waitFor(() => expect(screen.queryByText('Old question')).toBeNull())
  })

  it('sends an initial question once the key state is known', async () => {
    const harness = installApi()
    const onConsumeInitial = vi.fn()
    renderPanel({ initialQuestion: 'What is blocked?', onConsumeInitial })

    expect(onConsumeInitial).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(harness.projectChat).toHaveBeenCalledWith({
        projectId: 'p1',
        message: 'What is blocked?'
      })
    )
  })

  it('keeps an initial question in the composer when no key is set', async () => {
    const harness = installApi({
      status: status({ hasKey: false, modelSource: 'default', keySource: 'none' })
    })
    renderPanel({ initialQuestion: 'What is blocked?' })

    const composer = screen.getByLabelText('Ask about this project') as HTMLTextAreaElement
    await waitFor(() =>
      expect(
        screen.getByText('No AI key is set for this project. Answers are paused.')
      ).toBeTruthy()
    )
    expect(composer.value).toBe('What is blocked?')
    expect(harness.projectChat).not.toHaveBeenCalled()
  })

  it('shows the AgentWork empty state without a chat composer', () => {
    installApi()
    renderPanel({ mode: 'agentwork' })

    expect(screen.getByText('AgentWork is not connected yet')).toBeTruthy()
    expect(screen.queryByLabelText('Ask about this project')).toBeNull()
  })
})
