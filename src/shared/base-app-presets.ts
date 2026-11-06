export interface BaseAppPresetItem {
  id: string
  name: string
  type: 'app' | 'link'
  appId?: 'slack' | 'teams' | 'whatsapp'
  url?: string
  icon?: string
}

export type BaseAppLayoutKey = 'none' | 'standard' | 'extended' | 'full'

export const BASE_APP_PRESETS: Record<BaseAppLayoutKey, BaseAppPresetItem[]> = {
  none: [],
  standard: [
    { id: 'slack', name: 'Slack', type: 'app', appId: 'slack', icon: '💬' },
    { id: 'teams', name: 'Microsoft Teams', type: 'app', appId: 'teams', icon: '👥' },
    { id: 'whatsapp', name: 'WhatsApp', type: 'app', appId: 'whatsapp', icon: '📱' }
  ],
  extended: [
    { id: 'slack', name: 'Slack', type: 'app', appId: 'slack', icon: '💬' },
    { id: 'teams', name: 'Microsoft Teams', type: 'app', appId: 'teams', icon: '👥' },
    { id: 'whatsapp', name: 'WhatsApp', type: 'app', appId: 'whatsapp', icon: '📱' },
    { id: 'claude', name: 'Claude', type: 'link', url: 'https://claude.ai', icon: '🤖' },
    { id: 'chatgpt', name: 'ChatGPT', type: 'link', url: 'https://chatgpt.com', icon: '✨' }
  ],
  full: [
    { id: 'slack', name: 'Slack', type: 'app', appId: 'slack', icon: '💬' },
    { id: 'teams', name: 'Microsoft Teams', type: 'app', appId: 'teams', icon: '👥' },
    { id: 'whatsapp', name: 'WhatsApp', type: 'app', appId: 'whatsapp', icon: '📱' },
    { id: 'claude', name: 'Claude', type: 'link', url: 'https://claude.ai', icon: '🤖' },
    { id: 'chatgpt', name: 'ChatGPT', type: 'link', url: 'https://chatgpt.com', icon: '✨' },
    { id: 'perplexity', name: 'Perplexity', type: 'link', url: 'https://perplexity.ai', icon: '🔍' },
    { id: 'github', name: 'GitHub', type: 'link', url: 'https://github.com', icon: '🐙' },
    { id: 'notion', name: 'Notion', type: 'link', url: 'https://notion.so', icon: '📝' },
    { id: 'linear', name: 'Linear', type: 'link', url: 'https://linear.app', icon: '📐' }
  ]
}

export function getBaseLayoutItems(layout: BaseAppLayoutKey = 'standard'): BaseAppPresetItem[] {
  return BASE_APP_PRESETS[layout] ?? BASE_APP_PRESETS.standard
}

