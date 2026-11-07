import { describe, expect, it } from 'vitest'
import { computePrefill, canLeaveStep } from '../../src/renderer/src/hooks/dashboard-wizard-core'

const valid = {
  valid: true,
  teamName: 'Testing Workspace 1',
  userName: 'rajeshknp00'
}

describe('dashboard-wizard-core', () => {
  it('computes prefills from validation facts', () => {
    const p = computePrefill(valid, 'DASH_TOKEN_OTHER_WS')
    expect(p.projectName).toBe('Testing Workspace 1')
    expect(p.clientName).toBe('rajeshknp00')
    expect(p.vaultKeySuggestion).toBe('DASH_TOKEN_TESTING_WORKSPACE_1')
    expect(p.presetKey).toBe('DASH_TOKEN_OTHER_WS')
  })

  it('suggest-safe vault key normalizes spaces/invalid chars', () => {
    const p = computePrefill({ valid: true, teamName: 'Client X & Co! ' }, '')
    expect(p.vaultKeySuggestion).toBe('DASH_TOKEN_CLIENT_X_CO')
  })

  it('step gates: cannot leave step1 without validated token', () => {
    expect(canLeaveStep(1, { validated: false, projectAvailable: undefined })).toBe(false)
    expect(canLeaveStep(1, { validated: true, projectAvailable: true })).toBe(true)
  })

  it('step gates: cannot leave step3 without a project', () => {
    expect(canLeaveStep(3, { validated: true })).toBe(false)
    expect(canLeaveStep(3, { validated: true, projectAvailable: true })).toBe(true)
  })

  it('scope warning only when required scopes are missing', () => {
    const has = ['channels:read', 'channels:history', 'groups:read', 'groups:history', 'team:read']
    const missing = computePrefill(valid, '', has)
    expect(missing.missingScopes).toEqual([
      'users:read',
      'users.profile:read',
      'im:read',
      'im:history',
      'mpim:read',
      'mpim:history',
      'emoji:read'
    ])
    const full = computePrefill(valid, '', [
      ...has,
      'users:read',
      'users.profile:read',
      'im:read',
      'im:history',
      'mpim:read',
      'mpim:history',
      'emoji:read'
    ])
    expect(full.missingScopes).toEqual([])
  })
})
