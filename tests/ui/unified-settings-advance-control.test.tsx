// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, screen, cleanup } from '@testing-library/react'
import { UnifiedSettingsModal } from '../../src/renderer/src/components/dashboard/UnifiedSettingsModal'
import { useProfileStore } from '../../src/renderer/src/hooks/useProfiles'
import { DEFAULT_APP_SETTINGS } from '../../src/shared/ipc-contract'

beforeAll(() => {
  window.api = {
    dashboard: {
      getGlobalConfig: vi.fn().mockResolvedValue({
        nvidia: { status: 'ok', configured: true },
        theme: 'dark'
      }),
      onConfigChanged: vi.fn().mockReturnValue(() => {})
    },
    profiles: {
      setHiddenInSidebar: vi.fn(),
      setLinkHiddenInSidebar: vi.fn(),
      removeCustomLink: vi.fn(),
      addCustomLink: vi.fn()
    },
    app: {
      testNotification: vi.fn().mockResolvedValue({ message: 'Test notification' })
    }
  } as any
})

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
})

describe('UnifiedSettingsModal Advance Control and Modal Dimensions', () => {
  const dummyProps = {
    open: true,
    settings: { ...DEFAULT_APP_SETTINGS },
    onClose: vi.fn(),
    onChangeSettings: vi.fn(),
    onClearAllProfiles: vi.fn(),
    onExportProfiles: vi.fn(),
    onImportProfiles: vi.fn(),
    onAdminLogout: vi.fn()
  }

  it('matches AccountsManagementModal dimensions (min(1440px, 98vw) and min(92vh, 920px))', () => {
    const { container } = render(<UnifiedSettingsModal {...dummyProps} />)
    const modal = container.querySelector('.platform-settings-panel') as HTMLElement
    expect(modal).not.toBeNull()
    expect(modal.style.width).toBe('min(1440px, 98vw)')
    expect(modal.style.height).toBe('min(92vh, 920px)')
    expect(modal.style.maxHeight).toBe('min(92vh, 920px)')
  })

  it('shows only Preferences & Appearance and Advance Control when Advanced Settings is off', () => {
    const { container } = render(<UnifiedSettingsModal {...dummyProps} />)
    const aside = container.querySelector('aside')
    expect(aside).not.toBeNull()
    expect(aside?.textContent).toContain('Preferences & Appearance')
    expect(aside?.textContent).toContain('Advance Control')
    expect(aside?.textContent).not.toContain('Sidebar & Navigation')
    expect(aside?.textContent).not.toContain('Global AI & NVIDIA NIM')
    expect(aside?.textContent).not.toContain('Accounts & Workspaces')
    expect(aside?.textContent).not.toContain('System & Maintenance')
  })

  it('reveals all 6 tabs when Advanced Settings toggle is clicked', () => {
    const { container } = render(<UnifiedSettingsModal {...dummyProps} />)
    const advanceToggle = container.querySelector('aside input[type="checkbox"]') as HTMLInputElement
    expect(advanceToggle).not.toBeNull()
    expect(advanceToggle.checked).toBe(false)

    fireEvent.click(advanceToggle)
    expect(advanceToggle.checked).toBe(true)

    const aside = container.querySelector('aside')
    expect(aside?.textContent).toContain('Preferences & Appearance')
    expect(aside?.textContent).toContain('Advance Control')
    expect(aside?.textContent).toContain('Sidebar & Navigation')
    expect(aside?.textContent).toContain('Global AI & NVIDIA NIM')
    expect(aside?.textContent).toContain('Accounts & Workspaces')
    expect(aside?.textContent).toContain('System & Maintenance')
  })

  it('renders Appearance Look & Header and Default App Presets inside Advance Control tab', () => {
    const { container } = render(<UnifiedSettingsModal {...dummyProps} />)
    const buttons = Array.from(container.querySelectorAll('aside button'))
    const advanceBtn = buttons.find((b) => b.textContent?.includes('Advance Control')) as HTMLButtonElement
    expect(advanceBtn).toBeDefined()
    fireEvent.click(advanceBtn)

    const main = container.querySelector('main')
    expect(main?.textContent).toContain('Appearance Look & Header')
    expect(main?.textContent).toContain('Default Appearance Look')
    expect(main?.textContent).toContain('Show Look Switcher in Sidebar Header')
    expect(main?.textContent).toContain('Default App Presets')
    expect(main?.textContent).toContain('Base Default Apps Layout')
  })

  it('does NOT render Appearance Look & Header or Default App Presets in Sidebar & Navigation tab', () => {
    const { container } = render(<UnifiedSettingsModal {...dummyProps} />)
    const advanceToggle = container.querySelector('aside input[type="checkbox"]') as HTMLInputElement
    fireEvent.click(advanceToggle)

    const buttons = Array.from(container.querySelectorAll('aside button'))
    const sidebarBtn = buttons.find((b) => b.textContent?.includes('Sidebar & Navigation')) as HTMLButtonElement
    expect(sidebarBtn).toBeDefined()
    fireEvent.click(sidebarBtn)

    const main = container.querySelector('main')
    expect(main?.textContent).toContain('Left Sidebar Navigation Rail')
    expect(main?.textContent).toContain('Modals & Creation Dialogs')
    expect(main?.textContent).toContain('Sidebar Bottom Action Buttons')

    expect(main?.textContent).not.toContain('Default Appearance Look')
    expect(main?.textContent).not.toContain('Base Default Apps Layout')
  })

  it('resets to Preferences & Appearance if Advanced Settings is turned off while in an advanced tab', () => {
    const { container } = render(<UnifiedSettingsModal {...dummyProps} />)
    const advanceToggle = container.querySelector('aside input[type="checkbox"]') as HTMLInputElement
    fireEvent.click(advanceToggle)

    const buttons = Array.from(container.querySelectorAll('aside button'))
    const sidebarBtn = buttons.find((b) => b.textContent?.includes('Sidebar & Navigation')) as HTMLButtonElement
    fireEvent.click(sidebarBtn)

    const main = container.querySelector('main')
    expect(main?.textContent).toContain('Left Sidebar Navigation Rail')

    fireEvent.click(advanceToggle)
    const aside = container.querySelector('aside')
    expect(aside?.textContent).not.toContain('Sidebar & Navigation')
    expect(main?.textContent).toContain('Configure visual appearance, notifications, workspace layout, and system idle behaviors.')
  })

  it('renders Delete button in Accounts tab and calls onDeleteProfile on confirmation', () => {
    const onDeleteProfile = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    useProfileStore.setState({
      profiles: [
        {
          id: 'test-del-1',
          displayName: 'test@account.com',
          customName: 'Delete Me',
          createdAt: new Date().toISOString(),
          avatarColor: '#2BAC76',
          googleAuthStatus: 'signed-in',
          muted: false,
          hiddenInSidebar: false,
          apps: {
            slack: { sessionStatus: 'not-signed-in', availableWorkspaces: [], pinnedWorkspaces: [] },
            teams: { sessionStatus: 'not-signed-in', availableWorkspaces: [], pinnedWorkspaces: [] },
            whatsapp: { sessionStatus: 'not-signed-in', availableWorkspaces: [], pinnedWorkspaces: [] }
          }
        }
      ]
    })

    const { container } = render(
      <UnifiedSettingsModal
        {...dummyProps}
        initialTab="accounts"
        onDeleteProfile={onDeleteProfile}
      />
    )

    const main = container.querySelector('main')
    expect(main?.textContent).toContain('test@account.com')
    expect(main?.textContent).toContain('Delete Me')

    const delBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Delete')
    ) as HTMLButtonElement
    expect(delBtn).toBeDefined()
    fireEvent.click(delBtn)

    const modalDeleteBtn = screen.getByRole('button', { name: 'Delete Profile' })
    expect(modalDeleteBtn).toBeDefined()
    fireEvent.click(modalDeleteBtn)

    expect(onDeleteProfile).toHaveBeenCalledWith('test-del-1', true)
  })
})
