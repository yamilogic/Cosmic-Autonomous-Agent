import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  DashboardMonitor,
  DashboardTeamWorkspace,
  DashboardTeamWorkspaceConnectPayload,
  DashboardTeamWorkspaceSource
} from '../../shared/dashboard-contract'

/** One team workspace is shared by every card (spec: ticket 04). */
export interface StoredTeamWorkspace {
  profileId: string
  teamId: string
  teamName: string
  teamDomain?: string
  source: 'oauth' | 'manual'
  /** safeStorage ciphertext (base64). Absent for an OAuth connection. */
  tokenEnc?: string
  /** Legacy only: a token an older build wrote before saves were blocked. */
  tokenPlain?: string
  /** Mask shown in the UI ("••••abcd") — never the raw token. */
  maskedToken: string | null
  status?: 'connected' | 'needs-reconnect'
  lastVerifiedAt?: string
  channels: DashboardMonitor[]
  updatedAt: string
}

export interface TeamWorkspaceConnection {
  profileId: string
  teamId: string
  teamName: string
  teamDomain: string | null
  source: 'oauth' | 'manual'
  status: 'connected' | 'needs-reconnect'
  lastVerifiedAt: string | null
  /** Raw token for a manual connection; null when the token lives in TokenStore. */
  token: string | null
  channels: DashboardMonitor[]
}

interface TeamWorkspaceFile {
  workspace?: StoredTeamWorkspace
}

interface EncryptedVault {
  encrypt(plain: string): string
  decrypt(b64: string): string
}

let vault: EncryptedVault | null = null

async function getVault(): Promise<EncryptedVault> {
  if (!vault) {
    const { safeStorage } = (await import('electron')) as typeof import('electron')
    vault = {
      encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
      decrypt: (b64) => safeStorage.decryptString(Buffer.from(b64, 'base64'))
    }
  }
  return vault
}

/** A token never leaves the process, so the UI only ever gets this shape. */
export function maskToken(token: string | null): string | null {
  if (!token) return null
  return token.length <= 8 ? '••••' : `••••${token.slice(-4)}`
}

const UNCONNECTED: DashboardTeamWorkspace = {
  connected: false,
  profileId: null,
  teamId: null,
  teamName: null,
  teamDomain: null,
  source: 'none',
  maskedToken: null,
  status: 'needs-reconnect',
  lastVerifiedAt: null,
  channels: [],
  updatedAt: null
}

/**
 * The globally connected "our team" Slack workspace: connection facts plus the
 * pinned channel set. The secret is encrypted with safeStorage; with no OS
 * encryption available the connect is refused outright — a token is never
 * written as plaintext.
 */
export class TeamWorkspaceStore {
  private readonly filePath: string
  private readonly encryptionAvailable: boolean
  private readonly vault: EncryptedVault | undefined
  private queue: Promise<void> = Promise.resolve()

  constructor(options: {
    rootDir: string
    encryptionAvailable: boolean
    /** Test seam: production leaves this out and uses Electron safeStorage. */
    vault?: EncryptedVault
  }) {
    this.filePath = join(options.rootDir, 'team-workspace.json')
    this.encryptionAvailable = options.encryptionAvailable
    this.vault = options.vault
  }

  /** Mask-only view for the renderer. */
  async readPublic(): Promise<DashboardTeamWorkspace> {
    const ws = (await this.read()).workspace
    if (!ws) return UNCONNECTED
    return {
      connected: true,
      profileId: ws.profileId,
      teamId: ws.teamId,
      teamName: ws.teamName,
      teamDomain: ws.teamDomain ?? null,
      source: ws.source as DashboardTeamWorkspaceSource,
      maskedToken: ws.maskedToken,
      status: ws.status ?? 'connected',
      lastVerifiedAt: ws.lastVerifiedAt ?? null,
      channels: ws.channels,
      updatedAt: ws.updatedAt
    }
  }

  /** What sync/chat needs: where the workspace is and the channels pinned to it. */
  async getConnection(): Promise<TeamWorkspaceConnection | null> {
    const ws = (await this.read()).workspace
    if (!ws) return null
    return {
      profileId: ws.profileId,
      teamId: ws.teamId,
      teamName: ws.teamName,
      teamDomain: ws.teamDomain ?? null,
      source: ws.source,
      status: ws.status ?? 'connected',
      lastVerifiedAt: ws.lastVerifiedAt ?? null,
      token: await this.readToken(ws),
      channels: ws.channels
    }
  }

  /** Connect (or reconnect — the old record is replaced, never accumulated). */
  async connect(input: {
    payload: DashboardTeamWorkspaceConnectPayload
    teamId: string
    teamName: string
    teamDomain?: string | null
    profileId: string
    /** For an OAuth connection the token itself stays in TokenStore; only its mask is stored. */
    token?: string
    maskedToken?: string | null
    channels?: DashboardMonitor[]
    status?: 'connected' | 'needs-reconnect'
    now?: string
  }): Promise<DashboardTeamWorkspace> {
    if (input.token && !this.encryptionAvailable) {
      throw new Error('OS encryption unavailable')
    }
    const encrypted = input.token ? await this.encrypt(input.token) : null
    const now = input.now ?? new Date().toISOString()
    const record: StoredTeamWorkspace = {
      profileId: input.profileId,
      teamId: input.teamId,
      teamName: input.teamName,
      teamDomain: input.teamDomain ?? undefined,
      source: input.payload.source,
      ...(encrypted ? { tokenEnc: encrypted } : {}),
      maskedToken: input.maskedToken ?? maskToken(input.token ?? null),
      status: input.status ?? 'connected',
      lastVerifiedAt: now,
      channels: input.channels ?? [],
      updatedAt: now
    }
    await this.mutate(() => ({ workspace: record }))
    return this.readPublic()
  }

  /** Update token health without touching the secret or the pinned channels. */
  async setStatus(
    status: 'connected' | 'needs-reconnect',
    atIso = new Date().toISOString()
  ): Promise<DashboardTeamWorkspace> {
    let found = false
    await this.mutate((current) => {
      if (!current.workspace) return current
      found = true
      return {
        workspace: {
          ...current.workspace,
          status,
          lastVerifiedAt: atIso
        }
      }
    })
    if (!found) return this.readPublic()
    return this.readPublic()
  }

  /** Re-pin without reconnecting. Never touches the secret. */
  async setChannels(channels: DashboardMonitor[]): Promise<DashboardTeamWorkspace> {
    let found = false
    await this.mutate((current) => {
      if (!current.workspace) return current
      found = true
      return {
        workspace: {
          ...current.workspace,
          channels,
          updatedAt: new Date().toISOString()
        }
      }
    })
    if (!found) throw new Error('No team workspace is connected yet.')
    return this.readPublic()
  }

  /** Disconnect: removes the record and its secret with it. */
  async clear(): Promise<void> {
    await this.mutate(() => ({}))
  }

  private async readToken(ws: StoredTeamWorkspace): Promise<string | null> {
    if (!this.encryptionAvailable) return ws.tokenPlain ?? null
    if (!ws.tokenEnc) return ws.tokenPlain ?? null
    try {
      return (await this.activeVault()).decrypt(ws.tokenEnc.replace(/[\r\n]/g, ''))
    } catch {
      return ws.tokenPlain ?? null
    }
  }

  private async encrypt(token: string): Promise<string> {
    if (!this.encryptionAvailable) throw new Error('OS encryption unavailable')
    return (await this.activeVault()).encrypt(token)
  }

  /**
   * A token an older build left as plaintext is sealed and re-saved once the OS
   * vault is available. Returns 1 when a record was rewritten, else 0.
   */
  async migrateLegacyPlaintext(): Promise<number> {
    if (!this.encryptionAvailable) return 0
    const legacy = (await this.read()).workspace?.tokenPlain
    if (!legacy) return 0
    const sealed = await this.encrypt(legacy)
    await this.mutate((current) => {
      const ws = current.workspace
      if (!ws?.tokenPlain) return current
      return { workspace: { ...ws, tokenEnc: sealed, tokenPlain: undefined } }
    })
    return 1
  }

  private async activeVault(): Promise<EncryptedVault> {
    return this.vault ?? getVault()
  }

  private async mutate(fn: (current: TeamWorkspaceFile) => TeamWorkspaceFile): Promise<void> {
    const run = async (): Promise<void> => {
      const next = fn(await this.read())
      await mkdir(join(this.filePath, '..'), { recursive: true })
      const tmpPath = `${this.filePath}.tmp`
      await writeFile(tmpPath, JSON.stringify(next, null, 2), 'utf8')
      await rename(tmpPath, this.filePath)
    }
    this.queue = this.queue.then(run, run)
    return this.queue
  }

  private async read(): Promise<TeamWorkspaceFile> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as TeamWorkspaceFile
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }
}
