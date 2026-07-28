import { useState } from 'react'
import { useLiveMessages } from '../lib/useLiveMessages'
import { useCloudCommands } from '../lib/useCloudCommands'
import { useMessageCategories } from '../lib/useMessageCategories'
import type { CategoryId } from '../lib/categories'
import CloudCanvas from '../cloud/CloudCanvas'
import CategoryLegend from '../components/CategoryLegend'
import EventHeading from '../components/EventHeading'
import './AdminView.css'

export default function AdminView() {
  const { messages, state, reload } = useLiveMessages()
  const { assembled, broadcastAssembled } = useCloudCommands()
  const { categoryById, counts, present } = useMessageCategories(messages)
  const [activeCategory, setActiveCategory] = useState<CategoryId | null>(null)

  return (
    <div className="admin-view">
      {state === 'ready' && (
        <span className="admin-counter">{messages.length} messages shared</span>
      )}

      {state === 'ready' && messages.length > 0 && (
        <button
          type="button"
          className={`assemble-button ${assembled ? 'is-assembled' : ''}`}
          onClick={() => broadcastAssembled(!assembled)}
        >
          {assembled ? 'Release' : 'Assemble'}
        </button>
      )}
      <EventHeading />

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

      {state === 'ready' && messages.length > 0 && (
        <>
          <CloudCanvas
            messages={messages}
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
