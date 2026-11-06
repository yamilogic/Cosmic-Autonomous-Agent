// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach, beforeAll } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import DashboardWizard from '../../src/renderer/src/components/dashboard/DashboardWizard'
import { useProfileStore } from '../../src/renderer/src/hooks/useProfiles'

beforeAll(() => {
  // @ts-expect-error partial window.api mock for UI testing
  window.api = {
    dashboard: {
      getAppConfig: vi.fn().mockResolvedValue({ clientId: 'id', redirectUri: 'http://localhost' }),
      listChannels: vi.fn().mockResolvedValue([])
    } as unknown as typeof window.api.dashboard,
    slack: {
      listChannels: vi.fn().mockResolvedValue([])
    } as unknown as typeof window.api.slack
  }
})

afterEach(() => {
  cleanup()
})

describe('DashboardWizard Source Step (SLK-5)', () => {
  it('renders Choose Connection Method as initial step with radio options', () => {
    // mock profile state
    useProfileStore.setState({
      profiles: [
        {
          id: 'p1',
          displayName: 'test@company.com',
          createdAt: '',
          avatarColor: '#fff',
          googleAuthStatus: 'signed-in',
          apps: {
            slack: {
              sessionStatus: 'signed-in',
              availableWorkspaces: [
                {
                  teamId: 'T123',
                  teamName: 'Acme Slack',
                  openUrl: 'https://acme.slack.com',
                  lastSeenAt: ''
                }
              ],
              pinnedWorkspaces: []
            },
            teams: { sessionStatus: 'not-signed-in', availableWorkspaces: [], pinnedWorkspaces: [] },
            whatsapp: { sessionStatus: 'not-signed-in', availableWorkspaces: [], pinnedWorkspaces: [] }
          }
        }
      ]
    })

    render(<DashboardWizard />)

    expect(screen.getByText('Choose Connection Method')).toBeDefined()
    expect(screen.getByText(/Logged-in Slack Web Session/i)).toBeDefined()
    expect(screen.getByText(/Official Slack App Token/i)).toBeDefined()

    // Select Logged-in Browser radio
    fireEvent.click(screen.getByLabelText(/Logged-in Slack Web Session/i))

    // Clicking continue advances to configure step for browser source
    fireEvent.click(screen.getByRole('button', { name: /Continue →/i }))
    expect(screen.getByText('Logged-in Slack Workspace')).toBeDefined()
    expect(screen.getByText(/Acme Slack \(test@company\.com\)/i)).toBeDefined()
  })
})
