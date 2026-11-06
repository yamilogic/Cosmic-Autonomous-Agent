/** Pure helpers for the add-project wizard (ADR-0007; additive to existing pieces). */
export interface WizardValidation {
  valid: boolean
  teamName?: string
  userName?: string
  scopes?: string[]
}

export interface WizardPrefill {
  projectName: string
  clientName: string
  vaultKeySuggestion: string
  presetKey: string
  missingScopes: string[]
}

export const REQUIRED_SCOPES = [
  'channels:read',
  'channels:history',
  'groups:read',
  'groups:history',
  'team:read',
  'users:read',
  'users.profile:read',
  'im:read',
  'im:history',
  'mpim:read',
  'mpim:history',
  'emoji:read'
] as const

/** Scopes the dashboard can gracefully degrade without (base 5 only). */
const OPTIONAL_SCOPE_GROUP: ReadonlySet<string> = new Set([
  'users:read',
  'users.profile:read',
  'im:read',
  'im:history',
  'mpim:read',
  'mpim:history',
  'emoji:read'
])

function titleCaseWord(w: string): string {
  return w.charAt(0).toUpperCase() + w.slice(1)
}

export function computePrefill(
  validation: WizardValidation,
  presetKey: string,
  granted?: string[]
): WizardPrefill {
  const team = (validation.teamName ?? '').trim()
  const user = (validation.userName ?? '').trim()
  const vaultKeySuggestion = team
    ? 'DASH_TOKEN_' +
      team
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .split('_')
        .filter(Boolean)
        .map(titleCaseWord)
        .join('_')
    : presetKey

  const grantedSet = new Set(granted ?? validation.scopes ?? [])
  const missingScopes = Array.from(OPTIONAL_SCOPE_GROUP).filter((s) => !grantedSet.has(s))

  return {
    projectName: team || presetKey.split('_').slice(2).map(titleCaseWord).join(' '),
    clientName: user || team,
    vaultKeySuggestion,
    presetKey,
    missingScopes
  }
}

export function canLeaveStep(
  step: 1 | 2 | 3,
  state: { validated?: boolean; projectAvailable?: boolean }
): boolean {
  if (step === 1) return state.validated === true
  if (step === 2) return true
  return state.projectAvailable === true
}

/** Mask a real token for display: keep prefix + 4+4 tail. */
export function maskToken(token: string): string {
  if (token.length < 14) return '•'.repeat(token.length)
  return `${token.slice(0, 9)}…${token.slice(-4)}`
}
