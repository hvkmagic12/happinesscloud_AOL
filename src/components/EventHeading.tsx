import { GURUDEV_QUOTE, GURUDEV_QUOTE_SOURCE } from '../lib/quote'
import './EventHeading.css'

/**
 * Event branding sitting above the cloud. Purely decorative, so it never
 * swallows the drag/pinch gestures the canvas underneath depends on.
 */
export default function EventHeading() {
  return (
    <header className="event-heading">
      <blockquote className="event-heading-quote">
        <p className="event-heading-quote-text">{GURUDEV_QUOTE}</p>
        <footer className="event-heading-quote-source">{GURUDEV_QUOTE_SOURCE}</footer>
      </blockquote>
    </header>
  )
}
