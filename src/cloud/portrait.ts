// Turns the Gurudev portrait into a set of target slots — one per puff — so
// the cloud can reassemble itself into the picture, each puff acting as a
// single pixel. The image is sampled into a grid whose resolution is chosen
// so the number of "ink" (dark) cells lands as close as possible to the
// number of puffs currently in the cloud.

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

const PORTRAIT_SRC = `${import.meta.env.BASE_URL}gurudev.png`

// Cap the decode resolution — the grid sampling below reads every pixel of
// every cell once per binary-search step, and portrait detail beyond this is
// far finer than one puff can represent anyway.
const SAMPLE_MAX_DIM = 420

// Mean cell luminance (0-255) below which a cell counts as part of the
// drawing rather than background. The source is a high-contrast charcoal
// drawing, so this sits well clear of both the paper and the ink.
const INK_THRESHOLD = 150

const MIN_COLS = 8
const MAX_COLS = 640

interface Sample {
  data: Uint8ClampedArray
  width: number
  height: number
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
    const scale = Math.min(1, SAMPLE_MAX_DIM / Math.max(img.width, img.height))
    const width = Math.max(1, Math.round(img.width * scale))
    const height = Math.max(1, Math.round(img.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    // Flatten onto white first: the drawing may have transparency, and
    // untouched transparent pixels would otherwise read as pure black ink.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(img, 0, 0, width, height)

    cachedSample = { data: ctx.getImageData(0, 0, width, height).data, width, height }
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

// Averages each grid cell and keeps the ones dark enough to be part of the
// drawing. Returns them in row-major order.
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

      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let y = y0; y < y1 && y < sample.height; y++) {
        for (let x = x0; x < x1 && x < sample.width; x++) {
          const i = (y * sample.width + x) * 4
          r += sample.data[i]
          g += sample.data[i + 1]
          b += sample.data[i + 2]
          n++
        }
      }
      if (n === 0) continue

      r /= n
      g /= n
      b /= n
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
      if (luminance >= INK_THRESHOLD) continue

      cells.push({
        col,
        row,
        tint: (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b),
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
