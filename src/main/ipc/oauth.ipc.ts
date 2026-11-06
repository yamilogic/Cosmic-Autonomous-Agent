import { IpcChannels } from '../../shared/ipc-contract'
import type { ProfileIdPayload } from '../../shared/types'
import { slackClientUrlForTeam } from '../../shared/slack-url'
import type { ProfileStore } from '../profiles/profile-store'
import { connectWorkspaceForProfile, type OauthConfig } from '../slack/oauth-flow'
import type { TokenStore } from '../slack/token-store'
import { handleInvoke } from './handle'

export interface OauthIpcDeps {
  tokenStore: TokenStore
  profileStore: ProfileStore
  getOauthConfig: () => OauthConfig
}

export function registerOauthIpc(deps: OauthIpcDeps): void {
  handleInvoke(IpcChannels.OauthStartWorkspaceConnect, async (payload: ProfileIdPayload) => {
    const link = await connectWorkspaceForProfile(payload.profileId, {
      tokenStore: deps.tokenStore,
      config: deps.getOauthConfig()
    })
    await deps.profileStore.upsertAvailable(payload.profileId, 'slack', {
      teamId: link.teamId,
      teamName: link.teamName,
      openUrl: slackClientUrlForTeam(link.teamId),
      teamDomain: link.teamDomain || undefined
    })
    return link
  })
}
