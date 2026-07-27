import './EventHeading.css'

/**
 * Event branding sitting above the cloud. Purely decorative, so it never
 * swallows the drag/pinch gestures the canvas underneath depends on.
 */
export default function EventHeading() {
  return (
    <header className="event-heading" aria-label="Guru Purnima 2026, Boone, North Carolina">
      <h1 className="event-heading-title">Guru Purnima 2026</h1>
      <p className="event-heading-place">Boone, North Carolina</p>
    </header>
  )
}
