/** Platform-correct keyboard labels; macOS gets glyphs, everything else Ctrl. */
export function modKeyFor(platform: string): string {
  return /^Mac/i.test(platform) ? '⌘' : 'Ctrl+'
}

export function modShiftFor(platform: string): string {
  return /^Mac/i.test(platform) ? '⌘⇧' : 'Ctrl+Shift+'
}

export function modKey(): string {
  return modKeyFor(typeof navigator === 'undefined' ? '' : navigator.platform)
}

export function modShift(): string {
  return modShiftFor(typeof navigator === 'undefined' ? '' : navigator.platform)
}
