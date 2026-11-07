import type { DashboardProjectChatSourceRef } from '../../shared/dashboard-contract'

/**
 * The model cites short ids only. The host owns the id → message mapping, so a
 * reply can never fabricate a channel, a timestamp or a permalink.
 *
 * The marker may be split across stream chunks, so the filter holds back the
 * last few characters until it knows they are not the start of a marker.
 */
const MARKER_RE = /(?:^|\n)\s*(?:\*\*)?SOURCES(?:\*\*)?\s*:?\s*(?:\*\*)?\s*\[/i
const HOLD_BACK = 28

const ID_RE = /^m\d+$/

export function parseSourceIds(tail: string): string[] {
  const arrayText = tail.match(/\[[\s\S]*\]/)?.[0]
  if (!arrayText) return []
  try {
    const parsed = JSON.parse(arrayText) as unknown
    if (!Array.isArray(parsed)) return []
    const ids = parsed.filter(
      (value): value is string => typeof value === 'string' && ID_RE.test(value)
    )
    return [...new Set(ids)]
  } catch {
    return []
  }
}

export class SourceStreamFilter {
  private raw = ''
  private emitted = 0

  private markerIndex(): number | null {
    const match = MARKER_RE.exec(this.raw)
    return match ? match.index : null
  }

  /** Returns the newly safe-to-render text (may be empty). */
  push(chunk: string): string {
    this.raw += chunk
    const marker = this.markerIndex()
    const visibleEnd = marker ?? Math.max(0, this.raw.length - HOLD_BACK)
    if (visibleEnd <= this.emitted) return ''
    const text = this.raw.slice(this.emitted, visibleEnd)
    this.emitted = visibleEnd
    return text
  }

  /** Flush the hold-back and split the answer from its source ids. */
  finish(): { tail: string; content: string; ids: string[] } {
    const marker = this.markerIndex()
    const contentEnd = marker ?? this.raw.length
    const tail = contentEnd > this.emitted ? this.raw.slice(this.emitted, contentEnd) : ''
    this.emitted = contentEnd
    const content = this.raw.slice(0, contentEnd).trimEnd()
    const ids = marker === null ? [] : parseSourceIds(this.raw.slice(marker))
    return { tail, content, ids }
  }
}

export function resolveSourceRefs(
  ids: string[],
  refs: ReadonlyMap<string, DashboardProjectChatSourceRef>,
  limit = 8
): DashboardProjectChatSourceRef[] {
  const out: DashboardProjectChatSourceRef[] = []
  const seen = new Set<string>()
  for (const id of ids) {
    const ref = refs.get(id)
    if (!ref) continue
    const key = `${ref.source}:${ref.channelId}:${ref.ts}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(ref)
    if (out.length >= limit) break
  }
  return out
}
