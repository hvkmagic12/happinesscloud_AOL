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

// Bounds for the mask-scale search in layoutCloudFitted. The floor keeps a
// single-message group from collapsing to a point.
const FIT_MIN_SCALE = 0.03
const FIT_SEARCH_STEPS = 18
// Spiral candidates generated per id while fitting. The mask is a wide lobed
// shape inside the spiral's circular sweep and covers roughly a third of it,
// so ~3 candidates per placed puff is the real requirement; 8 is margin.
const FIT_CANDIDATES_PER_ID = 8

/**
 * Packs ids into the cloud silhouette *scaled to fit them* — the mask shrinks
 * until the given ids fill its lobed shape.
 *
 * layoutCloud() deliberately does the opposite: it holds the mask at its full
 * event-sized extent so the cloud grows into that shape as messages arrive.
 * That's right for the main cloud and wrong for a subset, because a spiral
 * that stops well short of the mask boundary reads as a plain circle — the
 * failure mode cloudShape.ts's MASK_SCALE comment warns about. Any one theme
 * is a fraction of the whole, so without this a gathered theme would always
 * come out round.
 */
export function layoutCloudFitted(ids: string[]): PuffLayout[] {
  if (ids.length === 0) return []

  const c = AVG_RADIUS * PACK_DENSITY
  const candidateCount = Math.max(500, ids.length * FIT_CANDIDATES_PER_ID)
  // Generated once and re-tested at each trial scale, rather than recomputing
  // the trigonometry on every step of the search.
  const candidates: Array<{ x: number; y: number }> = []
  for (let k = 0; k < candidateCount; k++) candidates.push(spiralPoint(k, c))

  // Scaling the mask down by s is the same as testing the point scaled up by
  // 1/s, which avoids rebuilding the lobe list per trial.
  function capacityAt(scale: number): number {
    let inside = 0
    for (const p of candidates) {
      if (isInsideCloud(p.x / scale, p.y / scale, CLOUD_LOBES)) {
        inside++
        if (inside >= ids.length) break
      }
    }
    return inside
  }

  // Smallest scale that still holds every id, so the group fills the shape.
  let lo = FIT_MIN_SCALE
  let hi = 1
  for (let i = 0; i < FIT_SEARCH_STEPS; i++) {
    const mid = (lo + hi) / 2
    if (capacityAt(mid) >= ids.length) hi = mid
    else lo = mid
  }

  const result: PuffLayout[] = []
  for (const p of candidates) {
    if (result.length >= ids.length) break
    if (isInsideCloud(p.x / hi, p.y / hi, CLOUD_LOBES)) {
      const id = ids[result.length]
      result.push({ id, x: p.x, y: p.y, radius: radiusFor(id) })
    }
  }

  // Same fallback as layoutCloud: keep following the spiral rather than
  // dropping stragglers if the search somehow came up short.
  let candidate = candidates.length
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
