// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { NewProjectModal } from '../../src/renderer/src/components/dashboard/NewProjectModal'
import { normalizeAppSettings } from '../../src/main/app-settings'
import { DEFAULT_APP_SETTINGS } from '../../src/shared/ipc-contract'

// Mock stores for NewProjectModal
vi.mock('../../src/renderer/src/hooks/useProfiles', () => ({
  useProfileStore: (selector: any) =>
    selector({
      profiles: [
        {
          id: 'prof-indiv-1',
          displayName: 'Test Profile',
          type: 'individual',
          isGlobalAccount: false,
          apps: {}
        }
      ]
    })
}))

vi.mock('../../src/renderer/src/hooks/useDashboard', () => ({
  useDashboardStore: (selector: any) =>
    selector({
      upsertProject: vi.fn(),
      syncNow: vi.fn(),
      snapshot: { projects: [] }
    })
}))

describe('NewProjectModal Linked Accounts Visibility Setting', () => {
  it('renders "Linked Accounts & Workspaces" when showLinkedAccounts is true', () => {
    const { container } = render(
      <NewProjectModal open={true} onClose={vi.fn()} showLinkedAccounts={true} />
    )

    const section = container.querySelector('.new-project-linked-accounts-section')
    expect(section).not.toBeNull()
    expect(section?.textContent).toContain('Linked Accounts & Workspaces')
    expect(section?.textContent).toContain('+ Add Accounts')
  })

  it('hides "Linked Accounts & Workspaces" section when showLinkedAccounts is false', () => {
    const { container } = render(
      <NewProjectModal open={true} onClose={vi.fn()} showLinkedAccounts={false} />
    )

    const section = container.querySelector('.new-project-linked-accounts-section')
    expect(section).toBeNull()
  })

  it('defaults showLinkedAccounts to false when prop is omitted', () => {
    const { container } = render(
      <NewProjectModal open={true} onClose={vi.fn()} />
    )

    const section = container.querySelector('.new-project-linked-accounts-section')
    expect(section).toBeNull()
  })
})

describe('AppSettings schema persistence for showNewProjectLinkedAccounts', () => {
  it('defaults showNewProjectLinkedAccounts to false in DEFAULT_APP_SETTINGS', () => {
    expect(DEFAULT_APP_SETTINGS.showNewProjectLinkedAccounts).toBe(false)
  })

  it('validates and preserves showNewProjectLinkedAccounts: true', () => {
    const parsed = normalizeAppSettings({
      showNewProjectLinkedAccounts: true
    })
    expect(parsed.showNewProjectLinkedAccounts).toBe(true)
  })

  it('falls back to default false when undefined or invalid type', () => {
    const parsed = normalizeAppSettings({})
    expect(parsed.showNewProjectLinkedAccounts).toBe(false)

    const parsedInvalid = normalizeAppSettings({
      showNewProjectLinkedAccounts: 'invalid' as any
    })
    expect(parsedInvalid.showNewProjectLinkedAccounts).toBe(false)
  })
})
