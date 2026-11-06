// @vitest-environment jsdom
import { render, fireEvent, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { DeleteConfirmNoticeModal } from '../../src/renderer/src/components/dashboard/DeleteConfirmNoticeModal'

describe('DeleteConfirmNoticeModal', () => {
  afterEach(cleanup)
  it('renders card deletion details and calls onConfirmCardDelete', async () => {
    const onConfirmCardDelete = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()

    render(
      <DeleteConfirmNoticeModal
        open={true}
        onClose={onClose}
        target={{
          type: 'card',
          card: {
            id: 'proj-123',
            name: 'Alpha Project',
            clientName: 'Acme Corp',
            teamName: 'excellencetech',
            channelCount: 3
          }
        }}
        onConfirmCardDelete={onConfirmCardDelete}
      />
    )

    expect(screen.getByText('Delete Project Card')).not.toBeNull()
    expect(screen.getByText('Alpha Project', { exact: false })).not.toBeNull()
    expect(screen.getByText('Acme Corp')).not.toBeNull()
    expect(screen.getByText('excellencetech')).not.toBeNull()
    expect(screen.getByText('3')).not.toBeNull()

    const deleteBtn = screen.getByRole('button', { name: 'Delete Card' })
    fireEvent.click(deleteBtn)

    expect(onConfirmCardDelete).toHaveBeenCalledWith('proj-123')
  })

  it('renders profile deletion details, toggles card cascade checkbox, and calls onConfirmProfileDelete', async () => {
    const onConfirmProfileDelete = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()

    render(
      <DeleteConfirmNoticeModal
        open={true}
        onClose={onClose}
        target={{
          type: 'profile',
          profile: {
            id: 'prof-456',
            name: 'Ashutosh',
            email: 'ashutosh@example.com',
            cards: [
              { id: 'card-1', name: 'Alpha Project' },
              { id: 'card-2', name: 'Beta Project' }
            ]
          }
        }}
        onConfirmProfileDelete={onConfirmProfileDelete}
      />
    )

    expect(screen.getByText('Delete Profile Account')).not.toBeNull()
    expect(screen.getAllByText(/Ashutosh/i).length).toBeGreaterThan(0)
    expect(screen.getByText('ashutosh@example.com')).not.toBeNull()
    expect(screen.getByText('📁 Alpha Project')).not.toBeNull()
    expect(screen.getByText('📁 Beta Project')).not.toBeNull()

    const checkbox = screen.getByRole('checkbox')
    expect((checkbox as HTMLInputElement).checked).toBe(true)

    // Uncheck cascade deletion
    fireEvent.click(checkbox)
    expect((checkbox as HTMLInputElement).checked).toBe(false)

    const deleteBtn = screen.getByRole('button', { name: 'Delete Profile' })
    fireEvent.click(deleteBtn)

    expect(onConfirmProfileDelete).toHaveBeenCalledWith('prof-456', false)
  })

  it('closes when Cancel is clicked', () => {
    const onClose = vi.fn()

    render(
      <DeleteConfirmNoticeModal
        open={true}
        onClose={onClose}
        target={{
          type: 'card',
          card: {
            id: 'proj-123',
            name: 'Alpha Project'
          }
        }}
      />
    )

    const cancelBtn = screen.getByRole('button', { name: 'Cancel' })
    fireEvent.click(cancelBtn)
    expect(onClose).toHaveBeenCalled()
  })
})
