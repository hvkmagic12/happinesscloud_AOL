// Turns the Gurudev portrait into a set of target slots — one per puff — so
// the cloud can reassemble itself into the picture, each puff acting as a
// single pixel. The image is sampled into a grid whose resolution is chosen
// so the number of "ink" cells lands as close as possible to the number of
// puffs currently in the cloud.
//
// The source is a photograph of a charcoal drawing rather than clean line
// art, so the constants below were measured against it rather than guessed;
// the comment on each says what it's compensating for. Swapping in a
// different photograph should mostly just work — the ink/paper cutoff
// re-derives itself — but CROP is specific to this image's borders.

export interface PortraitTarget {
  x: number
  y: number
  tint: number
}

export interface PortraitLayout {
  targets: PortraitTarget[]
  cellSize: number
  width: number
  height: number
}

export type PortraitId = 'drawing' | 'photo'

interface PortraitSource {
  src: string
  /**
   * 'ink' — dark marks on white paper. Which cells count is decided by how
   * much of them is ink (see inkCells).
   * 'photo' — a subject cut out against transparency. Which cells count is
   * decided by the alpha channel alone (see photoCells).
   */
  mode: 'ink' | 'photo'
  crop: { left: number; right: number; top: number; bottom: number }
}

export const PORTRAITS: Record<PortraitId, PortraitSource> = {
  drawing: {
    src: `${import.meta.env.BASE_URL}gurudev.jpg`,
    mode: 'ink',
    // The source is a photograph of a drawing and carries a solid black band
    // about 15px deep across the top, which would otherwise be read as ink
    // and assembled as a bar above Gurudev's head. Measured from the image:
    // the other three edges are clean paper, and the hair runs right up to
    // the left edge, so cropping that side would eat into the drawing.
    crop: { left: 0, right: 0, top: 0.028, bottom: 0 },
  },
  photo: {
    // Background-removed during asset prep, and the Art of Living logo band
    // was cropped off there too.
    src: `${import.meta.env.BASE_URL}gurudev-color.png`,
    mode: 'photo',
    // Trims most of the robe. Two reasons, measured rather than guessed: the
    // robe was consuming about a fifth of the available puffs, so dropping it
    // takes the grid from 89x123 to 97x109 and puts that resolution on the
    // face instead; and the result is squarer, which frames better on a
    // 16:9 screen than a tall narrow portrait constrained by height. A little
    // shoulder is kept so it doesn't read as a floating head.
    crop: { left: 0, right: 0, top: 0, bottom: 0.18 },
  },
}

export const DEFAULT_PORTRAIT: PortraitId = 'drawing'

// Cap the decode resolution — the grid sampling below reads every pixel of
// every cell once per binary-search step. Set above the source's own size so
// a small image is sampled at native resolution: downscaling first would
// throw away exactly the fine linework (eyes, smile, mala beads) that makes
// the portrait recognisable.
const SAMPLE_MAX_DIM = 640

// --- photo mode ---------------------------------------------------------
// Mean alpha a cell needs before it counts as part of the subject. The
// cutout's mask is hard-edged, so this only decides how the boundary cells
// round off.
const PHOTO_ALPHA_COVERAGE = 0.45
// Puffs are drawn from a soft-edged texture, so every one composites partly
// over whatever is behind it and colours arrive on screen paler and flatter
// than they are in the source. These push back: saturation is multiplied,
// and lightness is pushed away from mid-grey.
const PHOTO_SATURATION = 1.35
const PHOTO_CONTRAST = 1.15

// Pins the ink/paper cutoff if the automatic choice below ever picks badly.
// Null means "use Otsu", which is the intended path.
const INK_THRESHOLD_OVERRIDE: number | null = null

// Fraction of a cell that must be ink for it to join the drawing (see
// inkCells). Low enough that a single-pixel facial line still qualifies,
// high enough to ignore stray JPEG speckle around the charcoal.
const INK_COVERAGE = 0.2

// How much sparsely-covered cells are lightened relative to solid ones (see
// inkCells). 1 renders every ink cell flat black; higher preserves more of
// the drawing's tonal range.
const INK_CONTRAST = 2.2

const MIN_COLS = 8
const MAX_COLS = 640

interface Sample {
  data: Uint8ClampedArray
  width: number
  height: number
  mode: 'ink' | 'photo'
  /**
   * Luminance cutoff separating ink from paper, derived once at preload.
   * Only meaningful in 'ink' mode.
   */
  inkThreshold: number
}

function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * Otsu's method: the luminance cutoff that maximises between-class variance,
 * i.e. the value that best separates the image's two populations. A photo of
 * a drawing has uneven paper tone and compression ringing around the
 * charcoal, so a hardcoded cutoff is a guess that either swallows the light
 * face or drops the softer hair — this re-derives itself per image.
 */
function otsuThreshold(data: Uint8ClampedArray): number {
  const histogram = new Array<number>(256).fill(0)
  let total = 0
  for (let i = 0; i < data.length; i += 4) {
    histogram[Math.round(luminance(data[i], data[i + 1], data[i + 2]))]++
    total++
  }
  if (total === 0) return 128

  let sum = 0
  for (let v = 0; v < 256; v++) sum += v * histogram[v]

  let sumBackground = 0
  let weightBackground = 0
  let best = 128
  let bestVariance = -1

  for (let v = 0; v < 256; v++) {
    weightBackground += histogram[v]
    if (weightBackground === 0) continue
    const weightForeground = total - weightBackground
    if (weightForeground === 0) break

    sumBackground += v * histogram[v]
    const meanBackground = sumBackground / weightBackground
    const meanForeground = (sum - sumBackground) / weightForeground
    const delta = meanBackground - meanForeground
    const variance = weightBackground * weightForeground * delta * delta

    if (variance > bestVariance) {
      bestVariance = variance
      best = v
    }
  }

  return best
}

const cachedSamples = new Map<PortraitId, Sample>()
const pendingLoads = new Map<PortraitId, Promise<Sample>>()

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () =>
      reject(new Error(`Could not load the portrait image at "${src}".`))
    img.src = src
  })
}

/**
 * Decodes the portrait once and keeps its pixels around, so the (fast) grid
 * sampling can run synchronously later — the assemble command needs to fire
 * everywhere at the same moment, with no image-decode latency in the way.
 */
export function preloadPortrait(id: PortraitId = DEFAULT_PORTRAIT): Promise<Sample> {
  const cached = cachedSamples.get(id)
  if (cached) return Promise.resolve(cached)
  const pending = pendingLoads.get(id)
  if (pending) return pending

  const source = PORTRAITS[id]
  const load = loadImage(source.src).then((img) => {
    const { crop, mode } = source
    // Source rectangle: the artwork with any edge bands trimmed.
    const sx = img.width * crop.left
    const sy = img.height * crop.top
    const sw = Math.max(1, img.width * (1 - crop.left - crop.right))
    const sh = Math.max(1, img.height * (1 - crop.top - crop.bottom))

    const scale = Math.min(1, SAMPLE_MAX_DIM / Math.max(sw, sh))
    const width = Math.max(1, Math.round(sw * scale))
    const height = Math.max(1, Math.round(sh * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    if (mode === 'ink') {
      // Flatten onto white first: the drawing may have transparency, and
      // untouched transparent pixels would otherwise read as pure black ink.
      // Emphatically NOT done for a photo, whose alpha channel *is* the
      // subject mask — flattening it would erase the cutout.
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, width, height)
    }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, height)

    const data = ctx.getImageData(0, 0, width, height).data
    const sample: Sample = {
      data,
      width,
      height,
      mode,
      inkThreshold: mode === 'ink' ? (INK_THRESHOLD_OVERRIDE ?? otsuThreshold(data)) : 0,
    }
    cachedSamples.set(id, sample)
    pendingLoads.delete(id)
    return sample
  })

  pendingLoads.set(id, load)
  return load
}

export function isPortraitReady(id: PortraitId = DEFAULT_PORTRAIT): boolean {
  return cachedSamples.has(id)
}

interface Cell {
  col: number
  row: number
  tint: number
}

// Decides which grid cells are part of the drawing, and what colour each
// one's puff should be. Returns them in row-major order.
//
// Cells are judged by how MUCH of them is ink, not by their average colour.
// One puff has to stand in for several source pixels, and a cell holding a
// single-pixel line — an eye, the smile, the edge of the nose — averages out
// well above the paper cutoff and would be discarded, while solid masses of
// hair survive. Averaging therefore erases exactly the features that make the
// face readable and keeps only the blocks. Judging by coverage keeps them.
function inkCells(sample: Sample, cols: number): { cells: Cell[]; rows: number } {
  const rows = Math.max(1, Math.round((cols * sample.height) / sample.width))
  const cellW = sample.width / cols
  const cellH = sample.height / rows
  const cells: Cell[] = []

  for (let row = 0; row < rows; row++) {
    const y0 = Math.floor(row * cellH)
    const y1 = Math.max(y0 + 1, Math.floor((row + 1) * cellH))
    for (let col = 0; col < cols; col++) {
      const x0 = Math.floor(col * cellW)
      const x1 = Math.max(x0 + 1, Math.floor((col + 1) * cellW))

      // Accumulate the ink pixels only, so the tint reflects the colour of
      // the mark rather than the colour of the mark averaged with the paper
      // around it (which would render a thin line as an invisible pale puff).
      let r = 0
      let g = 0
      let b = 0
      let ink = 0
      let n = 0
      for (let y = y0; y < y1 && y < sample.height; y++) {
        for (let x = x0; x < x1 && x < sample.width; x++) {
          const i = (y * sample.width + x) * 4
          n++
          if (luminance(sample.data[i], sample.data[i + 1], sample.data[i + 2]) >= sample.inkThreshold) {
            continue
          }
          r += sample.data[i]
          g += sample.data[i + 1]
          b += sample.data[i + 2]
          ink++
        }
      }
      if (n === 0 || ink / n < INK_COVERAGE) continue

      r /= ink
      g /= ink
      b /= ink

      // Deepen toward black by how completely the cell is covered: a solid
      // block of beard reads darker than a cell a single hair passes
      // through, which preserves the drawing's tone. Without this every ink
      // cell would come out the same flat black.
      const deepen = Math.pow(ink / n, 1 / INK_CONTRAST)

      cells.push({
        col,
        row,
        tint:
          (Math.round(r * deepen) << 16) |
          (Math.round(g * deepen) << 8) |
          Math.round(b * deepen),
      })
    }
  }

  return { cells, rows }
}

/**
 * Boosts a sampled colour's saturation and contrast, and returns it packed.
 *
 * Necessary because a puff is a soft-edged sprite: it composites partly over
 * whatever is behind it, so a mosaic built from raw sampled colours arrives
 * on screen noticeably paler and flatter than the photograph it came from.
 */
function vividTint(r: number, g: number, b: number): number {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const d = max - min

  let h = 0
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    h *= 60
  }
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))

  const s2 = Math.min(1, s * PHOTO_SATURATION)
  const l2 = Math.min(1, Math.max(0, 0.5 + (l - 0.5) * PHOTO_CONTRAST))

  const c = (1 - Math.abs(2 * l2 - 1)) * s2
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l2 - c / 2
  let rr = 0
  let gg = 0
  let bb = 0
  if (h < 60) [rr, gg, bb] = [c, x, 0]
  else if (h < 120) [rr, gg, bb] = [x, c, 0]
  else if (h < 180) [rr, gg, bb] = [0, c, x]
  else if (h < 240) [rr, gg, bb] = [0, x, c]
  else if (h < 300) [rr, gg, bb] = [x, 0, c]
  else [rr, gg, bb] = [c, 0, x]

  const byte = (v: number) => Math.min(255, Math.max(0, Math.round((v + m) * 255)))
  return (byte(rr) << 16) | (byte(gg) << 8) | byte(bb)
}

// Decides which grid cells are part of a cut-out photo, and what colour each
// one's puff should be. Same signature and row-major contract as inkCells.
//
// The ink logic can't be reused here even loosely: it keeps a cell only if
// enough of it is *dark*, which for a photograph would throw away the face,
// the white robe, and every highlight, leaving a portrait made of nothing but
// its own shadows. It also deepens tints toward black by coverage, which is
// right for preserving a pencil drawing's tonal range and ruinous for real
// colour. Here the alpha channel already says exactly which pixels are the
// subject, so that is the only test needed.
function photoCells(sample: Sample, cols: number): { cells: Cell[]; rows: number } {
  const rows = Math.max(1, Math.round((cols * sample.height) / sample.width))
  const cellW = sample.width / cols
  const cellH = sample.height / rows
  const cells: Cell[] = []

  for (let row = 0; row < rows; row++) {
    const y0 = Math.floor(row * cellH)
    const y1 = Math.max(y0 + 1, Math.floor((row + 1) * cellH))
    for (let col = 0; col < cols; col++) {
      const x0 = Math.floor(col * cellW)
      const x1 = Math.max(x0 + 1, Math.floor((col + 1) * cellW))

      // Average the opaque pixels only. Including transparent ones would drag
      // every edge cell toward black and outline the subject in a dark rim.
      let r = 0
      let g = 0
      let b = 0
      let opaque = 0
      let n = 0
      for (let y = y0; y < y1 && y < sample.height; y++) {
        for (let x = x0; x < x1 && x < sample.width; x++) {
          const i = (y * sample.width + x) * 4
          n++
          if (sample.data[i + 3] < 128) continue
          r += sample.data[i]
          g += sample.data[i + 1]
          b += sample.data[i + 2]
          opaque++
        }
      }
      if (n === 0 || opaque / n < PHOTO_ALPHA_COVERAGE) continue

      cells.push({
        col,
        row,
        tint: vividTint(r / opaque, g / opaque, b / opaque),
      })
    }
  }

  return { cells, rows }
}

function cellsFor(sample: Sample, cols: number): { cells: Cell[]; rows: number } {
  return sample.mode === 'photo' ? photoCells(sample, cols) : inkCells(sample, cols)
}

// Ink-cell count rises with grid resolution, so a binary search finds the
// finest grid the available puffs can still fill *completely*. Erring on the
// side of too few cells matters: leftover puffs can double up and thicken
// strokes, whereas too many cells means some go unfilled and the drawing
// comes out speckled with holes.
function colsForCount(sample: Sample, count: number): number {
  let lo = MIN_COLS
  let hi = MAX_COLS
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (cellsFor(sample, mid).cells.length <= count) lo = mid
    else hi = mid - 1
  }
  return lo
}

/**
 * Builds one target slot per puff. Requires preloadPortrait() to have
 * resolved. `cellSize` is the world-space size of one portrait pixel, and
 * the portrait is centred on (centerX, centerY).
 */
export function buildPortraitLayout(
  id: PortraitId,
  count: number,
  cellSize: number,
  centerX: number,
  centerY: number,
): PortraitLayout {
  const sample = cachedSamples.get(id)
  if (!sample) throw new Error('preloadPortrait() must resolve before buildPortraitLayout()')

  const cols = colsForCount(sample, count)
  const { cells, rows } = cellsFor(sample, cols)

  const width = cols * cellSize
  const height = rows * cellSize
  const originX = centerX - width / 2
  const originY = centerY - height / 2

  const toTarget = (cell: Cell, jitter = 0): PortraitTarget => ({
    x: originX + (cell.col + 0.5) * cellSize + jitter,
    y: originY + (cell.row + 0.5) * cellSize + jitter,
    tint: cell.tint,
  })

  const targets: PortraitTarget[] = []
  if (cells.length === 0) return { targets, cellSize, width, height }

  if (cells.length >= count) {
    // Thin evenly rather than truncating, so the drawing stays whole.
    const stride = cells.length / count
    for (let i = 0; i < count; i++) targets.push(toTarget(cells[Math.floor(i * stride)]))
  } else {
    for (const cell of cells) targets.push(toTarget(cell))
    // More puffs than ink cells: double up on cells with a small offset so
    // the extras thicken strokes instead of piling up dead centre. The
    // offset is derived from the index (not Math.random) so every client
    // lands on the same picture.
    for (let i = cells.length; i < count; i++) {
      const cell = cells[i % cells.length]
      const step = Math.floor(i / cells.length)
      targets.push(toTarget(cell, ((step % 2 === 0 ? 1 : -1) * cellSize) / 4))
    }
  }

  return { targets, cellSize, width, height }
}
