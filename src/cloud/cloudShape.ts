// A hand-tuned cloud silhouette made of overlapping ellipse "lobes", used both
// as a hit-test mask for packing puffs (Section 5.2) and as the shapes for
// the soft low-opacity backdrop layer that reads as a cloud at zoomed-out view.
export interface Lobe {
  cx: number
  cy: number
  rx: number
  ry: number
}

export const CLOUD_LOBES: Lobe[] = [
  { cx: 0, cy: 100, rx: 900, ry: 260 },
  { cx: -650, cy: 20, rx: 260, ry: 220 },
  { cx: -280, cy: -170, rx: 340, ry: 300 },
  { cx: 140, cy: -230, rx: 400, ry: 330 },
  { cx: 560, cy: -110, rx: 320, ry: 280 },
  { cx: 820, cy: 60, rx: 240, ry: 200 },
]

export function isInsideCloud(x: number, y: number, lobes: Lobe[] = CLOUD_LOBES): boolean {
  for (const lobe of lobes) {
    const dx = (x - lobe.cx) / lobe.rx
    const dy = (y - lobe.cy) / lobe.ry
    if (dx * dx + dy * dy <= 1) return true
  }
  return false
}

export function cloudBounds(lobes: Lobe[] = CLOUD_LOBES) {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const lobe of lobes) {
    minX = Math.min(minX, lobe.cx - lobe.rx)
    maxX = Math.max(maxX, lobe.cx + lobe.rx)
    minY = Math.min(minY, lobe.cy - lobe.ry)
    maxY = Math.max(maxY, lobe.cy + lobe.ry)
  }
  return { minX, maxX, minY, maxY }
}
