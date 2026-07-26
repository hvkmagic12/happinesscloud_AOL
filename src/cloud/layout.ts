import type { PuffLayout } from '../types'
import { CLOUD_LOBES, isInsideCloud } from './cloudShape'

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

// Deterministic string -> [0,1) hash, so puff radius is stable across reloads
// without needing to store it in the database.
function hash01(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 100000) / 100000
}

const MIN_RADIUS = 16
const MAX_RADIUS = 26
const AVG_RADIUS = (MIN_RADIUS + MAX_RADIUS) / 2

// Spiral spacing is derived from puff size rather than the mask's fixed
// extent, so a handful of messages cluster into one tight blob near the
// center and only spread toward the mask's full lobed silhouette as more
// messages arrive - overlapping neighbors so the group reads as one solid
// cumulus mass instead of many separate puffs scattered across empty space.
// (<1 = puffs overlap their spiral neighbors; ~1 = puffs just touch.)
const PACK_DENSITY = 0.75

/**
 * Packs message ids into a phyllotaxis (sunflower) spiral constrained to a
 * cloud-shaped mask, per Section 5.2. `ids` should already be in a stable
 * order (e.g. sorted by created_at) so existing messages keep their slot as
 * new ones are appended.
 */
export function layoutCloud(ids: string[]): PuffLayout[] {
  if (ids.length === 0) return []

  const c = AVG_RADIUS * PACK_DENSITY
  const maxCandidates = Math.max(500, ids.length * 40)

  const result: PuffLayout[] = []
  let candidate = 0

  while (result.length < ids.length && candidate < maxCandidates) {
    const r = c * Math.sqrt(candidate)
    const theta = candidate * GOLDEN_ANGLE
    const x = r * Math.cos(theta)
    const y = r * Math.sin(theta)

    if (isInsideCloud(x, y, CLOUD_LOBES)) {
      const id = ids[result.length]
      const jitter = hash01(id)
      result.push({
        id,
        x,
        y,
        radius: MIN_RADIUS + jitter * (MAX_RADIUS - MIN_RADIUS),
      })
    }
    candidate++
  }

  // Fallback: if the mask ran out of room (shouldn't happen at 400-500 scale
  // with the current density), keep following the same spiral outward past
  // the edge of the mask rather than dropping stragglers.
  while (result.length < ids.length) {
    const r = c * Math.sqrt(candidate)
    const theta = candidate * GOLDEN_ANGLE
    const id = ids[result.length]
    result.push({
      id,
      x: r * Math.cos(theta),
      y: r * Math.sin(theta),
      radius: MIN_RADIUS + hash01(id) * (MAX_RADIUS - MIN_RADIUS),
    })
    candidate++
  }

  return result
}
