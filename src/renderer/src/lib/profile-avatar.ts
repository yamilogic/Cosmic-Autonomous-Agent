/** Local circular avatar from initials (no network). Optional photo URL when available. */
export function profileInitial(displayName: string): string {
  const trimmed = displayName.trim()
  if (!trimmed) {
    return '?'
  }
  const at = trimmed.indexOf('@')
  const base = at > 0 ? trimmed.slice(0, at) : trimmed
  const parts = base.split(/[.\s_-]+/).filter(Boolean)
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase()
  }
  return base.slice(0, 1).toUpperCase()
}

export function buildInitialAvatarDataUrl(displayName: string, color: string): string {
  const letter = profileInitial(displayName).slice(0, 2)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72">
  <circle cx="36" cy="36" r="36" fill="${color}"/>
  <text x="36" y="36" dy="0.35em" text-anchor="middle" fill="#fff" font-family="Satoshi, system-ui, sans-serif" font-size="${letter.length > 1 ? 26 : 30}" font-weight="700">${letter}</text>
</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export function resolveProfileAvatarSrc(
  displayName: string,
  avatarColor: string,
  avatarUrl?: string
): string {
  if (avatarUrl?.trim()) {
    return avatarUrl.trim()
  }
  return buildInitialAvatarDataUrl(displayName, avatarColor)
}
