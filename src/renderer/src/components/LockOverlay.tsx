import { APP_DISPLAY_NAME } from '../../../shared/brand'

interface LockOverlayProps {
  unlocking: boolean
  onUnlock: () => void
}

export function LockOverlay({ unlocking, onUnlock }: LockOverlayProps): React.JSX.Element {
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPod|iPad/.test(navigator.platform || navigator.userAgent)
  const promptText = isMac ? 'Locked. Use Touch ID to continue.' : 'Locked. Authenticate to continue.'
  const waitingText = isMac ? 'Waiting for Touch ID…' : 'Authenticating…'

  return (
    <div className="lock-overlay" role="dialog" aria-label="App locked">
      <div className="lock-card">
        <h1>{APP_DISPLAY_NAME}</h1>
        <p>{promptText}</p>
        <button type="button" className="btn primary" disabled={unlocking} onClick={onUnlock}>
          {unlocking ? waitingText : 'Unlock'}
        </button>
      </div>
    </div>
  )
}
