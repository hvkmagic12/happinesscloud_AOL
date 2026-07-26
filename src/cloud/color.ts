// Base puff hue is a warm pink; hue_offset (stored per-message, range ±15)
// adds variation so puffs aren't all identical (Section 5.2). It's spread
// wider than its stored range so the cloud reads as a varied mix of warm
// pinks, corals, and purples rather than one narrow band.
const BASE_HUE = 336
const HUE_SPREAD = 4
const SATURATION = 0.82
const LIGHTNESS = 0.72

export function puffTint(hueOffset: number): number {
  const h = ((BASE_HUE + hueOffset * HUE_SPREAD) % 360 + 360) % 360
  return hslToHex(h, SATURATION, LIGHTNESS)
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
