/** Coalesce high-frequency callbacks to one paint frame; skip identical payloads. */
export function createRafThrottle<T extends (...args: never[]) => void>(
  fn: T
): T & { cancel: () => void } {
  let frame = 0
  let latest: Parameters<T> | null = null
  const run = ((...args: Parameters<T>) => {
    latest = args
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      if (!latest) return
      const payload = latest
      latest = null
      fn(...payload)
    })
  }) as T & { cancel: () => void }
  run.cancel = () => {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    latest = null
  }
  return run
}

export function boundsEqual(
  a: { x: number; y: number; width: number; height: number } | null,
  b: { x: number; y: number; width: number; height: number }
): boolean {
  if (!a) return false
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}
