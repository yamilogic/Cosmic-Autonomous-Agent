import type { SlackChannelSummary, SlackMessageSummary } from '../../shared/types'
import { SlackApiError } from './types'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface SlackListChannelsResponse {
  ok: boolean
  error?: string
  channels?: Array<{
    id: string
    name: string
    is_private?: boolean
    created?: number
    topic?: { value?: string }
    num_members?: number
  }>
  response_metadata?: { next_cursor?: string }
}

interface SlackHistoryResponse {
  ok: boolean
  error?: string
  messages?: Array<{ ts: string; user?: string; text?: string }>
  response_metadata?: { next_cursor?: string }
}

interface SlackTeamInfoResponse {
  ok: boolean
  error?: string
  team?: { id: string; name: string; domain?: string }
}

async function callSlack<T extends { ok: boolean; error?: string }>(
  method: string,
  token: string,
  params: Record<string, string>
): Promise<T> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams(params)
  })

  const body = (await res.json()) as T
  if (!body.ok) {
    if (body.error === 'ratelimited') {
      const retryAfter = Number(res.headers.get('Retry-After') ?? '1')
      await sleep(retryAfter * 1000)
      return callSlack(method, token, params)
    }
    throw new SlackApiError(body.error ?? 'unknown_error', method)
  }
  return body
}

function toChannelSummary(
  channel: NonNullable<SlackListChannelsResponse['channels']>[number]
): SlackChannelSummary {
  return {
    id: channel.id,
    name: channel.name,
    isPrivate: Boolean(channel.is_private),
    topic: channel.topic?.value || undefined,
    created: channel.created,
    memberCount: channel.num_members
  }
}

export async function listChannels(token: string): Promise<SlackChannelSummary[]> {
  const channels: SlackChannelSummary[] = []
  let cursor: string | undefined

  do {
    const params: Record<string, string> = {
      types: 'public_channel,private_channel',
      exclude_archived: 'true',
      limit: '200'
    }
    if (cursor) {
      params.cursor = cursor
    }

    const res = await callSlack<SlackListChannelsResponse>('conversations.list', token, params)
    for (const channel of res.channels ?? []) {
      channels.push(toChannelSummary(channel))
    }
    cursor = res.response_metadata?.next_cursor || undefined
  } while (cursor)

  return channels
}

export async function listMessages(
  token: string,
  channelId: string,
  limit = 50
): Promise<SlackMessageSummary[]> {
  const res = await callSlack<SlackHistoryResponse>('conversations.history', token, {
    channel: channelId,
    limit: String(limit)
  })

  return (res.messages ?? []).map((m) => ({
    ts: m.ts,
    user: m.user,
    text: m.text ?? ''
  }))
}

export async function getTeamInfo(
  token: string
): Promise<{ id: string; name: string; domain?: string }> {
  const res = await callSlack<SlackTeamInfoResponse>('team.info', token, {})
  if (!res.team) {
    throw new SlackApiError('missing_team', 'team.info')
  }
  return res.team
}

/** Exported for unit tests — do not call from IPC handlers. */
export const __test__ = { callSlack, toChannelSummary }
