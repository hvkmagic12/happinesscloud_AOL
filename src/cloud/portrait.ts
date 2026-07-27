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

const PORTRAIT_SRC = `${import.meta.env.BASE_URL}gurudev.jpg`

// Cap the decode resolution — the grid sampling below reads every pixel of
// every cell once per binary-search step. Set above the source's own size so
// a small image is sampled at native resolution: downscaling first would
// throw away exactly the fine linework (eyes, smile, mala beads) that makes
// the portrait recognisable.
const SAMPLE_MAX_DIM = 640

// The source is a photograph of a drawing and carries a solid black band
// about 15px deep across the top, which would otherwise be read as ink and
// assembled as a bar above Gurudev's head. Measured from the image: the
// other three edges are clean paper, and the hair runs right up to the left
// edge, so cropping that side would eat into the drawing. Fractions rather
// than pixels so they survive the photo being re-shot at another size.
const CROP = { left: 0, right: 0, top: 0.028, bottom: 0 }

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
  /** Luminance cutoff separating ink from paper, derived once at preload. */
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

let cachedSample: Sample | null = null
let pendingLoad: Promise<Sample> | null = null

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () =>
      reject(
        new Error(
          `Could not load the portrait image at "${src}". Save the drawing to public/gurudev.png.`,
        ),
      )
    img.src = src
  })
}

/**
 * Decodes the portrait once and keeps its pixels around, so the (fast) grid
 * sampling can run synchronously later — the assemble command needs to fire
 * everywhere at the same moment, with no image-decode latency in the way.
 */
export function preloadPortrait(): Promise<Sample> {
  if (cachedSample) return Promise.resolve(cachedSample)
  if (pendingLoad) return pendingLoad

  pendingLoad = loadImage(PORTRAIT_SRC).then((img) => {
    // Source rectangle: the artwork with the photo's dark edge bands trimmed.
    const sx = img.width * CROP.left
    const sy = img.height * CROP.top
    const sw = Math.max(1, img.width * (1 - CROP.left - CROP.right))
    const sh = Math.max(1, img.height * (1 - CROP.top - CROP.bottom))

    const scale = Math.min(1, SAMPLE_MAX_DIM / Math.max(sw, sh))
    const width = Math.max(1, Math.round(sw * scale))
    const height = Math.max(1, Math.round(sh * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    // Flatten onto white first: the drawing may have transparency, and
    // untouched transparent pixels would otherwise read as pure black ink.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, height)

    const data = ctx.getImageData(0, 0, width, height).data
    cachedSample = {
      data,
      width,
      height,
      inkThreshold: INK_THRESHOLD_OVERRIDE ?? otsuThreshold(data),
    }
    pendingLoad = null
    return cachedSample
  })

  return pendingLoad
}

export function isPortraitReady(): boolean {
  return cachedSample !== null
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
    if (inkCells(sample, mid).cells.length <= count) lo = mid
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
  count: number,
  cellSize: number,
  centerX: number,
  centerY: number,
): PortraitLayout {
  const sample = cachedSample
  if (!sample) throw new Error('preloadPortrait() must resolve before buildPortraitLayout()')

  const cols = colsForCount(sample, count)
  const { cells, rows } = inkCells(sample, cols)

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
