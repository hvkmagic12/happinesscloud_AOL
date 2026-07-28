import './EventHeading.css'

/**
 * Event branding sitting above the cloud. Purely decorative, so it never
 * swallows the drag/pinch gestures the canvas underneath depends on.
 */
export default function EventHeading() {
  return (
    <header className="event-heading" aria-label="Gift of Gratitude, Boone, North Carolina">
      <h1 className="event-heading-title">Gift of Gratitude</h1>
      <p className="event-heading-place">Boone, North Carolina</p>
    </header>
  )
}
