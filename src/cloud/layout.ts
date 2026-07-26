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

// Puffs need to be large enough for their label text to fit inside them
// (see CloudCanvas's per-label font auto-fit), so radius is sized generously
// rather than just for visual "puffiness".
const MIN_RADIUS = 30
const MAX_RADIUS = 48
const AVG_RADIUS = (MIN_RADIUS + MAX_RADIUS) / 2

// Spiral spacing is derived from puff size rather than the mask's fixed
// extent, so a handful of messages cluster into one tight blob near the
// center and only spread toward the mask's full lobed silhouette as more
// messages arrive, instead of many separate puffs scattered across empty
// space. (<1 = puffs overlap their spiral neighbors; ~1 = puffs just touch;
// >1 = puffs sit apart with visible gaps.)
const PACK_DENSITY = 1.4

function spiralPoint(candidate: number, c: number): { x: number; y: number } {
  const r = c * Math.sqrt(candidate)
  const theta = candidate * GOLDEN_ANGLE
  return { x: r * Math.cos(theta), y: r * Math.sin(theta) }
}

function radiusFor(id: string): number {
  return MIN_RADIUS + hash01(id) * (MAX_RADIUS - MIN_RADIUS)
}

/**
 * Packs message ids into a phyllotaxis (sunflower) spiral constrained to a
 * cloud-shaped mask, per Section 5.2. `ids` should already be in a stable
 * order (e.g. sorted by created_at) so existing messages keep their slot as
 * new ones are appended. One-shot/pure — see createLayoutCache() for
 * incremental use (e.g. across repeated realtime-insert calls).
 */
export function layoutCloud(ids: string[]): PuffLayout[] {
  if (ids.length === 0) return []

  const c = AVG_RADIUS * PACK_DENSITY
  const maxCandidates = Math.max(500, ids.length * 40)

  const result: PuffLayout[] = []
  let candidate = 0

  while (result.length < ids.length && candidate < maxCandidates) {
    const { x, y } = spiralPoint(candidate, c)

    if (isInsideCloud(x, y, CLOUD_LOBES)) {
      const id = ids[result.length]
      result.push({ id, x, y, radius: radiusFor(id) })
    }
    candidate++
  }

  // Fallback: if the mask ran out of room, keep following the same spiral
  // outward past the edge of the mask rather than dropping stragglers.
  while (result.length < ids.length) {
    const { x, y } = spiralPoint(candidate, c)
    const id = ids[result.length]
    result.push({ id, x, y, radius: radiusFor(id) })
    candidate++
  }

  return result
}

export interface LayoutCache {
  /**
   * Places any ids in `ids` not already placed by a previous call,
   * continuing the phyllotaxis spiral from wherever the last call left off
   * (never re-testing earlier candidate positions), and returns only the
   * newly placed layouts. Call with the full current ids array each time —
   * already-placed ids are cheaply skipped. Safe only when ids already
   * placed never need to move (true here: messages are append-only/
   * auto-approved, so an id's slot never changes once assigned).
   */
  placeNext(ids: string[]): PuffLayout[]
}

export function createLayoutCache(): LayoutCache {
  const c = AVG_RADIUS * PACK_DENSITY
  const placed = new Map<string, PuffLayout>()
  let candidate = 0
  let inFallback = false
  let warnedFallback = false

  function placeUnconstrained(id: string): PuffLayout {
    const { x, y } = spiralPoint(candidate, c)
    const layout: PuffLayout = { id, x, y, radius: radiusFor(id) }
    placed.set(id, layout)
    candidate++
    return layout
  }

  return {
    placeNext(ids) {
      const newlyPlaced: PuffLayout[] = []
      const maxCandidates = Math.max(500, ids.length * 40)

      for (const id of ids) {
        if (placed.has(id)) continue

        if (inFallback) {
          newlyPlaced.push(placeUnconstrained(id))
          continue
        }

        let found = false
        while (candidate < maxCandidates) {
          const { x, y } = spiralPoint(candidate, c)
          if (isInsideCloud(x, y, CLOUD_LOBES)) {
            const layout: PuffLayout = { id, x, y, radius: radiusFor(id) }
            placed.set(id, layout)
            newlyPlaced.push(layout)
            candidate++
            found = true
            break
          }
          candidate++
        }

        if (!found) {
          inFallback = true
          if (!warnedFallback) {
            warnedFallback = true
            console.warn(
              '[layout] cloud mask exhausted — falling back to unconstrained placement',
            )
          }
          newlyPlaced.push(placeUnconstrained(id))
        }
      }

      return newlyPlaced
    },
  }
}
