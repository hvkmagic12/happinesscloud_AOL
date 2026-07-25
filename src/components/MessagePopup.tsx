import './MessagePopup.css'

export interface MessagePopupProps {
  text: string
  x: number
  y: number
  onClose: () => void
}

export default function MessagePopup({ text, x, y, onClose }: MessagePopupProps) {
  return (
    <div className="popup-backdrop" onPointerDown={onClose}>
      <div
        className="popup-card"
        style={{ left: x, top: y }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <p>{text}</p>
        <button type="button" className="popup-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
    </div>
  )
}
