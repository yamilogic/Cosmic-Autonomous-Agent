import { describe, expect, it } from 'vitest'
import { appLabel, sanitizeWorkspaceName, sidebarAppLabel } from '../../src/shared/types'

describe('sidebar app labels', () => {
  it('shows Slack for the Slack platform row in the sidebar', () => {
    expect(sidebarAppLabel('slack')).toBe('Slack')
    expect(sidebarAppLabel('teams')).toBe('Teams')
    expect(sidebarAppLabel('whatsapp')).toBe('WhatsApp')
  })

  it('sanitizes titles with channel prefixes or slack suffixes', () => {
    expect(
      sanitizeWorkspaceName('all-testing-workspace-1 (Channel) - Testing Workspace 1')
    ).toBe('Testing Workspace 1')
    expect(
      sanitizeWorkspaceName('all-unknown (Channel) - unknown')
    ).toBe('unknown')
    expect(
      sanitizeWorkspaceName('Acme Team | Slack')
    ).toBe('Acme Team')
  })

  it('keeps the other app names unchanged', () => {
    expect(sidebarAppLabel('teams')).toBe('Teams')
    expect(sidebarAppLabel('whatsapp')).toBe('WhatsApp')
  })

  it('keeps the real app name for the app picker and command palette', () => {
    expect(appLabel('slack')).toBe('Slack')
  })
})
