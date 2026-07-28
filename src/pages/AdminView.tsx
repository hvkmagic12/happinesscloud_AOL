import { useState } from 'react'
import { useLiveMessages } from '../lib/useLiveMessages'
import { useCloudCommands } from '../lib/useCloudCommands'
import { useMessageCategories } from '../lib/useMessageCategories'
import type { CategoryId } from '../lib/categories'
import { portraitDim } from '../cloud/portrait'
import CloudCanvas from '../cloud/CloudCanvas'
import CategoryLegend from '../components/CategoryLegend'
import EventHeading from '../components/EventHeading'
import './AdminView.css'

export default function AdminView() {
  const { messages, state, reload } = useLiveMessages()
  const { assembled, portrait, broadcastAssembled, broadcastPortrait } = useCloudCommands()
  const { categoryById, counts, present } = useMessageCategories(messages)
  const [activeCategory, setActiveCategory] = useState<CategoryId | null>(null)

  return (
    // Chrome flips to light-on-dark only when the canvas actually darkens,
    // which depends on which picture is up — see portraitDim.
    <div className={`admin-view ${assembled && portraitDim(portrait) > 0 ? 'is-dimmed' : ''}`}>
      {state === 'ready' && (
        <span className="admin-counter">{messages.length} messages shared</span>
      )}

      {state === 'ready' && messages.length > 0 && (
        <div className="admin-controls">
          {/* Broadcast like Assemble is, so every screen in the room changes
              picture together — and a screen can never be told to assemble
              without also being told what into. */}
          <div className="portrait-picker" role="group" aria-label="Picture">
            <button
              type="button"
              className={portrait === 'photo' ? 'is-selected' : ''}
              onClick={() => broadcastPortrait('photo')}
              aria-pressed={portrait === 'photo'}
            >
              Photo
            </button>
            <button
              type="button"
              className={portrait === 'drawing' ? 'is-selected' : ''}
              onClick={() => broadcastPortrait('drawing')}
              aria-pressed={portrait === 'drawing'}
            >
              Drawing
            </button>
          </div>
          <button
            type="button"
            className={`assemble-button ${assembled ? 'is-assembled' : ''}`}
            onClick={() => broadcastAssembled(!assembled)}
          >
            {assembled ? 'Release' : 'Assemble'}
          </button>
        </div>
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
            portraitId={portrait}
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
