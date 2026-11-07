// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SourceChannelPicker } from '../../src/renderer/src/components/dashboard/SourceChannelPicker'
import type { ProjectSource } from '../../src/shared/dashboard-contract'

const source: ProjectSource = {
  id: 'src-1',
  kind: 'browser',
  platform: 'slack',
  profileId: 'prof-1',
  workspaceId: 'T1',
  workspaceName: 'Acme',
  channels: [],
  role: 'client',
  enabled: true,
  backfillDays: 7,
  status: 'connected',
  createdAt: '2026-11-02T10:00:00.000Z',
  updatedAt: '2026-11-02T10:00:00.000Z'
}

describe('SourceChannelPicker', () => {
  const updateSource = vi.fn().mockResolvedValue({ snapshot: { projects: [] } })
  const discoverSourceChannels = vi.fn().mockResolvedValue({
    channels: [
      { id: 'C1', name: 'general', kind: 'public', enabled: false },
      { id: 'C2', name: 'leads', kind: 'private', isPrivate: true, enabled: false },
      { id: 'D1', name: 'Priya', kind: 'dm', isDm: true, enabled: false }
    ]
  })

  beforeEach(() => {
    vi.clearAllMocks()
    window.api = {
      dashboard: { updateSource, discoverSourceChannels }
    } as never
  })

  afterEach(() => cleanup())

  it('starts with nothing ticked and saves only the channels the user picks', async () => {
    render(
      <SourceChannelPicker projectId="proj-1" source={source} open onClose={vi.fn()} />
    )

    await screen.findByText(/general/i)
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(checkboxes.every((box) => !box.checked)).toBe(true)

    fireEvent.click(screen.getByLabelText(/# general/i))
    fireEvent.click(screen.getByLabelText(/leads/i))
    fireEvent.click(screen.getByRole('button', { name: /save channel selection/i }))

    await waitFor(() => expect(updateSource).toHaveBeenCalledTimes(1))
    const payload = updateSource.mock.calls[0]![0]
    expect(payload).toMatchObject({
      projectId: 'proj-1',
      sourceId: 'src-1',
      patch: {
        selectionMode: 'include',
        allowDms: 'off'
      }
    })
    expect(payload.patch.channelsReviewedAt).toEqual(expect.any(String))
    expect(
      payload.patch.channels.filter((channel: { enabled: boolean }) => channel.enabled).map(
        (channel: { id: string }) => channel.id
      )
    ).toEqual(['C1', 'C2'])
  })

  it('switches to exclude mode and stores ticked channels as the excluded set', async () => {
    render(
      <SourceChannelPicker projectId="proj-1" source={source} open onClose={vi.fn()} />
    )

    await screen.findByText(/general/i)
    fireEvent.click(screen.getByRole('button', { name: /stop only selected/i }))
    fireEvent.click(screen.getByLabelText(/# general/i))
    fireEvent.click(screen.getByRole('button', { name: /save channel selection/i }))

    await waitFor(() => expect(updateSource).toHaveBeenCalledTimes(1))
    const payload = updateSource.mock.calls[0]![0]
    expect(payload.patch.selectionMode).toBe('exclude')
    expect(
      payload.patch.channels.filter((channel: { enabled: boolean }) => channel.enabled).map(
        (channel: { id: string }) => channel.id
      )
    ).toEqual(['C1'])
  })

  it('renders DMs by default without search bar and automatically sets allowDms on when a DM is selected', async () => {
    render(
      <SourceChannelPicker projectId="proj-1" source={source} open onClose={vi.fn()} />
    )

    await screen.findByText(/general/i)
    // No search input rendered
    expect(screen.queryByPlaceholderText(/search/i)).toBeNull()

    // DMs are visible by default
    expect(screen.getByText(/Priya/i)).toBeDefined()

    // Select DM Priya
    fireEvent.click(screen.getByLabelText(/Priya/i))
    fireEvent.click(screen.getByRole('button', { name: /save channel selection/i }))

    await waitFor(() => expect(updateSource).toHaveBeenCalledTimes(1))
    const payload = updateSource.mock.calls[0]![0]
    expect(payload.patch.allowDms).toBe('on')
    expect(
      payload.patch.channels.filter((channel: { enabled: boolean }) => channel.enabled).map(
        (channel: { id: string }) => channel.id
      )
    ).toEqual(['D1'])
  })

  it('renders centered with z-index 99999 so it sits on top of all views', async () => {
    render(
      <SourceChannelPicker projectId="proj-1" source={source} open onClose={vi.fn()} />
    )

    const dialog = screen.getByRole('dialog', { name: /select channels to scrape/i })
    expect(dialog.style.position).toBe('fixed')
    expect(dialog.style.zIndex).toBe('99999')
    expect(dialog.style.display).toBe('flex')
    expect(dialog.style.alignItems).toBe('center')
    expect(dialog.style.justifyContent).toBe('center')
  })
})
