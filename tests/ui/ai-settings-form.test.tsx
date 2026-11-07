// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import AiSettingsForm from '../../src/renderer/src/components/dashboard/AiSettingsForm'

afterEach(() => {
  cleanup()
})

beforeAll(() => {
  window.api = {
    dashboard: {
      getAiSettings: vi.fn().mockResolvedValue({
        global: {
          provider: 'nvidia-nim',
          model: 'nvidia/nemotron-3.5-super-vl-120b-a12b',
          embeddingModel: 'nvidia/llama-3.2-nv-embedqa-1b-v2',
          apiKeyMask: '••••LZt_',
          hasKey: true,
          status: 'verified',
          lastVerifiedAt: Date.now()
        },
        project: {
          provider: 'nvidia-nim',
          model: null,
          embeddingModel: null,
          apiKeyMask: null,
          hasKey: false,
          status: 'not-configured',
          lastVerifiedAt: null,
          useGlobal: true
        },
        effective: {
          provider: 'nvidia-nim',
          model: 'nvidia/nemotron-3.5-super-vl-120b-a12b',
          chatModel: 'nvidia/nemotron-3.5-super-vl-120b-a12b',
          embeddingModel: 'nvidia/llama-3.2-nv-embedqa-1b-v2',
          apiKey: null,
          chatModelSource: 'global',
          embeddingModelSource: 'global',
          keySource: 'global',
          apiKeyMask: '••••LZt_'
        }
      }),
      listAiModels: vi.fn().mockResolvedValue({
        models: [
          'nvidia/nemotron-3.5-super-vl-120b-a12b',
          'meta/llama-3.1-70b',
          'google/gemma-3-12b-it'
        ],
        embeddingModels: [
          'nvidia/llama-3.2-nv-embedqa-1b-v2',
          'snowflake/arctic-embed-l'
        ],
        source: 'global'
      }),
      testAi: vi.fn().mockResolvedValue({ ok: true, message: 'Connected' }),
      saveAiSettings: vi.fn().mockResolvedValue({})
    }
  } as unknown as typeof window.api
})

describe('AiSettingsForm with Searchable Comboboxes & Single Effective Summary', () => {
  it('renders searchable comboboxes for chat and embedding models', async () => {
    render(<AiSettingsForm projectId="proj_test_123" />)

    await waitFor(() => {
      expect(screen.getByTestId('chat-model-combobox')).toBeDefined()
      expect(screen.getByTestId('embedding-model-combobox')).toBeDefined()
    })
  })

  it('renders warning notice for embedding model change', async () => {
    render(<AiSettingsForm projectId="proj_test_123" />)

    await waitFor(() => {
      expect(
        screen.getByText(/Used when the agent indexes this project’s messages. Changing it requires a re-index./i)
      ).toBeDefined()
    })
  })

  it('renders single effective summary with models and key mask', async () => {
    render(<AiSettingsForm projectId="proj_test_123" />)

    await waitFor(() => {
      const eff = screen.getByTestId('ai-effective')
      expect(eff).toBeDefined()
      expect(screen.getByText(/Effective now/i)).toBeDefined()
      expect(screen.getByText(/Chat: global config/i)).toBeDefined()
    })
  })

  it('can open combobox and filter models by search query', async () => {
    render(<AiSettingsForm projectId="proj_test_123" />)

    await waitFor(() => {
      expect(screen.getByTestId('chat-model-combobox')).toBeDefined()
    })

    // Uncheck "Use global config" to enable editing
    const toggle = screen.getByLabelText(/Use global config/i)
    fireEvent.click(toggle)

    // Click to open combobox
    const openBtn = screen.getByTestId('chat-model-combobox').querySelector('button')
    expect(openBtn).toBeDefined()
    fireEvent.click(openBtn!)

    // Search input should appear
    const searchInput = screen.getByPlaceholderText('Search models…')
    expect(searchInput).toBeDefined()

    // Filter to google
    fireEvent.change(searchInput, { target: { value: 'google' } })
    expect(screen.getByText('google/gemma-3-12b-it')).toBeDefined()
  })
})
