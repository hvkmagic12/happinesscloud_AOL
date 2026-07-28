import { CATEGORY_BY_ID, FALLBACK_CATEGORY } from '../lib/categories'
import type { CategoryId } from '../lib/categories'

// Each category owns a hue (see src/lib/categories.ts); hue_offset (stored
// per-message, range ±15) still varies puffs within their category so a group
// reads as a family of related shades rather than one flat block of colour.
//
// The jitter is deliberately narrow. Categories sit as little as 22° apart on
// the wheel, so the ±60° spread this used to apply when every puff was pink
// would smear neighbouring categories into each other and make the grouping
// unreadable. ±6° stays comfortably inside each category's lane.
const HUE_JITTER = 0.4

// The soft silhouette behind the puffs. Neutral now that the cloud itself is
// multicoloured — tinting it toward any one category would bias the whole mass.
export const CLOUD_BACKDROP_TINT = hslToHex(320, 0.42, 0.84)

export function puffTint(hueOffset: number, category: CategoryId = FALLBACK_CATEGORY): number {
  const def = CATEGORY_BY_ID[category] ?? CATEGORY_BY_ID[FALLBACK_CATEGORY]
  const h = (((def.hue + hueOffset * HUE_JITTER) % 360) + 360) % 360
  return hslToHex(h, def.saturation, def.lightness)
}

function hslToHex(h: number, s: number, l: number): number {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0
  let g = 0
  let b = 0

  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]

  const toByte = (v: number) => Math.round((v + m) * 255)
  return (toByte(r) << 16) | (toByte(g) << 8) | toByte(b)
}
