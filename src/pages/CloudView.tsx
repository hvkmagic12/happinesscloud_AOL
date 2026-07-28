import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useLiveMessages } from '../lib/useLiveMessages'
import { useCloudCommands } from '../lib/useCloudCommands'
import { useMessageCategories } from '../lib/useMessageCategories'
import type { CategoryId } from '../lib/categories'
import CloudCanvas from '../cloud/CloudCanvas'
import CategoryLegend from '../components/CategoryLegend'
import EventHeading from '../components/EventHeading'
import './CloudView.css'

export default function CloudView() {
  const location = useLocation()
  const justSubmittedId = (location.state as { justSubmittedId?: string } | null)
    ?.justSubmittedId

  const { messages, state, reload } = useLiveMessages()
  // Read-only here: only the admin page can trigger the assembly, but every
  // viewer follows along live.
  const { assembled } = useCloudCommands()
  const { categoryById, counts, present } = useMessageCategories(messages)
  // Filtering is per-viewer, unlike assemble — one person exploring the
  // themes on their phone shouldn't change what the room's screen shows.
  const [activeCategory, setActiveCategory] = useState<CategoryId | null>(null)

  return (
    <div className="cloud-view">
      {state === 'ready' && (
        <span className="cloud-counter">{messages.length} messages shared</span>
      )}
      <Link to="/feedback" className="cloud-back-link">
        Share yours
      </Link>
      <EventHeading />

      {state === 'loading' && (
        <div className="cloud-state">
          <p>Gathering the cloud…</p>
        </div>
      )}

      {state === 'error' && (
        <div className="cloud-state">
          <p>Couldn't load the cloud. Please check your connection and try again.</p>
          <button type="button" className="retry-button" onClick={reload}>
            Retry
          </button>
        </div>
      )}

      {state === 'ready' && messages.length === 0 && (
        <div className="cloud-state">
          <p>No messages yet — be the first to share something positive.</p>
          <Link to="/feedback" className="retry-button" style={{ textDecoration: 'none' }}>
            Share something
          </Link>
        </div>
      )}

      {state === 'ready' && messages.length > 0 && (
        <>
          <CloudCanvas
            messages={messages}
            justSubmittedId={justSubmittedId}
            assembled={assembled}
            categoryById={categoryById}
            activeCategory={activeCategory}
          />
          <CategoryLegend
            present={present}
            counts={counts}
            total={messages.length}
            active={activeCategory}
            onSelect={setActiveCategory}
          />
        </>
      )}
    </div>
  )
}
