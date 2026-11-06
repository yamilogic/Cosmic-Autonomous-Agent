// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { NewProfileModal } from '../../src/renderer/src/components/dashboard/NewProfileModal'
import { useProfileStore } from '../../src/renderer/src/hooks/useProfiles'
import type { Profile } from '../../src/shared/types'

function makeMockProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'test-profile-1',
    displayName: 'user@company.com',
    customName: 'Test User',
    createdAt: new Date().toISOString(),
    avatarColor: '#2BAC76',
    googleAuthStatus: 'signed-in',
    muted: false,
    hiddenInSidebar: false,
    apps: {
      slack: { sessionStatus: 'not-signed-in', availableWorkspaces: [], pinnedWorkspaces: [] },
      teams: { sessionStatus: 'not-signed-in', availableWorkspaces: [], pinnedWorkspaces: [] },
      whatsapp: { sessionStatus: 'not-signed-in', availableWorkspaces: [], pinnedWorkspaces: [] }
    },
    ...overrides
  }
}

describe('NewProfileModal authentication and existing account detection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProfileStore.setState({
      profiles: []
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('shows fresh creation prompt when email is not added', () => {
    render(
      <NewProfileModal
        open={true}
        onClose={vi.fn()}
        onCreate={vi.fn().mockResolvedValue(undefined)}
      />
    )

    const emailInput = screen.getByPlaceholderText(/name@company.com/i)
    fireEvent.change(emailInput, { target: { value: 'fresh@example.com' } })

    expect(screen.queryByText(/Active Account Found/i)).toBeNull()
    expect(screen.getByText(/Chrome will open to verify Google session/i)).toBeDefined()
    expect(screen.getByRole('button', { name: /Add Account & Verify/i })).toBeDefined()
  })

  it('does NOT show Active Account Found if profile exists but googleAuthStatus is not signed-in', () => {
    useProfileStore.setState({
      profiles: [
        makeMockProfile({
          displayName: 'unverified@example.com',
          googleAuthStatus: 'not-signed-in'
        })
      ]
    })

    render(
      <NewProfileModal
        open={true}
        onClose={vi.fn()}
        onCreate={vi.fn().mockResolvedValue(undefined)}
      />
    )

    const emailInput = screen.getByPlaceholderText(/name@company.com/i)
    fireEvent.change(emailInput, { target: { value: 'unverified@example.com' } })

    // Must NOT claim account is active/authenticated
    expect(screen.queryByText(/Active Account Found/i)).toBeNull()
    expect(screen.getByRole('button', { name: /Add Account & Verify/i })).toBeDefined()
  })

  it('shows Active Account Found only when profile is genuinely signed in and visible', () => {
    useProfileStore.setState({
      profiles: [
        makeMockProfile({
          displayName: 'ashutoshknp12@gmail.com',
          customName: 'Ashutosh',
          googleAuthStatus: 'signed-in',
          hiddenInSidebar: false
        })
      ]
    })

    render(
      <NewProfileModal
        open={true}
        onClose={vi.fn()}
        onCreate={vi.fn().mockResolvedValue(undefined)}
      />
    )

    const emailInput = screen.getByPlaceholderText(/name@company.com/i)
    fireEvent.change(emailInput, { target: { value: 'ashutoshknp12@gmail.com' } })

    expect(screen.getByText(/Active Account Found/i)).toBeDefined()
    expect(screen.getByText(/ashutoshknp12@gmail.com/i)).toBeDefined()
    expect(screen.getByRole('button', { name: /Update & Link Account/i })).toBeDefined()
  })

  it('allows user to choose Re-authenticate in Google Chrome even if profile exists', () => {
    useProfileStore.setState({
      profiles: [
        makeMockProfile({
          displayName: 'ashutoshknp12@gmail.com',
          customName: 'Ashutosh',
          googleAuthStatus: 'signed-in'
        })
      ]
    })

    render(
      <NewProfileModal
        open={true}
        onClose={vi.fn()}
        onCreate={vi.fn().mockResolvedValue(undefined)}
      />
    )

    const emailInput = screen.getByPlaceholderText(/name@company.com/i)
    fireEvent.change(emailInput, { target: { value: 'ashutoshknp12@gmail.com' } })

    const reauthBtn = screen.getByRole('button', { name: /Re-authenticate in Google/i })
    fireEvent.click(reauthBtn)

    // After clicking re-authenticate, button switches to Add Account & Verify
    expect(screen.getByRole('button', { name: /Add Account & Verify/i })).toBeDefined()
  })

  it('submits cleanly and calls onCreate and onClose without hanging', async () => {
    const handleCreate = vi.fn().mockResolvedValue(undefined)
    const handleClose = vi.fn()

    render(
      <NewProfileModal
        open={true}
        onClose={handleClose}
        onCreate={handleCreate}
      />
    )

    const nameInput = screen.getByPlaceholderText(/Ashutosh/i)
    const emailInput = screen.getByPlaceholderText(/name@company.com/i)

    fireEvent.change(nameInput, { target: { value: 'Work Account' } })
    fireEvent.change(emailInput, { target: { value: 'work@example.com' } })

    const submitBtn = screen.getByRole('button', { name: /Add Account & Verify/i })
    fireEvent.click(submitBtn)

    expect(handleCreate).toHaveBeenCalledWith('Work Account', 'work@example.com', 'both', false)
    expect(handleClose).toHaveBeenCalled()
  })
})
