import { useLiveMessages } from '../lib/useLiveMessages'
import CloudCanvas from '../cloud/CloudCanvas'
import './AdminView.css'

export default function AdminView() {
  const { messages, state, reload } = useLiveMessages()

  return (
    <div className="admin-view">
      {state === 'ready' && (
        <span className="admin-counter">{messages.length} messages shared</span>
      )}

      {state === 'loading' && (
        <div className="admin-state">
          <p>Gathering the cloud…</p>
        </div>
      )}

      {state === 'error' && (
        <div className="admin-state">
          <p>Couldn't load the cloud. Please check your connection and try again.</p>
          <button type="button" className="retry-button" onClick={reload}>
            Retry
          </button>
        </div>
      )}

      {state === 'ready' && messages.length === 0 && (
        <div className="admin-state">
          <p>No messages yet — waiting for the first response.</p>
        </div>
      )}

      {state === 'ready' && messages.length > 0 && <CloudCanvas messages={messages} />}
    </div>
  )
}
