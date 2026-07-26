// A hand-tuned cloud silhouette made of overlapping ellipse "lobes", used both
// as a hit-test mask for packing puffs (Section 5.2) and as the shapes for
// the soft low-opacity backdrop layer that reads as a cloud at zoomed-out view.
export interface Lobe {
  cx: number
  cy: number
  rx: number
  ry: number
}

// Scales the whole silhouette (positions and radii alike) so the mask's
// interior area keeps pace with layout.ts's puff size/spacing. The mask has
// a fixed capacity for a given puff density (roughly maskArea / puffFootprint
// puffs before the phyllotaxis spiral runs out of room). Capacity scales with
// area, i.e. MASK_SCALE² — but the original "2.3 -> ~500-600 capacity"
// estimate undershot: empirically (see scripts used to tune this), true
// capacity at 2.3 is closer to ~740. 8.0 was chosen by simulating the actual
// packing at various scales for an ~8000-message target (5000+ with
// headroom): true capacity there is ~8970, comfortable room above 8000
// without being so oversized that a partially-filled cloud reads as a plain
// circle instead of the lobed silhouette (that happened at an earlier,
// too-large 9.2 attempt). Puff size/spacing (layout.ts) stayed the same on
// purpose, so the cloud's world footprint grows instead of puffs shrinking —
// re-verify via scripts/seed.ts if the message target changes meaningfully,
// and watch for layout.ts's "mask exhausted" warning if it's not big enough.
const MASK_SCALE = 8.0

export const CLOUD_LOBES: Lobe[] = [
  { cx: 0, cy: 100, rx: 900, ry: 260 },
  { cx: -650, cy: 20, rx: 260, ry: 220 },
  { cx: -280, cy: -170, rx: 340, ry: 300 },
  { cx: 140, cy: -230, rx: 400, ry: 330 },
  { cx: 560, cy: -110, rx: 320, ry: 280 },
  { cx: 820, cy: 60, rx: 240, ry: 200 },
].map((lobe) => ({
  cx: lobe.cx * MASK_SCALE,
  cy: lobe.cy * MASK_SCALE,
  rx: lobe.rx * MASK_SCALE,
  ry: lobe.ry * MASK_SCALE,
}))

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
