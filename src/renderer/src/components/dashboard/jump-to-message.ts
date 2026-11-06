/**
 * A one-shot hand-off from a source chip (chat, and later Dashboard attention
 * rows) to the Slack tab. Navigation always happens; the jump is progressive:
 * if the message is not in the loaded page, the reader still lands in the
 * channel.
 */
import type { DashboardSource } from '../../../../shared/dashboard-contract'

export interface MessageJumpTarget {
  projectId: string
  source: DashboardSource
  channelId: string
  ts: string
}

let pending: MessageJumpTarget | null = null

export function requestMessageJump(target: MessageJumpTarget): void {
  pending = { ...target }
}

export function clearMessageJump(): void {
  pending = null
}

/** Consumes the target only when it belongs to this project/source/channel. */
export function takeMessageJump(
  projectId: string,
  source: DashboardSource,
  channelId: string | undefined
): string | null {
  if (!pending || !channelId) return null
  if (
    pending.projectId !== projectId ||
    pending.source !== source ||
    pending.channelId !== channelId
  ) {
    return null
  }
  const ts = pending.ts
  pending = null
  return ts
}

function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/** Scrolls the matching `[data-ts]` row into view and flashes it briefly. */
export function scrollToMessage(container: HTMLElement | null, ts: string): boolean {
  if (!container) return false
  const rows = container.querySelectorAll<HTMLElement>('[data-ts]')
  let match: HTMLElement | null = null
  for (const row of rows) {
    if (row.dataset.ts === ts) {
      match = row
      break
    }
  }
  if (!match) return false
  match.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' })
  match.classList.add('is-jump-flash')
  window.setTimeout(() => match?.classList.remove('is-jump-flash'), 1600)
  match.focus({ preventScroll: true })
  return true
}
