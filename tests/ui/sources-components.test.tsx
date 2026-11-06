// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'


afterEach(() => {
  cleanup()
})
import {
  SourcePicker,
  WorkspacePicker,
  ChannelPicker,
  BackfillSelect,
  AutomationNotice,
  SourceStatusBadge
} from '../../src/renderer/src/components/dashboard/sources'

describe('Sources UI Components (SLK-4)', () => {
  it('SourcePicker allows toggling between browser and token sources', () => {
    const onChange = vi.fn()
    render(<SourcePicker value="browser" onChange={onChange} />)

    expect(screen.getByText(/Logged-in Slack Web Session/i)).toBeDefined()
    const tokenRadio = screen.getByLabelText(/Official Slack App Token/i)
    fireEvent.click(tokenRadio)
    expect(onChange).toHaveBeenCalledWith('token')
  })

  it('WorkspacePicker renders connected workspaces grouped by email', () => {
    const onChange = vi.fn()
    const options = [
      {
        profileId: 'prof_1',
        profileEmail: 'alice@company.com',
        workspaceId: 'T123',
        workspaceName: 'Acme Corp'
      }
    ]

    render(<WorkspacePicker options={options} selectedKey="prof_1:T123" onChange={onChange} />)
    expect(screen.getByText(/Acme Corp \(alice@company\.com\)/i)).toBeDefined()
  })

  it('ChannelPicker filters channels and handles selection', () => {
    const onChange = vi.fn()
    const channels = [
      { id: 'C1', name: 'general' },
      { id: 'C2', name: 'dev-team', isPrivate: true },
      { id: 'C3', name: 'random' }
    ]

    render(<ChannelPicker channels={channels} selectedChannelIds={['C1']} onChange={onChange} />)

    expect(screen.getByText(/# general/i)).toBeDefined()
    expect(screen.getByText(/🔒 dev-team/i)).toBeDefined()

    const searchInput = screen.getByPlaceholderText(/Search channels/i)
    fireEvent.change(searchInput, { target: { value: 'dev' } })

    expect(screen.queryByText(/# general/i)).toBeNull()
    expect(screen.getByText(/🔒 dev-team/i)).toBeDefined()
  })

  it('BackfillSelect triggers change with numeric day values', () => {
    const onChange = vi.fn()
    render(<BackfillSelect days={7} onChange={onChange} />)

    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: '30' } })
    expect(onChange).toHaveBeenCalledWith(30)
  })

  it('AutomationNotice handles acknowledgement toggle', () => {
    const onChange = vi.fn()
    render(<AutomationNotice acknowledged={false} onChange={onChange} />)

    const checkbox = screen.getByRole('checkbox')
    fireEvent.click(checkbox)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('SourceStatusBadge renders appropriate label and color indicators', () => {
    const { rerender } = render(<SourceStatusBadge status="connected" />)
    expect(screen.getByText('Connected')).toBeDefined()

    rerender(<SourceStatusBadge status="needs-login" />)
    expect(screen.getByText('Needs Login')).toBeDefined()

    rerender(<SourceStatusBadge status="paused" />)
    expect(screen.getByText('Paused')).toBeDefined()
  })
})
