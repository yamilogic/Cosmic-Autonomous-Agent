import { useState } from 'react'
import { APP_DISPLAY_NAME } from '../../../shared/brand'
import appIcon from '../assets/app-icon.png'

interface AdminLoginOverlayProps {
  configured: boolean
  envPathHint: string
  onSuccess: () => void
}

export function AdminLoginOverlay({
  configured,
  envPathHint,
  onSuccess
}: AdminLoginOverlayProps): React.JSX.Element {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    void window.api.app
      .adminLogin(username, password, remember)
      .then((result) => {
        if (result.ok) {
          onSuccess()
          return
        }
        setError(result.message)
      })
      .finally(() => setBusy(false))
  }

  return (
    <div className="admin-login-overlay" role="dialog" aria-label="Admin login">
      <form className="admin-login-card" onSubmit={submit}>
        <img className="admin-login-logo" src={appIcon} alt="" />
        <h1>{APP_DISPLAY_NAME}</h1>
        <p className="admin-login-sub">Admin sign-in required</p>

        {!configured ? (
          <p className="admin-login-error" role="alert">
            Copy your project <code>.env</code> (with <code>ADMIN_USERNAME</code> /{' '}
            <code>ADMIN_PASSWORD</code>) to:
            <br />
            <code className="admin-login-path">{envPathHint}</code>
            <br />
            then restart the app.
          </p>
        ) : null}

        <label className="admin-login-field">
          <span>Username</span>
          <input
            type="text"
            name="username"
            autoComplete="username"
            autoFocus
            disabled={!configured || busy}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>

        <label className="admin-login-field">
          <span>Password</span>
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            disabled={!configured || busy}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        <label className="admin-login-remember">
          <input
            type="checkbox"
            checked={remember}
            disabled={!configured || busy}
            onChange={(e) => setRemember(e.target.checked)}
          />
          <span>Remember me until I sign out</span>
        </label>

        {error ? (
          <p className="admin-login-error" role="alert">
            {error}
          </p>
        ) : null}

        <button type="submit" className="btn primary" disabled={!configured || busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
