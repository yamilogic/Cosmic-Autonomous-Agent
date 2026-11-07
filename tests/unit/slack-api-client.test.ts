import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SlackApiClient } from '../../src/main/dashboard/slack-api-client'

describe('SlackApiClient', () => {
  const mockCreds = {
    token: 'xoxc-mock-token-12345',
    cookie: 'xoxd-mock-cookie-67890'
  }

  const originalFetch = global.fetch

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('fetches and normalizes channel messages successfully', async () => {
    const mockResponse = {
      ok: true,
      messages: [
        {
          ts: '1793945569.620039',
          user: 'U12345',
          user_profile: { display_name: 'Ashutosh' },
          text: 'tell me what is the progress of our current project',
          thread_ts: '1793945549.751439'
        },
        {
          ts: '1793945549.751439',
          user: 'U12345',
          user_profile: { display_name: 'Ashutosh' },
          text: 'hiii can we together',
          reply_count: 1
        }
      ],
      has_more: false
    }

    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue(mockResponse)
    } as any)

    const client = new SlackApiClient(mockCreds)
    const result = await client.fetchChannelMessages({
      channelId: 'C0CF72BSYKT',
      sinceTs: 1793880000
    })

    expect(result.messages).toHaveLength(2)
    // Verify ascending chronological order
    expect(result.messages[0].ts).toBe('1793945549.751439')
    expect(result.messages[0].user).toBe('Ashutosh')
    expect(result.messages[0].text).toBe('hiii can we together')
    expect(result.messages[0].replyCount).toBe(1)
    expect(result.messages[1].ts).toBe('1793945569.620039')
    expect(result.messages[1].threadTs).toBe('1793945549.751439')

    // Verify request headers
    const [url, init] = (global.fetch as any).mock.calls[0]
    expect(url).toContain('conversations.history')
    expect(init.headers['Authorization']).toBe(`Bearer ${mockCreds.token}`)
    expect(init.headers['Cookie']).toBe(`d=${mockCreds.cookie}`)
  })

  it('paginates through multiple pages until has_more is false', async () => {
    let callCount = 0
    global.fetch = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return Promise.resolve({
          status: 200,
          json: () =>
            Promise.resolve({
              ok: true,
              messages: [
                {
                  ts: '1793945600.000000',
                  user: 'U123',
                  text: 'Page 1 message'
                }
              ],
              has_more: true,
              response_metadata: { next_cursor: 'cursor-page-2' }
            })
        })
      }
      return Promise.resolve({
        status: 200,
        json: () =>
          Promise.resolve({
            ok: true,
            messages: [
              {
                ts: '1793945500.000000',
                user: 'U123',
                text: 'Page 2 message'
              }
            ],
            has_more: false
          })
      })
    })

    const client = new SlackApiClient(mockCreds)
    const result = await client.fetchChannelMessages({
      channelId: 'C0CF72BSYKT'
    })

    expect(callCount).toBe(2)
    expect(result.messages).toHaveLength(2)
    expect(result.messages[0].text).toBe('Page 2 message')
    expect(result.messages[1].text).toBe('Page 1 message')
  })

  it('throws auth error when Slack responds with not_authed', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({
        ok: false,
        error: 'not_authed'
      })
    } as any)

    const client = new SlackApiClient(mockCreds)
    await expect(
      client.fetchChannelMessages({ channelId: 'C0CF72BSYKT' })
    ).rejects.toThrow('slack conversations.history failed: not_authed')
  })

  it('discovers and sorts public, private, and DM channels using listWorkspaceChannels', async () => {
    const mockChannelsResponse = {
      ok: true,
      channels: [
        {
          id: 'D012345678',
          name: '',
          is_im: true,
          user: 'U0C781CFVLK'
        },
        {
          id: 'C099999999',
          name: 'general',
          is_channel: true,
          is_private: false,
          num_members: 42
        },
        {
          id: 'C088888888',
          name: 'agentworkprojecttesting',
          is_channel: true,
          is_private: true,
          num_members: 3
        }
      ],
      response_metadata: {}
    }

    const mockUsersResponse = {
      ok: true,
      members: [
        {
          id: 'U0C781CFVLK',
          name: 'ashutosh',
          real_name: 'Ashutosh',
          profile: { display_name: 'Ashutosh' }
        }
      ]
    }

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('users.list')) {
        return Promise.resolve({
          status: 200,
          json: () => Promise.resolve(mockUsersResponse)
        })
      }
      return Promise.resolve({
        status: 200,
        json: () => Promise.resolve(mockChannelsResponse)
      })
    })

    const client = new SlackApiClient(mockCreds)
    const channels = await client.listWorkspaceChannels()

    expect(channels).toHaveLength(3)
    // Public & private channels come first alphabetically
    expect(channels[0].name).toBe('agentworkprojecttesting')
    expect(channels[0].kind).toBe('private')
    expect(channels[0].isPrivate).toBe(true)

    expect(channels[1].name).toBe('general')
    expect(channels[1].kind).toBe('public')

    // DM channel has user resolved display name
    expect(channels[2].id).toBe('D012345678')
    expect(channels[2].kind).toBe('dm')
    expect(channels[2].name).toBe('@Ashutosh')
  })

  it('loads workspace users and caches display names', async () => {
    const mockUsersResponse = {
      ok: true,
      members: [
        {
          id: 'U0USER1',
          name: 'alice',
          profile: { display_name: 'Alice W' }
        },
        {
          id: 'U0USER2',
          name: 'bob',
          profile: { real_name: 'Bob Builder' }
        }
      ]
    }

    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve(mockUsersResponse)
    } as any)

    const client = new SlackApiClient(mockCreds)
    const cache = await client.loadWorkspaceUsers()

    expect(cache.get('U0USER1')).toBe('Alice W')
    expect(cache.get('U0USER2')).toBe('Bob Builder')
  })
})

