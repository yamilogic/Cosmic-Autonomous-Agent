export function formatUnreadBadge(n: number): string {
  if (n <= 0) return ''
  if (n > 99) return '99+'
  return String(n)
}

export function unreadKey(profileId: string, appId: string): string {
  return `${profileId}:${appId}`
}
