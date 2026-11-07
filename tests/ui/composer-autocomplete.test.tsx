// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ComposerAutocompletePopover from '../../src/renderer/src/components/dashboard/ComposerAutocompletePopover'
import type { ProjectSource } from '../../src/shared/dashboard-contract'

describe('ComposerAutocompletePopover UI tests', () => {
  afterEach(cleanup)

  const sampleSources: ProjectSource[] = [
    {
      id: 'src-1',
      kind: 'browser',
      platform: 'slack',
      workspaceId: 'team-1',
      workspaceName: 'AgentWork',
      role: 'client',
      backfillDays: 7,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      enabled: true,
      channels: [
        {
          id: 'C0CF72BSYKT',
          name: 'agentworkprojecttesting',
          isPrivate: true,
          isDm: false,
          enabled: true,
          agentRead: true,
          agentWrite: true
        },
        {
          id: 'D0C7E3FSVNE',
          name: '@Ashutosh',
          isPrivate: false,
          isDm: true,
          enabled: true,
          agentRead: true,
          agentWrite: true
        }
      ]
    },
    {
      id: 'src-2',
      kind: 'browser',
      platform: 'teams',
      workspaceId: 'team-2',
      workspaceName: 'Engineering Teams',
      role: 'client',
      backfillDays: 7,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      enabled: true,
      channels: [
        {
          id: 'T-general',
          name: 'general',
          isPrivate: false,
          isDm: false,
          enabled: true
        }
      ]
    }
  ]

  it('renders account suggestions when trigger is @', () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()

    render(
      <ComposerAutocompletePopover
        trigger="@"
        query=""
        sources={sampleSources}
        onSelect={onSelect}
        onClose={onClose}
      />
    )

    expect(screen.getByRole('listbox')).toBeDefined()
    expect(screen.getByText('@AgentWork')).toBeDefined()
    expect(screen.getByText('@EngineeringTeams')).toBeDefined()

    // Click first suggestion
    fireEvent.click(screen.getByText('@AgentWork'))
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        insertText: '@AgentWork '
      })
    )
  })

  it('renders channel and contact suggestions when trigger is #', () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()

    render(
      <ComposerAutocompletePopover
        trigger="#"
        query=""
        sources={sampleSources}
        channels={sampleSources[0].channels}
        onSelect={onSelect}
        onClose={onClose}
      />
    )

    expect(screen.getByRole('listbox')).toBeDefined()
    expect(screen.getByText('#agentworkprojecttesting')).toBeDefined()
    expect(screen.getByText('@Ashutosh')).toBeDefined()

    // Click contact suggestion
    fireEvent.click(screen.getByText('@Ashutosh'))
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        insertText: '#Ashutosh '
      })
    )
  })

  it('renders slash commands when trigger is /', () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()

    render(
      <ComposerAutocompletePopover
        trigger="/"
        query=""
        sources={sampleSources}
        onSelect={onSelect}
        onClose={onClose}
      />
    )

    expect(screen.getByRole('listbox')).toBeDefined()
    expect(screen.getByText('/send')).toBeDefined()
    expect(screen.getByText('/ai-ans')).toBeDefined()
    expect(screen.getByText('/help')).toBeDefined()
    expect(screen.getByText('/help-slack')).toBeDefined()

    // Click /send command
    fireEvent.click(screen.getByText('/send'))
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        insertText: '/send : '
      })
    )
  })

  it('filters items correctly according to query', () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()

    render(
      <ComposerAutocompletePopover
        trigger="/"
        query="help"
        sources={sampleSources}
        onSelect={onSelect}
        onClose={onClose}
      />
    )

    expect(screen.getByText('/help')).toBeDefined()
    expect(screen.getByText('/help-slack')).toBeDefined()
    expect(screen.queryByText('/send')).toBeNull()
  })

  it('stops propagation and calls onSelect when Enter is pressed on window', () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()

    render(
      <ComposerAutocompletePopover
        trigger="@"
        query=""
        sources={sampleSources}
        onSelect={onSelect}
        onClose={onClose}
      />
    )

    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    const stopPropagationSpy = vi.spyOn(event, 'stopPropagation')
    const stopImmediateSpy = vi.spyOn(event, 'stopImmediatePropagation')

    window.dispatchEvent(event)

    expect(stopPropagationSpy).toHaveBeenCalled()
    expect(stopImmediateSpy).toHaveBeenCalled()
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        insertText: '@AgentWork '
      })
    )
  })

  it('stops propagation and calls onClose when Escape is pressed on window', () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()

    render(
      <ComposerAutocompletePopover
        trigger="@"
        query=""
        sources={sampleSources}
        onSelect={onSelect}
        onClose={onClose}
      />
    )

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    const stopPropagationSpy = vi.spyOn(event, 'stopPropagation')

    window.dispatchEvent(event)

    expect(stopPropagationSpy).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})
