// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LogsObservabilityTab } from '../../src/renderer/src/components/dashboard/LogsObservabilityTab'
import type { LogEntry } from '../../src/shared/ipc-contract'

describe('LogsObservabilityTab UI', () => {
  let logListener: ((entry: LogEntry) => void) | null = null
  let mockLogs: LogEntry[] = []

  beforeEach(() => {
    logListener = null
    mockLogs = [
      {
        id: 'log-1',
        level: 'info',
        category: 'ui',
        message: 'Opened Settings Hub',
        ts: new Date().toISOString()
      },
      {
        id: 'log-2',
        level: 'warn',
        category: 'sync',
        message: 'Sync poller warning: delayed response',
        meta: { delayMs: 420 },
        ts: new Date().toISOString()
      },
      {
        id: 'log-3',
        level: 'error',
        category: 'error',
        message: 'Network connection dropped',
        ts: new Date().toISOString()
      }
    ]

    const off = (): void => undefined
    ;(window as any).api = {
      logs: {
        getRecent: vi.fn(async () => [...mockLogs]),
        setRetention: vi.fn(async () => undefined),
        clear: vi.fn(async () => {
          mockLogs = []
        }),
        export: vi.fn(async () => ({
          ok: true,
          count: mockLogs.length,
          content: JSON.stringify(mockLogs)
        })),
        logAction: vi.fn(async () => undefined),
        onLogEntry: vi.fn((cb: (entry: LogEntry) => void) => {
          logListener = cb
          return off
        })
      }
    }

    // Mock scrollIntoView
    Element.prototype.scrollIntoView = vi.fn()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders initial logs with level and category chips', async () => {
    render(<LogsObservabilityTab />)

    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.getByText('Application Observability & Logs')).toBeTruthy()
    expect(screen.getByText('Opened Settings Hub')).toBeTruthy()
    expect(screen.getByText('Sync poller warning: delayed response')).toBeTruthy()
    expect(screen.getByText('Network connection dropped')).toBeTruthy()

    // Status badges
    expect(screen.getByText(/1 Active Errors/i)).toBeTruthy()
    expect(screen.getByText(/3 Live Entries/i)).toBeTruthy()
  })

  it('filters logs by log level dropdown', async () => {
    render(<LogsObservabilityTab />)

    await act(async () => {
      await Promise.resolve()
    })

    const levelSelect = screen.getByLabelText('Filter by log level')
    act(() => {
      fireEvent.change(levelSelect, { target: { value: 'error' } })
    })

    expect(screen.getByText('Network connection dropped')).toBeTruthy()
    expect(screen.queryByText('Opened Settings Hub')).toBeNull()
  })

  it('filters logs by search query input', async () => {
    render(<LogsObservabilityTab />)

    await act(async () => {
      await Promise.resolve()
    })

    const searchInput = screen.getByPlaceholderText(/Search logs/i)
    act(() => {
      fireEvent.change(searchInput, { target: { value: 'poller' } })
    })

    expect(screen.getByText('Sync poller warning: delayed response')).toBeTruthy()
    expect(screen.queryByText('Opened Settings Hub')).toBeNull()
    expect(screen.queryByText('Network connection dropped')).toBeNull()
  })

  it('appends new log entries dynamically in real time', async () => {
    render(<LogsObservabilityTab />)

    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.queryByText('Live streaming event 999')).toBeNull()

    act(() => {
      logListener?.({
        id: 'log-999',
        level: 'info',
        category: 'nav',
        message: 'Live streaming event 999',
        ts: new Date().toISOString()
      })
    })

    expect(screen.getByText('Live streaming event 999')).toBeTruthy()
    expect(screen.getByText(/4 Live Entries/i)).toBeTruthy()
  })

  it('clears logs when clear button is clicked', async () => {
    render(<LogsObservabilityTab />)

    await act(async () => {
      await Promise.resolve()
    })

    const clearBtn = screen.getByRole('button', { name: /Clear/i })
    await act(async () => {
      fireEvent.click(clearBtn)
    })

    expect(window.api.logs.clear).toHaveBeenCalled()
    expect(screen.queryByText('Opened Settings Hub')).toBeNull()
    expect(screen.getByText(/No log entries found/i)).toBeTruthy()
  })

  it('changes retention window when dropdown is changed', async () => {
    render(<LogsObservabilityTab />)

    await act(async () => {
      await Promise.resolve()
    })

    const retentionSelect = screen.getByLabelText('Log retention duration')
    await act(async () => {
      fireEvent.change(retentionSelect, { target: { value: '30' } })
    })

    expect(window.api.logs.setRetention).toHaveBeenCalledWith(30)
  })
})

