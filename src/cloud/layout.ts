import type { PuffLayout } from '../types'
import { CLOUD_LOBES, cloudBounds, isInsideCloud } from './cloudShape'

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

const MIN_RADIUS = 13
const MAX_RADIUS = 22

/**
 * Packs message ids into a phyllotaxis (sunflower) spiral constrained to a
 * cloud-shaped mask, per Section 5.2. `ids` should already be in a stable
 * order (e.g. sorted by created_at) so existing messages keep their slot as
 * new ones are appended.
 */
export function layoutCloud(ids: string[]): PuffLayout[] {
  if (ids.length === 0) return []

  const bounds = cloudBounds()
  const maxExtent = Math.max(
    bounds.maxX - bounds.minX,
    bounds.maxY - bounds.minY,
  )
  // Spiral step scaled so the spiral has comfortably covered the mask's
  // extent by the time we've swept through a generous multiple of ids.length
  // candidate points (some candidates land outside the mask and are skipped).
  const spiralBudget = ids.length * 8
  const c = (maxExtent / 2) / Math.sqrt(spiralBudget)

  const result: PuffLayout[] = []
  let candidate = 0
  const maxCandidates = spiralBudget * 4

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
  // with the current spiralBudget), place any stragglers just past the edge
  // of the mask rather than dropping them.
  while (result.length < ids.length) {
    const i = result.length
    const r = Math.sqrt(maxExtent * maxExtent + i * 40)
    const theta = i * GOLDEN_ANGLE
    const id = ids[i]
    result.push({
      id,
      x: r * Math.cos(theta),
      y: r * Math.sin(theta),
      radius: MIN_RADIUS + hash01(id) * (MAX_RADIUS - MIN_RADIUS),
    })
  }

  return result
}
