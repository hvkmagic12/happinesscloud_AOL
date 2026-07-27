import { Texture, type Renderer } from 'pixi.js'

let cached: Texture | null = null

// Edge length of the generated texture. Exported so callers can convert a
// desired on-screen puff diameter into a sprite scale.
export const PUFF_TEXTURE_SIZE = 256

// Lumps arranged around the center (as fractions of the base radius) so the
// silhouette reads as a fluffy cumulus cluster instead of a plain circle.
// Fixed rather than randomized because the texture is shared/tinted across
// every puff (Section 5.5) — per-puff variety instead comes from each
// sprite's own random rotation and squash (see CloudCanvas).
const LUMPS = [
  { dx: 0, dy: 0, r: 0.62 },
  { dx: -0.42, dy: 0.12, r: 0.42 },
  { dx: 0.4, dy: 0.16, r: 0.44 },
  { dx: -0.2, dy: -0.38, r: 0.4 },
  { dx: 0.24, dy: -0.4, r: 0.38 },
  { dx: 0.02, dy: 0.4, r: 0.36 },
]

/**
 * A soft-edged cluster of overlapping circles (reused via .tint for every
 * puff so Pixi can batch-render hundreds of sprites in as few draw calls as
 * possible, Section 5.5) so puffs read as fluffy cloud tufts rather than
 * plain bubbles.
 */
export function getPuffTexture(renderer: Renderer): Texture {
  if (cached) return cached

  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!

  const cx = size / 2
  const cy = size / 2
  const R = size / 2

  ctx.fillStyle = 'white'
  for (const lump of LUMPS) {
    ctx.beginPath()
    ctx.arc(cx + lump.dx * R, cy + lump.dy * R, lump.r * R, 0, Math.PI * 2)
    ctx.fill()
  }

  // Fade the whole lumpy silhouette out toward its edge instead of cutting
  // off hard, and even out the extra opacity where lumps overlap.
  ctx.globalCompositeOperation = 'destination-in'
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, R)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.6, 'rgba(255,255,255,0.9)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)

  cached = Texture.from(canvas)
  void renderer
  return cached
}
