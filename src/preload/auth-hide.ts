/**
 * Minimal preload for Google/Slack auth BrowserWindows.
 * Hides common automation fingerprints Google checks for.
 */
try {
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,
    configurable: true
  })
} catch {
  /* ignore */
}

try {
  // Electron sometimes exposes chrome.runtime oddly; keep a minimal chrome object.
  const w = window as Window & { chrome?: { runtime?: unknown } }
  if (!w.chrome) {
    w.chrome = { runtime: {} }
  } else if (w.chrome.runtime === undefined) {
    w.chrome.runtime = {}
  }
} catch {
  /* ignore */
}
