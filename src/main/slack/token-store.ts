import { promises as fs } from 'fs'
import { dirname, join } from 'path'
import { safeStorage } from 'electron'
import type { SlackWorkspaceLink } from '../../shared/types'

interface StoredTokenRecord {
  profileId: string
  teamId: string
  encrypted: string
}

interface TokenFile {
  tokens: StoredTokenRecord[]
  workspaces: SlackWorkspaceLink[]
}

export interface TokenStoreOptions {
  filePath: string
}

export class TokenStore {
  private readonly filePath: string

  constructor(options: TokenStoreOptions) {
    this.filePath = options.filePath
  }

  async save(
    profileId: string,
    teamId: string,
    token: string,
    workspace: SlackWorkspaceLink
  ): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('OS-level encryption unavailable on this machine')
    }

    const encrypted = safeStorage.encryptString(token).toString('base64')
    const data = await this.read()

    data.tokens = data.tokens.filter((t) => !(t.profileId === profileId && t.teamId === teamId))
    data.tokens.push({ profileId, teamId, encrypted })

    data.workspaces = data.workspaces.filter(
      (w) => !(w.profileId === profileId && w.teamId === teamId)
    )
    data.workspaces.push(workspace)

    await this.write(data)
  }

  async get(profileId: string, teamId: string): Promise<string> {
    const token = await this.tryGet(profileId, teamId)
    if (!token) {
      throw new Error(`No token for profile=${profileId} team=${teamId}`)
    }
    return token
  }

  /** Returns null when this profile/team was never API-connected (pinned-only is OK). */
  async tryGet(profileId: string, teamId: string): Promise<string | null> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('OS-level encryption unavailable on this machine')
    }

    const data = await this.read()
    const record = data.tokens.find((t) => t.profileId === profileId && t.teamId === teamId)
    if (!record) {
      return null
    }
    return safeStorage.decryptString(Buffer.from(record.encrypted, 'base64'))
  }

  async listWorkspaces(profileId: string): Promise<SlackWorkspaceLink[]> {
    const data = await this.read()
    return data.workspaces.filter((w) => w.profileId === profileId)
  }

  async deleteForProfile(profileId: string): Promise<void> {
    const data = await this.read()
    data.tokens = data.tokens.filter((t) => t.profileId !== profileId)
    data.workspaces = data.workspaces.filter((w) => w.profileId !== profileId)
    await this.write(data)
  }

  async deleteWorkspace(profileId: string, teamId: string): Promise<void> {
    const data = await this.read()
    data.tokens = data.tokens.filter((t) => !(t.profileId === profileId && t.teamId === teamId))
    data.workspaces = data.workspaces.filter(
      (w) => !(w.profileId === profileId && w.teamId === teamId)
    )
    await this.write(data)
  }

  private async read(): Promise<TokenFile> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<TokenFile>
      return {
        tokens: Array.isArray(parsed.tokens) ? parsed.tokens : [],
        workspaces: Array.isArray(parsed.workspaces) ? parsed.workspaces : []
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        return { tokens: [], workspaces: [] }
      }
      throw err
    }
  }

  private async write(data: TokenFile): Promise<void> {
    await fs.mkdir(dirname(this.filePath), { recursive: true })
    await fs.writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf8')
  }
}

export function defaultTokenStorePath(userDataPath: string): string {
  return join(userDataPath, 'secure', 'tokens.json')
}
