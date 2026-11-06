import type { AppId, AppSessionStatus, Profile } from '../../../shared/types'
import { APP_IDS, appLabel, appSupportsWorkspaces } from '../../../shared/types'
import { resolveProfileAvatarSrc } from '../lib/profile-avatar'
import { AppIcon } from './AppIcon'

interface AppPickerProps {
  profile: Profile
  onSelectApp: (appId: AppId) => void
  onSignIn: (appId: AppId) => void
}

function statusLabel(status: AppSessionStatus): string {
  switch (status) {
    case 'signed-in':
      return 'Ready'
    case 'signing-in':
    case 'signing-in-google':
    case 'signing-in-slack':
      return 'Signing in…'
    default:
      return 'Not signed in'
  }
}

function authHint(appId: AppId): string {
  if (appId === 'teams') {
    return 'Sign in with your Microsoft work or school account'
  }
  if (appId === 'whatsapp') {
    return 'Scan the QR code with WhatsApp on your phone to link this profile'
  }
  return 'Sign in to Slack in real Chrome (same browser as Google), then embed'
}

function signInCta(appId: AppId): string {
  if (appId === 'teams') {
    return 'Sign in with Microsoft'
  }
  if (appId === 'whatsapp') {
    return 'Link with QR code'
  }
  return 'Sign in to Slack'
}

export function AppPicker({ profile, onSelectApp, onSignIn }: AppPickerProps): React.JSX.Element {
  const avatarSrc = resolveProfileAvatarSrc(
    profile.displayName,
    profile.avatarColor,
    profile.avatarUrl
  )

  return (
    <section className="app-picker" aria-label="Available apps">
      <header className="app-picker-header">
        <div className="app-picker-identity">
          <img
            className="app-picker-avatar"
            src={avatarSrc}
            alt=""
            width={48}
            height={48}
            draggable={false}
          />
          <div className="app-picker-identity-text">
            <p className="app-picker-kicker">Choose an app</p>
            <h2>{profile.displayName}</h2>
            <p className="app-picker-lead">
              {profile.googleAuthStatus === 'signed-in'
                ? profile.apps.slack.sessionStatus === 'signed-in'
                  ? 'Slack is ready. Open Slack, Teams, or WhatsApp from here or the sidebar.'
                  : 'Google is signed in. Choose Slack to continue in the same Chrome browser, then embed.'
                : profile.googleAuthStatus === 'signing-in'
                  ? 'Finish Google sign-in in the Chrome popup, then Continue.'
                  : 'Add a profile with your Google email to start.'}
            </p>
          </div>
        </div>
      </header>

      <div className="app-picker-grid">
        {APP_IDS.map((appId) => {
          const session = profile.apps[appId]
          const signedIn = session.sessionStatus === 'signed-in'
          const signing =
            session.sessionStatus === 'signing-in' ||
            session.sessionStatus === 'signing-in-google' ||
            session.sessionStatus === 'signing-in-slack'
          const pinned = session.pinnedWorkspaces.length
          const available = session.availableWorkspaces.length
          const cta = signedIn ? `Open ${appLabel(appId)}` : signInCta(appId)
          const showWorkspaceStats = appSupportsWorkspaces(appId)

          return (
            <article
              key={appId}
              className={`app-tile app-tile--${appId}${signedIn ? ' is-ready' : ''}${signing ? ' is-busy' : ''}`}
            >
              <div className="app-tile-top">
                <div className={`app-tile-logo app-tile-logo--${appId}`}>
                  <AppIcon appId={appId} size={40} />
                </div>
                {signedIn ? (
                  <span
                    className="status-tick status-tick--lg"
                    title="Signed in"
                    aria-label="Signed in"
                  >
                    <svg viewBox="0 0 16 16" aria-hidden>
                      <circle cx="8" cy="8" r="8" className="status-tick-fill" />
                      <path
                        className="status-tick-check"
                        d="M4.4 8.2l2.2 2.2 5-5"
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                ) : (
                  <span
                    className={`app-tile-badge session-badge session-badge--${session.sessionStatus}`}
                  >
                    {statusLabel(session.sessionStatus)}
                  </span>
                )}
              </div>

              <h3 className="app-tile-title">{appLabel(appId)}</h3>
              <p className="app-tile-desc">{authHint(appId)}</p>

              {showWorkspaceStats ? (
                <ul className="app-tile-stats" aria-label={`${appLabel(appId)} workspace counts`}>
                  <li>
                    <strong>{available}</strong>
                    <span>Available</span>
                  </li>
                  <li>
                    <strong>{pinned}</strong>
                    <span>Pinned</span>
                  </li>
                </ul>
              ) : (
                <p className="app-tile-session-note">One linked phone session per profile</p>
              )}

              <button
                type="button"
                className={`btn app-tile-cta${signedIn ? ' primary' : ' app-tile-cta--auth'}`}
                disabled={signing}
                onClick={() => {
                  if (signedIn) {
                    onSelectApp(appId)
                  } else {
                    onSignIn(appId)
                  }
                }}
              >
                {signing ? (appId === 'whatsapp' ? 'Waiting for QR…' : 'Signing in…') : cta}
              </button>
            </article>
          )
        })}
      </div>
    </section>
  )
}
