// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentCockpitCard } from '../../src/renderer/src/components/dashboard/AgentCockpitCard'
import type { DashboardProject } from '../../src/shared/dashboard-contract'

describe('AgentCockpitCard', () => {
  const sendAgentMessageMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    window.api = {
      dashboard: {
        sendAgentMessage: sendAgentMessageMock
      }
    } as any
  })

  it('renders locked warning when no channels have agentWrite enabled', () => {
    const project: DashboardProject = {
      id: 'proj-1',
      name: 'Project Alpha',
      clientName: 'Client Alpha',
      profileId: 'prof-1',
      teamId: 'T_1',
      appId: 'slack',
      tokenSource: 'manual',
      createdAt: '2026-11-06T10:00:00Z',
      monitors: [],
      sources: [
        {
          id: 'src-1',
          kind: 'browser',
          platform: 'slack',
          profileId: 'prof-1',
          workspaceId: 'T_1',
          workspaceName: 'Workspace 1',
          role: 'client',
          enabled: true,
          backfillDays: 7,
          createdAt: '2026-11-06T10:00:00Z',
          updatedAt: '2026-11-06T10:00:00Z',
          channels: [
            { id: 'C_1', name: 'general', enabled: true, agentRead: true, agentWrite: false }
          ]
        }
      ]
    }

    const onOpenControl = vi.fn()
    render(<AgentCockpitCard project={project} onOpenControl={onOpenControl} />)

    expect(screen.getByText('No channels authorized for Agent Write')).toBeTruthy()
    const grantBtn = screen.getByRole('button', { name: /Grant Permissions/i })
    fireEvent.click(grantBtn)
    expect(onOpenControl).toHaveBeenCalledTimes(1)
  })

  it('renders selector and allows sending message to authorized channel', async () => {
    sendAgentMessageMock.mockResolvedValueOnce({ ok: true, ts: '1700000000.123456' })

    const project: DashboardProject = {
      id: 'proj-1',
      name: 'Project Alpha',
      clientName: 'Client Alpha',
      profileId: 'prof-1',
      teamId: 'T_1',
      appId: 'slack',
      tokenSource: 'manual',
      createdAt: '2026-11-06T10:00:00Z',
      monitors: [],
      sources: [
        {
          id: 'src-1',
          kind: 'browser',
          platform: 'slack',
          profileId: 'prof-1',
          workspaceId: 'T_1',
          workspaceName: 'Workspace 1',
          role: 'client',
          enabled: true,
          backfillDays: 7,
          createdAt: '2026-11-06T10:00:00Z',
          updatedAt: '2026-11-06T10:00:00Z',
          channels: [
            { id: 'C_PERM', name: 'proj-team', enabled: true, agentRead: true, agentWrite: true }
          ]
        }
      ]
    }

    render(
      <AgentCockpitCard
        project={project}
        nextStep="Ask client for architectural diagrams."
      />
    )

    expect(screen.getByText(/1 Channel Authorized/i)).toBeTruthy()
    expect(screen.getByDisplayValue(/Ask client for architectural diagrams/i)).toBeTruthy()

    const sendBtn = screen.getByRole('button', { name: /Send to Slack Now/i })
    fireEvent.click(sendBtn)

    await waitFor(() => {
      expect(sendAgentMessageMock).toHaveBeenCalledWith({
        projectId: 'proj-1',
        channelId: 'C_PERM',
        text: 'Ask client for architectural diagrams.'
      })
    })

    await waitFor(() => {
      expect(screen.getByText(/Dispatched to #proj-team via Direct API/i)).toBeTruthy()
    })
  })
})
