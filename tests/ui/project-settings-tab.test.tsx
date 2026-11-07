// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import ProjectSettingsTab from '../../src/renderer/src/components/dashboard/ProjectSettingsTab'
import type { DashboardProject } from '../../src/shared/dashboard-contract'

afterEach(() => {
  cleanup()
})

const mockProject: DashboardProject = {
  id: 'proj_test_123',
  profileId: 'prof_test_123',
  name: 'AgentWork',
  clientName: 'Testing Workspace 1',
  teamId: 'T0123456',
  teamName: 'AgentWork Workspace',
  appId: 'slack',
  tokenSource: 'manual',
  manualTokenKey: 'DASH_TOKEN_TEST',
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  manualCompletion: 45,
  monitors: [
    { channelId: 'C01', channelName: 'general' },
    { channelId: 'C02', channelName: 'all-agentwork' }
  ],
  createdAt: '2026-01-01T00:00:00.000Z'
}

// Mock dashboard api
beforeAll(() => {
  window.api = {
    dashboard: {
      getChatTokenStatus: vi.fn().mockResolvedValue({
        connected: true,
        source: 'manual',
        teamName: 'AgentWork',
        maskedToken: '••••3f22',
        scopes: ['channels:history', 'chat:write'],
        canSend: true
      }),
      getAiSettings: vi.fn().mockResolvedValue({
        global: {
          provider: 'nvidia-nim',
          model: 'nvidia/nemotron-3.5-super-vl-120b-a12b',
          embeddingModel: 'nvidia/llama-3.2-nv-embedqa-1b-v2',
          apiKeyMask: '••••LZt_',
          hasKey: true,
          status: 'verified'
        },
        project: null,
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
        models: ['nvidia/nemotron-3.5-super-vl-120b-a12b', 'meta/llama-3.1-70b'],
        embeddingModels: ['nvidia/llama-3.2-nv-embedqa-1b-v2'],
        source: 'global'
      }),
      testAi: vi.fn().mockResolvedValue({ ok: true, message: 'Connected' }),
      saveAiSettings: vi.fn().mockResolvedValue({})
    }
  } as unknown as typeof window.api
})

describe('ProjectSettingsTab shell, navigation and single-scroll layout', () => {
  it('renders sticky header with project name and settings title', () => {
    render(<ProjectSettingsTab project={mockProject} />)
    const header = screen.getByTestId('settings-header')
    expect(header).toBeDefined()
    expect(screen.getByText('AgentWork')).toBeDefined()
    expect(screen.getByText('Settings')).toBeDefined()
  })

  it('renders all 7 tabs including sources in left vertical navigation bar', () => {
    render(<ProjectSettingsTab project={mockProject} />)
    expect(screen.getByTestId('tab-general')).toBeDefined()
    expect(screen.getByTestId('tab-ai')).toBeDefined()
    expect(screen.getByTestId('tab-sources')).toBeDefined()
    expect(screen.getByTestId('tab-channels')).toBeDefined()
    expect(screen.getByTestId('tab-schedule')).toBeDefined()
    expect(screen.getByTestId('tab-sidebar')).toBeDefined()
    expect(screen.getByTestId('tab-danger')).toBeDefined()
  })

  it('renders single scrollable content area and sticky footer', () => {
    render(<ProjectSettingsTab project={mockProject} />)
    const content = screen.getByTestId('settings-content')
    const footer = screen.getByTestId('settings-footer')
    expect(content).toBeDefined()
    expect(footer).toBeDefined()
  })

  it('switches tabs and displays respective section content', async () => {
    render(<ProjectSettingsTab project={mockProject} />)
    
    // Switch to General tab
    fireEvent.click(screen.getByTestId('tab-general'))
    expect(screen.getByText('General information')).toBeDefined()
    expect(screen.getByText('Project ID')).toBeDefined()

    // Switch to Channels tab
    fireEvent.click(screen.getByTestId('tab-channels'))
    expect(screen.getByText('Workspace & channels')).toBeDefined()
    expect(screen.getByText('Slack token & permissions')).toBeDefined()

    // Switch to Schedule tab
    fireEvent.click(screen.getByTestId('tab-schedule'))
    expect(screen.getByText('Schedule & completion')).toBeDefined()

    // Switch to Danger tab
    fireEvent.click(screen.getByTestId('tab-danger'))
    expect(screen.getAllByText('Danger zone').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByTestId('delete-project-btn')).toBeDefined()
  })
})
