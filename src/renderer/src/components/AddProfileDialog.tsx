import { useState, type FormEvent } from 'react'

interface AddProfileDialogProps {
  open: boolean
  onClose: () => void
  onSubmit: (displayName: string) => Promise<void>
}

export function AddProfileDialog({
  open,
  onClose,
  onSubmit
}: AddProfileDialogProps): React.JSX.Element | null {
  const [displayName, setDisplayName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  if (!open) {
    return null
  }

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!displayName.trim()) {
      setLocalError('Email or name is required')
      return
    }
    setSubmitting(true)
    setLocalError(null)
    try {
      await onSubmit(displayName.trim())
      setDisplayName('')
      if (open) {
        onClose()
      }
    } catch (err) {
      setLocalError(String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-profile-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="add-profile-title">Add profile</h2>
        <p className="dialog-hint">
          Enter the Google email for this profile. Real Chrome opens locked inside the right pane
          for Google, then again for Slack (same browser). After Slack, it embeds in the app.
        </p>
        <form onSubmit={(e) => void handleSubmit(e)}>
          <label htmlFor="profile-name">Google email</label>
          <input
            id="profile-name"
            autoFocus
            type="email"
            inputMode="email"
            autoComplete="email"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="name@gmail.com"
            disabled={submitting}
          />
          {localError ? <p className="error-text">{localError}</p> : null}
          <div className="dialog-actions">
            <button type="button" className="btn ghost" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={submitting}>
              {submitting ? 'Opening Google…' : 'Continue with Google'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
