import { Texture, type Renderer } from 'pixi.js'

let cached: Texture | null = null

/**
 * A single soft radial-gradient circle, reused (via .tint) for every puff so
 * Pixi can batch-render hundreds of sprites in as few draw calls as possible
 * (Section 5.5).
 */
export function getPuffTexture(renderer: Renderer): Texture {
  if (cached) return cached

  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!

  const gradient = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  )
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.55, 'rgba(255,255,255,0.85)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')

  ctx.fillStyle = gradient
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2)
  ctx.fill()

  cached = Texture.from(canvas)
  void renderer
  return cached
}
