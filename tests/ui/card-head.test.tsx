// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CardHead from '../../src/renderer/src/components/dashboard/CardHead'

afterEach(cleanup)

const defaultProps = {
  name: 'Aurora storefront',
  workspaceName: 'Northwind Retail',
  clientName: 'Northwind Retail',
  aiBadge: 'AI · 2h ago · demo-model',
  syncing: false,
  onSync: vi.fn(),
  onSettings: vi.fn(),
  onEdit: vi.fn(),
  onToggle: vi.fn(),
  onRemove: vi.fn(),
}

function renderHead(overrides: Record<string, unknown> = {}): void {
  render(<CardHead {...defaultProps} {...overrides} />)
}

describe('CardHead — identity', () => {
  it('renders project name, workspace and client', () => {
    renderHead()
    expect(screen.getByText('Aurora storefront')).toBeTruthy()
    expect(screen.getByText('Northwind Retail')).toBeTruthy()
  })

  it('omits client when it equals workspace', () => {
    renderHead({ clientName: 'Northwind Retail' })
    const client = screen.getAllByText('Northwind Retail')
    expect(client.length).toBe(1)
  })

  it('renders AI badge parts when provided', () => {
    renderHead()
    expect(screen.getByText('AI')).toBeTruthy()
    expect(screen.getByText('2h ago')).toBeTruthy()
    expect(screen.getByText('demo-model')).toBeTruthy()
  })

  it('omits AI badge when not provided', () => {
    renderHead({ aiBadge: undefined })
    expect(screen.queryByText('AI · 2h ago · demo-model')).toBeNull()
  })
})

describe('CardHead — flags', () => {
  it('renders flags with correct tone classes', () => {
    renderHead({
      flags: [
        { label: 'Needs reply', tone: 'danger' },
        { label: 'At risk', tone: 'warn' },
        { label: 'On track', tone: 'success' },
        { label: 'Idle', tone: 'muted' }
      ]
    })
    const el = (label: string): HTMLElement =>
      screen.getByText(label).closest('span') as HTMLElement
    expect(el('Needs reply').className).toContain('is-danger')
    expect(el('At risk').className).toContain('is-warn')
    expect(el('On track').className).toContain('is-success')
    expect(el('Idle').className).toContain('is-muted')
  })

  it('omits flags when none provided', () => {
    renderHead()
    expect(screen.queryByText('Needs reply')).toBeNull()
  })
})

describe('CardHead — sync button', () => {
  it('shows Sync when not syncing', () => {
    renderHead()
    const btn = screen.getByRole('button', { name: 'Sync project' })
    expect(btn.textContent).toBe('Sync')
  })

  it('shows Syncing… and disables when syncing', () => {
    renderHead({ syncing: true })
    const btn = screen.getByRole('button', { name: 'Sync project' })
    expect(btn.textContent).toBe('Syncing…')
    expect((btn as HTMLButtonElement).disabled).toBe(true)
  })

  it('calls onSync when clicked', () => {
    const onSync = vi.fn()
    renderHead({ onSync })
    fireEvent.click(screen.getByRole('button', { name: 'Sync project' }))
    expect(onSync).toHaveBeenCalledTimes(1)
  })
})

describe('CardHead — actions menu', () => {
  it('opens the menu on More click', () => {
    renderHead()
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Aurora storefront' }))
    expect(screen.getByRole('menu', { name: 'Actions for Aurora storefront' })).toBeTruthy()
  })

  it('menu contains Edit project, Project settings, Collapse', () => {
    renderHead()
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Aurora storefront' }))
    expect(screen.getByRole('menuitem', { name: 'Edit project' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Project settings' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Collapse' })).toBeTruthy()
  })

  it('menu contains Delete project when onRemove provided', () => {
    renderHead()
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Aurora storefront' }))
    expect(screen.getByRole('menuitem', { name: 'Delete project' })).toBeTruthy()
  })

  it('calls onEdit when Edit project clicked', () => {
    const onEdit = vi.fn()
    renderHead({ onEdit })
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Aurora storefront' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit project' }))
    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('calls onSettings when Project settings clicked', () => {
    const onSettings = vi.fn()
    renderHead({ onSettings })
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Aurora storefront' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Project settings' }))
    expect(onSettings).toHaveBeenCalledTimes(1)
  })

  it('calls onToggle when Collapse clicked', () => {
    const onToggle = vi.fn()
    renderHead({ onToggle })
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Aurora storefront' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Collapse' }))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('calls onRemove when Delete project clicked', () => {
    const onRemove = vi.fn()
    renderHead({ onRemove })
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Aurora storefront' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete project' }))
    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  it('closes menu on Escape key', () => {
    renderHead()
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Aurora storefront' }))
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes menu when clicking outside', () => {
    renderHead()
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Aurora storefront' }))
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})