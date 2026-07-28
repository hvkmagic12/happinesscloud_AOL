import { useEffect, useRef } from 'react'
import {
  Application,
  CanvasTextMetrics,
  Container,
  Sprite,
  Text,
  Texture,
  TextStyle,
} from 'pixi.js'
import { Viewport } from 'pixi-viewport'
import gsap from 'gsap'
import { MotionPathPlugin } from 'gsap/MotionPathPlugin'
import type { Message } from '../types'
import type { CategoryId } from '../lib/categories'
import { FALLBACK_CATEGORY } from '../lib/categories'
import { createLayoutCache, layoutCloudFitted } from './layout'
import { CLOUD_LOBES, cloudBounds } from './cloudShape'
import { getPuffTexture, PUFF_TEXTURE_SIZE } from './puffTexture'
import { CLOUD_BACKDROP_TINT, puffTint } from './color'
import {
  buildPortraitLayout,
  DEFAULT_PORTRAIT,
  isPortraitReady,
  portraitDim,
  PORTRAITS,
  preloadPortrait,
} from './portrait'
import type { PortraitId, PortraitLayout, PortraitTarget } from './portrait'

gsap.registerPlugin(MotionPathPlugin)

// By default gsap clamps its time delta when a frame runs long, so a struggling
// machine plays animations in slow motion rather than dropping frames. That is
// wrong for this app twice over: the assemble is broadcast to every screen in
// the room at once, and a slow projector would drift out of step with the
// phones watching it; and tween onComplete callbacks — which is where the
// portrait's filler puffs are cleaned up — would fire seconds late or not at
// all. Off, gsap advances by real elapsed time and every screen stays on the
// same schedule.
gsap.ticker.lagSmoothing(0)

// Placeholder zoom-out floor used only until the real one is computed at
// mount time from actual screen size + puff/mask bounds (see minZoom in the
// mount effect) — a fixed ratio can't account for every screen's size/aspect
// ratio, which is what caused the initial view to crop the cloud before this
// was made dynamic. Keep this reasonably small so it's never the binding
// constraint before that recalculation runs.
const MIN_ZOOM = 0.05
const MAX_ZOOM = 4
const WORLD_PADDING = 500
// Margin added around the actual placed-puff bounds for the initial fit, so
// edge puffs (plus their drift/shadow) aren't flush against the viewport
// edge.
const CONTENT_FIT_PADDING = 120
// Feedback labels stay hidden while the whole cloud is in view (they'd be
// unreadable clutter at that scale) and fade in once the viewer has zoomed
// in far enough to read them, so nobody has to click a puff to read it.
const LABEL_ZOOM_THRESHOLD = 1.2
// How far beyond the viewport edge (world units) puffs are still updated and
// labelled, so panning reveals finished puffs rather than blanks.
const CULL_MARGIN = 500
// Labels built per frame. Enough that a screenful appears within a couple of
// frames, few enough that no single frame stalls rasterising text.
const LABEL_ACQUIRE_PER_FRAME = 40
// Below this much on-screen movement, a puff's sway isn't worth computing.
const DRIFT_VISIBLE_PIXELS = 0.75
const LABEL_MAX_CHARS = 40
const LABEL_BASE_FONT_SIZE = 13
const LABEL_MIN_FONT_SIZE = 8
// Fractions of the puff's diameter the wrapped text is allowed to occupy.
// Width is kept much tighter than height so long phrases wrap into several
// narrow lines (tall and skinny) rather than a few wide ones, and so the
// block reads as sitting inside the circular puff rather than spilling
// past its edges.
const LABEL_WIDTH_FRACTION = 0.5
const LABEL_HEIGHT_FRACTION = 0.8

// Idle drift so the cloud feels alive rather than static: each puff slowly
// bobs around its packed slot and wobbles a couple degrees. Kept small
// relative to puff radius (30-48px) so packed neighbors don't visibly
// collide, and slow so it reads as a gentle sway rather than jitter.
const DRIFT_MIN_AMPLITUDE = 3
const DRIFT_MAX_AMPLITUDE = 7
const DRIFT_MIN_PERIOD_MS = 3500
const DRIFT_MAX_PERIOD_MS = 7000
const ROTATION_MAX_RADIANS = 0.08
const ROTATION_MIN_PERIOD_MS = 4000
const ROTATION_MAX_PERIOD_MS = 8000

// Every puff shares one texture (Section 5.5's batching), so per-puff
// visual variety comes from randomizing each sprite's own base rotation and
// squash instead — the same lumpy silhouette reads differently depending on
// which way it's turned and stretched.
const SHAPE_SCALE_JITTER = 0.12

// Soft drop shadow, offset down-right, so puffs read as sitting slightly
// above the backdrop rather than flat against it.
const SHADOW_OFFSET_X = 4
const SHADOW_OFFSET_Y = 6
const SHADOW_ALPHA = 0.16
const SHADOW_COLOR = 0x2a2140

// "Assemble": the whole cloud gathers into the Gurudev portrait, each puff
// acting as one pixel of the drawing, then disperses back.
const ASSEMBLE_DURATION_S = 3.2
const DISPERSE_DURATION_S = 2.4
// World size of one portrait pixel, matched to typical puff diameter
// (radius 30-48, so ~78 across) so puffs tile the drawing without gaps.
const PORTRAIT_CELL_SIZE = 78
// Assembled puffs run slightly larger than their cell so strokes read as
// solid rather than as a screen of separate dots.
const PORTRAIT_PUFF_OVERLAP = 1.3
// Labels would obscure the picture, so they're hidden past this progress.
const PORTRAIT_LABEL_CUTOFF = 0.05
// The picture is drawn at whatever grid the available puffs can fill, so its
// sharpness would otherwise depend on turnout: 1000 messages resolve to about
// 34x38 cells, which reads as a smudge. Below this many puffs the cloud makes
// up the difference with plain ones that carry no message, purely so the
// portrait resolves — so the same detailed face appears whether fifty people
// or five thousand have written in.
//
// 12000 lands around 119x134, which is where the eyes gain catchlights and
// the tilak and teeth start to read; past roughly 16000 each cell is under
// ~3 source pixels and there's no more detail in the photograph to find.
// Affordable because filler is far cheaper than a message puff — no drift, no
// label, no shadow, no filter state, and no per-frame work at all once the
// transition settles — so 12000 of these is lighter than the 8000 message
// puffs this already carries. Lower it if a venue's machine struggles.
const PORTRAIT_MIN_CELLS = 12000
// The page's sky gradient is dimmed toward this as the portrait forms. How
// far is a property of the picture, not a constant — see PortraitSource.dim.
const PORTRAIT_DIM_COLOR = 0x191526
// Swapping pictures while already assembled scatters back to the cloud and
// re-forms, since at progress 1 new targets would simply teleport.
const PORTRAIT_SWAP_OUT_S = 1.1

// Isolating one category fades the rest back rather than hiding them, so the
// selected group is legible while the cloud keeps its overall shape and you
// can still see how big a slice you're looking at.
const DIMMED_ALPHA = 0.1

// "Gather": picking a theme pulls its puffs out of the big cloud and packs
// them into a cloud of their own, so a theme can be read on its own terms.
const GATHER_DURATION_S = 1.8
const SCATTER_DURATION_S = 1.4
// Switching straight from one theme to another runs the two back to back
// (out, swap targets, in) rather than sliding between two packings, which
// would send both sets of puffs across each other.
const GATHER_SWAP_OUT_S = 0.9
// Ceiling on how far the camera zooms in to frame a gathered theme.
//
// Framing every theme to fill the screen would blow a hundred-message theme
// up until its puffs are 50px soft-edged blobs with visible gaps between
// them — it stops reading as a cloud. Capping instead means a gathered
// cloud's size on screen reflects how big the theme actually is: the biggest
// fills the view, the smallest sits as a small cloud in the middle of it.
const GATHER_MAX_ZOOM = 0.3

// "Spotlight": every so often one or two messages lift out of the cloud and
// swoosh up to the front of the screen, big enough to read from across a
// room, then drift away again. Ambient — it needs no interaction, and runs on
// the projector and on phones alike.
const SPOTLIGHT_IN_S = 0.85
const SPOTLIGHT_OUT_S = 0.6
const SPOTLIGHT_GAP_S = 0.45
const SPOTLIGHT_FIRST_DELAY_MS = 1800
// How long a message sits still, scaled to how much there is to read — a
// six-word thank-you does not need the same time on screen as a full
// paragraph, and giving every message the slowest message's dwell is what
// made the rotation drag. Clamped at both ends so nothing flashes past and
// nothing outstays its welcome.
const SPOTLIGHT_HOLD_BASE_S = 0.9
const SPOTLIGHT_HOLD_PER_WORD_S = 0.24
const SPOTLIGHT_HOLD_MIN_S = 1.8
const SPOTLIGHT_HOLD_MAX_S = 4.2
// Size is bounded by both screen dimensions rather than just the shorter one:
// on a tall phone the shorter side alone gives a puff too small to hold a
// 200-character message, and the text spills out of it.
const SPOTLIGHT_SINGLE_W = 0.8
const SPOTLIGHT_SINGLE_H = 0.5
const SPOTLIGHT_PAIR_W = 0.42
const SPOTLIGHT_PAIR_H = 0.44
// Below this width there isn't room for two side by side, so phones show one
// at a time.
const SPOTLIGHT_PAIR_MIN_WIDTH = 700
// How many recently-shown messages to avoid repeating. With a big cloud this
// barely matters; early in an event, when only a handful have been sent, it's
// what stops the same one appearing over and over.
const SPOTLIGHT_RECENT_MEMORY = 24
const SPOTLIGHT_FONT_MAX = 34
const SPOTLIGHT_FONT_MIN = 12
// Fractions of the puff's diameter the text may occupy. Wider than the small
// in-cloud labels because a spotlight puff is big enough to hold real lines.
const SPOTLIGHT_WIDTH_FRACTION = 0.64
const SPOTLIGHT_HEIGHT_FRACTION = 0.62

interface PuffMotion {
  baseX: number
  baseY: number
  /** Which theme this message was sorted into — drives tint and filtering. */
  category: CategoryId
  phaseX: number
  phaseY: number
  phaseR: number
  freqX: number
  freqY: number
  freqR: number
  ampX: number
  ampY: number
  ampR: number
  // Normalised to [-π, π] so unwinding to 0 while assembling takes the short
  // way round rather than spinning most of a full turn.
  baseRotation: number
  scaleX: number
  scaleY: number
  // Resting appearance, captured once the sprite exists. Assembling
  // interpolates from these toward the portrait's target* values below.
  baseScaleX: number
  baseScaleY: number
  baseTint: number
  // Where this puff sits in the portrait. Defaults to its resting state so
  // the interpolation is a no-op until a portrait has been assigned.
  targetX: number
  targetY: number
  targetTint: number
  targetScale: number
  // Where this puff sits in its theme's own gathered cloud. Also defaults to
  // its resting state, so puffs of unselected themes stay put through a
  // gather without needing to be excluded from the loop.
  gatherX: number
  gatherY: number
}

// Phones report device pixel ratios of 3 and up, which at this puff count
// means shading nine times the pixels of a 1x screen — the single biggest
// cost on a handset, and for soft-edged pastel blobs the difference above 2x
// is not visible. Desktops and projectors are 1x or 2x, so this is a no-op
// for them.
const MAX_RENDER_RESOLUTION = 2

function renderResolution(): number {
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1
  return Math.min(dpr, MAX_RENDER_RESOLUTION)
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function periodToFreq(periodMs: number): number {
  return (Math.PI * 2) / periodMs
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerpTint(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff
  const ag = (a >> 8) & 0xff
  const ab = a & 0xff
  const br = (b >> 16) & 0xff
  const bg = (b >> 8) & 0xff
  const bb = b & 0xff
  return (
    (Math.round(ar + (br - ar) * t) << 16) |
    (Math.round(ag + (bg - ag) * t) << 8) |
    Math.round(ab + (bb - ab) * t)
  )
}

function makePuffMotion(baseX: number, baseY: number, category: CategoryId): PuffMotion {
  return {
    baseX,
    baseY,
    category,
    phaseX: randomBetween(0, Math.PI * 2),
    phaseY: randomBetween(0, Math.PI * 2),
    phaseR: randomBetween(0, Math.PI * 2),
    freqX: periodToFreq(randomBetween(DRIFT_MIN_PERIOD_MS, DRIFT_MAX_PERIOD_MS)),
    freqY: periodToFreq(randomBetween(DRIFT_MIN_PERIOD_MS, DRIFT_MAX_PERIOD_MS)),
    freqR: periodToFreq(randomBetween(ROTATION_MIN_PERIOD_MS, ROTATION_MAX_PERIOD_MS)),
    ampX: randomBetween(DRIFT_MIN_AMPLITUDE, DRIFT_MAX_AMPLITUDE),
    ampY: randomBetween(DRIFT_MIN_AMPLITUDE, DRIFT_MAX_AMPLITUDE),
    ampR: randomBetween(ROTATION_MAX_RADIANS * 0.4, ROTATION_MAX_RADIANS),
    baseRotation: randomBetween(-Math.PI, Math.PI),
    scaleX: 1 + randomBetween(-SHAPE_SCALE_JITTER, SHAPE_SCALE_JITTER),
    scaleY: 1 + randomBetween(-SHAPE_SCALE_JITTER, SHAPE_SCALE_JITTER),
    // Overwritten in syncPuffs as soon as the sprite is built.
    baseScaleX: 1,
    baseScaleY: 1,
    baseTint: 0xffffff,
    targetX: baseX,
    targetY: baseY,
    targetTint: 0xffffff,
    targetScale: 1,
    gatherX: baseX,
    gatherY: baseY,
  }
}

function truncateLabel(text: string): string {
  if (text.length <= LABEL_MAX_CHARS) return text
  return text.slice(0, LABEL_MAX_CHARS - 1).trimEnd() + '…'
}

function labelStyleAt(fontSize: number, wordWrapWidth: number): TextStyle {
  return new TextStyle({
    fontFamily: 'system-ui, sans-serif',
    fontSize,
    fill: '#ffffff',
    stroke: { color: '#3a3450', width: Math.max(1, Math.round(fontSize * 0.22)) },
    align: 'center',
    wordWrap: true,
    wordWrapWidth,
  })
}

// Shrinks the font size until the word-wrapped text fits within the puff's
// target box, so short puffs get small text and large puffs get bigger text
// instead of every label using one fixed size regardless of the puff it's on.
// If it still doesn't fit once the font hits its floor (long text on a small
// puff), keeps shortening the text itself so the label never spills past the
// puff's edge.
function fitLabel(rawText: string, radius: number): { text: string; style: TextStyle } {
  const diameter = radius * 2
  const wordWrapWidth = diameter * LABEL_WIDTH_FRACTION
  const maxHeight = diameter * LABEL_HEIGHT_FRACTION

  let text = truncateLabel(rawText)

  let fontSize = LABEL_BASE_FONT_SIZE
  let style = labelStyleAt(fontSize, wordWrapWidth)
  while (
    fontSize > LABEL_MIN_FONT_SIZE &&
    CanvasTextMetrics.measureText(text, style).height > maxHeight
  ) {
    fontSize -= 1
    style = labelStyleAt(fontSize, wordWrapWidth)
  }

  while (text.length > 1 && CanvasTextMetrics.measureText(text, style).height > maxHeight) {
    text = text.slice(0, -2).trimEnd() + '…'
  }

  return { text, style }
}

function spotlightStyle(fontSize: number, wordWrapWidth: number): TextStyle {
  return new TextStyle({
    fontFamily: 'system-ui, sans-serif',
    fontSize,
    fontWeight: '600',
    fill: '#ffffff',
    stroke: { color: '#332c4a', width: Math.max(2, Math.round(fontSize * 0.16)) },
    align: 'center',
    wordWrap: true,
    wordWrapWidth,
    lineHeight: Math.round(fontSize * 1.28),
  })
}

// Same measure-and-shrink idea as fitLabel, but a spotlight never truncates:
// it's the one place a message is meant to be read in full, so only the font
// gives way.
function fitSpotlightLabel(
  text: string,
  radius: number,
): { style: TextStyle; fontSize: number } {
  const wordWrapWidth = radius * 2 * SPOTLIGHT_WIDTH_FRACTION
  const maxHeight = radius * 2 * SPOTLIGHT_HEIGHT_FRACTION

  let fontSize = SPOTLIGHT_FONT_MAX
  let style = spotlightStyle(fontSize, wordWrapWidth)
  while (
    fontSize > SPOTLIGHT_FONT_MIN &&
    CanvasTextMetrics.measureText(text, style).height > maxHeight
  ) {
    fontSize -= 1
    style = spotlightStyle(fontSize, wordWrapWidth)
  }
  return { style, fontSize }
}

function attributionStyle(fontSize: number): TextStyle {
  return new TextStyle({
    fontFamily: 'system-ui, sans-serif',
    fontSize,
    fontStyle: 'italic',
    fill: '#ffffff',
    stroke: { color: '#332c4a', width: Math.max(2, Math.round(fontSize * 0.18)) },
    align: 'center',
  })
}

export interface CloudCanvasProps {
  messages: Message[]
  justSubmittedId?: string | null
  onJustSubmittedAnimationDone?: () => void
  /** When true, the cloud gathers into the Gurudev portrait. */
  assembled?: boolean
  /** Which picture it gathers into. */
  portraitId?: PortraitId
  /** Message id -> theme, deciding each puff's colour. */
  categoryById?: Map<string, CategoryId>
  /** When set, only this theme's puffs stay lit; the rest fade back. */
  activeCategory?: CategoryId | null
}

export default function CloudCanvas({
  messages,
  justSubmittedId,
  onJustSubmittedAnimationDone,
  assembled = false,
  portraitId = DEFAULT_PORTRAIT,
  categoryById,
  activeCategory = null,
}: CloudCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const appRef = useRef<Application | null>(null)
  const viewportRef = useRef<Viewport | null>(null)
  const backdropLayerRef = useRef<Container | null>(null)
  const shadowsLayerRef = useRef<Container | null>(null)
  const puffsLayerRef = useRef<Container | null>(null)
  const labelsLayerRef = useRef<Container | null>(null)
  const spritesRef = useRef<Map<string, Sprite>>(new Map())
  const shadowsRef = useRef<Map<string, Sprite>>(new Map())
  // Labels are built on demand for the handful of puffs actually on screen,
  // never up front for the whole cloud: a Text is a rasterised canvas, and
  // making thousands of them visible at once stalls for seconds.
  // labelSource holds the cheap data a label is built from; fittedLabels
  // memoises the expensive measure-and-shrink pass; activeLabels are the ones
  // currently on screen; labelPool holds Text objects to reuse.
  const labelSourceRef = useRef<Map<string, { text: string; radius: number }>>(new Map())
  const fittedLabelsRef = useRef<Map<string, { text: string; style: TextStyle }>>(new Map())
  const activeLabelsRef = useRef<Map<string, Text>>(new Map())
  const labelPoolRef = useRef<Text[]>([])
  // Zoom alone says labels are readable; labelsVisibleRef is the effective
  // state, which also requires the portrait not to be on screen.
  const labelsZoomedInRef = useRef(false)
  const labelsVisibleRef = useRef(false)
  const readyRef = useRef(false)
  const syncPuffsRef = useRef<() => void>(() => {})
  const animatedIdsRef = useRef<Set<string>>(new Set())
  const puffMotionRef = useRef<Map<string, PuffMotion>>(new Map())
  const enteringIdsRef = useRef<Set<string>>(new Set())
  const layoutCacheRef = useRef(createLayoutCache())
  // Single tweened value the ticker reads, rather than tweening thousands of
  // sprites individually: 0 = cloud at rest, 1 = fully assembled portrait.
  const assembleProgressRef = useRef({ value: 0 })
  // Same one-tweened-value-the-ticker-reads trick as assemble: 0 = puffs at
  // their slot in the big cloud, 1 = the selected theme packed into its own.
  const gatherProgressRef = useRef({ value: 0 })
  // Which theme the current gatherX/gatherY were built for, so a re-layout
  // (e.g. a new message arriving) knows what to rebuild.
  const gatheredCategoryRef = useRef<CategoryId | null>(null)
  // Member order of the current gathered cloud, held steady across re-layouts
  // so an arriving message appends rather than reshuffling everyone.
  const gatheredOrderRef = useRef<string[]>([])
  const portraitLayoutRef = useRef<PortraitLayout | null>(null)
  // Message-less puffs that exist only to give the portrait enough pixels.
  // Kept apart from spritesRef/puffMotionRef, which are keyed by message id
  // and drive labelling, filtering and gathering — none of which apply here.
  const fillersRef = useRef<
    Array<{
      sprite: Sprite
      startX: number
      startY: number
      targetX: number
      targetY: number
    }>
  >([])
  const fillerLayerRef = useRef<Container | null>(null)
  // Forces one more ticker pass after targets change while already
  // assembled (the loop otherwise short-circuits when nothing is moving).
  const targetsDirtyRef = useRef(false)
  const runAssembleRef = useRef<(next: boolean) => void>(() => {})
  const assembledRef = useRef(assembled)
  assembledRef.current = assembled
  // Latest prop, for the imperative code below.
  const portraitIdRef = useRef(portraitId)
  portraitIdRef.current = portraitId
  // Which picture the current target slots were actually built from — the
  // prop can change while the old one is still on screen.
  const assignedPortraitRef = useRef<PortraitId | null>(null)
  const dimSpriteRef = useRef<Sprite | null>(null)
  // Spotlight lives on the stage, not in the viewport, so it sits at a fixed
  // place on screen instead of panning and zooming with the cloud.
  const spotlightLayerRef = useRef<Container | null>(null)
  const spotlightTimerRef = useRef<number | null>(null)
  const activeSpotlightsRef = useRef<Array<{ group: Container; timeline: gsap.core.Timeline }>>([])
  const recentSpotlightsRef = useRef<string[]>([])
  const applyCategoryFilterRef = useRef<() => void>(() => {})
  const runGatherRef = useRef<(category: CategoryId | null) => void>(() => {})
  const categoryByIdRef = useRef(categoryById)
  categoryByIdRef.current = categoryById
  const activeCategoryRef = useRef(activeCategory)
  activeCategoryRef.current = activeCategory

  // Latest-value refs so the imperative Pixi setup (mounted once) never
  // closes over stale props.
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const justSubmittedIdRef = useRef(justSubmittedId)
  justSubmittedIdRef.current = justSubmittedId
  const onJustSubmittedAnimationDoneRef = useRef(onJustSubmittedAnimationDone)
  onJustSubmittedAnimationDoneRef.current = onJustSubmittedAnimationDone

  // Mount Pixi once.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let disposed = false
    const app = new Application()
    appRef.current = app

    // Decode every portrait up front so an assemble command can fire with no
    // image-loading latency in the way — every screen has to start together —
    // and so switching between pictures is instant.
    for (const id of Object.keys(PORTRAITS) as PortraitId[]) {
      preloadPortrait(id)
        .then(() => {
          // The command may have arrived while the image was still loading.
          if (disposed || !assembledRef.current) return
          if (portraitIdRef.current !== id) return
          runAssembleRef.current(true)
        })
        .catch((err) => console.error(err))
    }

    function animateEntry(id: string, sprite: Sprite, targetX: number, targetY: number) {
      const viewport = viewportRef.current
      const bounds = cloudBounds()

      enteringIdsRef.current.add(id)

      sprite.x = targetX
      sprite.y = bounds.maxY + 400
      sprite.alpha = 0
      sprite.scale.set(0.3)

      const controlX = targetX + (Math.random() - 0.5) * 200
      const controlY = (sprite.y + targetY) / 2

      const tl = gsap.timeline()
      tl.to(sprite, {
        duration: 1.3,
        ease: 'power2.out',
        motionPath: {
          path: [
            { x: sprite.x, y: sprite.y },
            { x: controlX, y: controlY },
            { x: targetX, y: targetY },
          ],
          curviness: 1.5,
        },
      })
        .to(sprite, { alpha: 1, duration: 1.1, ease: 'power1.out' }, 0)
        .to(sprite.scale, { x: 1, y: 1, duration: 1.1, ease: 'back.out(1.4)' }, 0)
        .to(sprite.scale, { x: 1.08, y: 1.08, duration: 0.18, ease: 'sine.out' })
        .to(sprite.scale, { x: 1, y: 1, duration: 0.22, ease: 'sine.inOut' })
        .call(() => {
          enteringIdsRef.current.delete(id)
          // The filter skipped this puff while gsap owned its alpha, so hand
          // it back now that the tween is done.
          applyCategoryFilterRef.current()
          onJustSubmittedAnimationDoneRef.current?.()
        })

      if (viewport) {
        viewport.animate({
          time: 1300,
          position: { x: targetX, y: targetY },
          scale: Math.min(1.4, MAX_ZOOM),
          ease: 'easeInOutSine',
        })
      }
    }

    // Builds (or recycles) the Text for one puff. The measure-and-shrink pass
    // in fitLabel is the expensive part, so its result is memoised per
    // message — a label that scrolls off screen and back costs nothing the
    // second time.
    function acquireLabel(id: string): Text | undefined {
      const layer = labelsLayerRef.current
      const source = labelSourceRef.current.get(id)
      if (!layer || !source) return undefined

      let fitted = fittedLabelsRef.current.get(id)
      if (!fitted) {
        fitted = fitLabel(source.text, source.radius)
        fittedLabelsRef.current.set(id, fitted)
      }

      let label = labelPoolRef.current.pop()
      if (label) {
        label.text = fitted.text
        label.style = fitted.style
      } else {
        label = new Text({ text: fitted.text, style: fitted.style })
        label.anchor.set(0.5, 0.5)
        layer.addChild(label)
      }
      label.visible = true
      activeLabelsRef.current.set(id, label)
      return label
    }

    function releaseLabel(id: string) {
      const label = activeLabelsRef.current.get(id)
      if (!label) return
      label.visible = false
      activeLabelsRef.current.delete(id)
      labelPoolRef.current.push(label)
    }

    function releaseAllLabels() {
      for (const id of [...activeLabelsRef.current.keys()]) releaseLabel(id)
    }

    // Labels appear once the viewer has zoomed in far enough to read them
    // (they'd be unreadable clutter at full-cloud scale), and stay hidden
    // while the portrait is assembled, where they'd cover the drawing.
    function applyLabelVisibility() {
      const vp = viewportRef.current
      if (!vp) return
      labelsZoomedInRef.current = vp.scale.x >= LABEL_ZOOM_THRESHOLD
      const visible =
        labelsZoomedInRef.current &&
        assembleProgressRef.current.value < PORTRAIT_LABEL_CUTOFF
      if (visible === labelsVisibleRef.current) return
      labelsVisibleRef.current = visible
      // Which labels exist is decided per frame by what's on screen; this
      // only has to hand them all back when labels switch off entirely.
      if (!visible) releaseAllLabels()
    }

    // True when a theme is isolated and this puff isn't part of it.
    function isDimmed(category: CategoryId, active: CategoryId | null): boolean {
      return active !== null && category !== active
    }

    /**
     * How opaque a puff should be under the current filter.
     *
     * The filter releases its hold as the portrait forms. Filtering is a
     * private, per-viewer way to read the cloud, whereas the portrait is the
     * one image the whole room is looking at — and it needs every pixel, so
     * dimming most of them would leave the drawing as a sparse scatter of
     * dots. The dimming returns as the cloud disperses.
     */
    function filteredAlpha(
      category: CategoryId,
      active: CategoryId | null,
      progress: number,
    ): number {
      if (!isDimmed(category, active)) return 1
      return lerp(DIMMED_ALPHA, 1, progress)
    }

    /**
     * Applies the current theme filter across the whole cloud in one pass.
     * Driven by the selection changing, never by the ticker: alpha only moves
     * when someone clicks, and touching every sprite each frame is precisely
     * the cost the ticker's culling exists to avoid.
     */
    function applyCategoryFilter() {
      const active = activeCategoryRef.current
      const progress = assembleProgressRef.current.value
      const driftScale = 1 - progress

      for (const [id, sprite] of spritesRef.current) {
        // Still flying in — animateEntry owns its alpha until it lands.
        if (enteringIdsRef.current.has(id)) continue
        const motion = puffMotionRef.current.get(id)
        if (!motion) continue

        const alpha = filteredAlpha(motion.category, active, progress)
        sprite.alpha = alpha
        const shadow = shadowsRef.current.get(id)
        if (shadow) shadow.alpha = alpha * SHADOW_ALPHA * driftScale
        if (alpha !== 1) releaseLabel(id)
      }
    }
    applyCategoryFilterRef.current = applyCategoryFilter

    function clearSpotlights() {
      if (activeSpotlightsRef.current.length === 0) return
      for (const { group, timeline } of activeSpotlightsRef.current) {
        timeline.kill()
        group.destroy({ children: true })
      }
      activeSpotlightsRef.current = []
      // Killing the timelines skips the completion callbacks that would
      // otherwise have queued the next batch, so requeue it here or the
      // spotlight stops for good once the portrait has interrupted it.
      scheduleSpotlight(SPOTLIGHT_GAP_S * 1000)
    }

    /**
     * The messages a spotlight may draw from: the isolated theme if one is
     * selected, otherwise the whole cloud. Falls back to the whole cloud
     * rather than showing nothing if the selected theme is somehow empty.
     */
    function spotlightPool(): Message[] {
      const all = messagesRef.current
      const active = activeCategoryRef.current
      const byId = categoryByIdRef.current
      if (!active || !byId) return all
      const filtered = all.filter((m) => byId.get(m.id) === active)
      return filtered.length > 0 ? filtered : all
    }

    function pickSpotlights(count: number): Message[] {
      const pool = spotlightPool()
      if (pool.length === 0) return []

      // Prefer messages not shown recently, but fall back to the whole pool
      // so a small cloud still shows something rather than stalling.
      const recent = new Set(recentSpotlightsRef.current)
      const fresh = pool.filter((m) => !recent.has(m.id))
      const source = fresh.length >= count ? fresh : pool

      const picks: Message[] = []
      const used = new Set<string>()
      for (let i = 0; i < count && used.size < source.length; i++) {
        let pick: Message | undefined
        for (let attempt = 0; attempt < 24 && !pick; attempt++) {
          const candidate = source[Math.floor(Math.random() * source.length)]
          if (!used.has(candidate.id)) pick = candidate
        }
        if (!pick) break
        used.add(pick.id)
        picks.push(pick)
      }

      recentSpotlightsRef.current.push(...picks.map((m) => m.id))
      while (recentSpotlightsRef.current.length > SPOTLIGHT_RECENT_MEMORY) {
        recentSpotlightsRef.current.shift()
      }
      return picks
    }

    /**
     * Dwell time for a batch, driven by its wordiest message so a pair leaves
     * together rather than one blinking out while its neighbour is still
     * being read.
     */
    function spotlightHold(messages: Message[]): number {
      const words = Math.max(
        ...messages.map((m) => m.text.trim().split(/\s+/).filter(Boolean).length),
      )
      return Math.min(
        SPOTLIGHT_HOLD_MAX_S,
        Math.max(
          SPOTLIGHT_HOLD_MIN_S,
          SPOTLIGHT_HOLD_BASE_S + words * SPOTLIGHT_HOLD_PER_WORD_S,
        ),
      )
    }

    function buildSpotlight(message: Message, index: number, total: number, holdS: number) {
      const layer = spotlightLayerRef.current
      const viewport = viewportRef.current
      const currentApp = appRef.current
      if (!layer || !viewport || !currentApp) return

      const screenW = currentApp.screen.width
      const screenH = currentApp.screen.height
      const diameter =
        total > 1
          ? Math.min(screenW * SPOTLIGHT_PAIR_W, screenH * SPOTLIGHT_PAIR_H)
          : Math.min(screenW * SPOTLIGHT_SINGLE_W, screenH * SPOTLIGHT_SINGLE_H)
      const radius = diameter / 2

      const category = categoryByIdRef.current?.get(message.id) ?? FALLBACK_CATEGORY
      const group = new Container()

      const sprite = new Sprite(getPuffTexture(currentApp.renderer))
      sprite.anchor.set(0.5)
      sprite.tint = puffTint(message.hue_offset, category)
      sprite.width = diameter
      sprite.height = diameter
      group.addChild(sprite)

      const fitted = fitSpotlightLabel(message.text, radius)
      const label = new Text({ text: message.text, style: fitted.style })
      label.anchor.set(0.5)
      group.addChild(label)

      // Names are optional on the form, so most messages have none.
      const who = [message.name, message.state].filter(Boolean).join(', ')
      if (who) {
        const attribution = new Text({
          text: `— ${who}`,
          style: attributionStyle(Math.max(11, Math.round(fitted.fontSize * 0.72))),
        })
        attribution.anchor.set(0.5, 0)
        attribution.y = label.height / 2 + radius * 0.1
        group.addChild(attribution)
      }

      // Two share the screen; one sits in the middle.
      const spread = total > 1 ? screenW * 0.21 : 0
      // On wide screens the themes legend is a panel down the left, so the
      // left-hand spotlight is held clear of it. Below the CSS breakpoint the
      // legend is a bottom sheet instead and the whole width is free.
      const legendClearance = screenW > 640 ? 296 : 0
      const targetX = Math.max(
        legendClearance + diameter / 2,
        screenW / 2 + (index - (total - 1) / 2) * spread * 2,
      )
      const targetY = screenH * 0.44

      // Start from where this puff actually sits on screen, so it reads as
      // rising out of the cloud — but always from low down, so the motion is
      // a swoosh upward however the camera happens to be positioned.
      const puff = spritesRef.current.get(message.id)
      let startX = targetX
      let startY = screenH + diameter * 0.5
      if (puff) {
        const point = viewport.toScreen(puff.x, puff.y)
        startX = Math.min(Math.max(point.x, screenW * 0.12), screenW * 0.88)
        startY = Math.max(point.y, screenH * 0.86)
      }

      group.x = startX
      group.y = startY
      group.alpha = 0
      group.scale.set(0.3)
      layer.addChild(group)

      const entry = { group, timeline: gsap.timeline() }
      activeSpotlightsRef.current.push(entry)

      entry.timeline
        .to(group, {
          duration: SPOTLIGHT_IN_S,
          ease: 'power2.out',
          motionPath: {
            path: [
              { x: startX, y: startY },
              {
                x: (startX + targetX) / 2 + (index % 2 === 0 ? -1 : 1) * screenW * 0.04,
                y: (startY + targetY) / 2,
              },
              { x: targetX, y: targetY },
            ],
            curviness: 1.4,
          },
        })
        .to(group, { alpha: 1, duration: SPOTLIGHT_IN_S * 0.55, ease: 'power1.out' }, 0)
        .to(group.scale, { x: 1, y: 1, duration: SPOTLIGHT_IN_S, ease: 'back.out(1.2)' }, 0)
        .to(group, { duration: holdS })
        .to(group, {
          alpha: 0,
          y: targetY - screenH * 0.09,
          duration: SPOTLIGHT_OUT_S,
          ease: 'power1.in',
        })
        .to(
          group.scale,
          { x: 1.12, y: 1.12, duration: SPOTLIGHT_OUT_S, ease: 'power1.in' },
          '<',
        )
        .call(() => {
          activeSpotlightsRef.current = activeSpotlightsRef.current.filter(
            (item) => item !== entry,
          )
          group.destroy({ children: true })
          // Chained from actual completion rather than a fixed cycle length.
          // A timer sized to the animation is only just long enough, so on a
          // slow device the next pair arrives before the last has cleared and
          // they stack up unreadably on top of each other.
          if (activeSpotlightsRef.current.length === 0) {
            scheduleSpotlight(SPOTLIGHT_GAP_S * 1000)
          }
        })
    }

    function scheduleSpotlight(delayMs: number) {
      if (spotlightTimerRef.current !== null) {
        window.clearTimeout(spotlightTimerRef.current)
      }
      spotlightTimerRef.current = window.setTimeout(runSpotlight, delayMs)
    }

    function runSpotlight() {
      spotlightTimerRef.current = null
      if (disposed || !readyRef.current) return

      // Nothing lifts out while the portrait is up — a spotlight would sit
      // squarely on top of the picture the whole room is looking at.
      if (assembleProgressRef.current.value > PORTRAIT_LABEL_CUTOFF) {
        scheduleSpotlight(SPOTLIGHT_GAP_S * 1000)
        return
      }

      const currentApp = appRef.current
      const roomForTwo =
        currentApp !== null && currentApp.screen.width >= SPOTLIGHT_PAIR_MIN_WIDTH
      const picks = pickSpotlights(roomForTwo && Math.random() < 0.5 ? 2 : 1)
      if (picks.length === 0) {
        scheduleSpotlight(SPOTLIGHT_GAP_S * 1000)
        return
      }
      const hold = spotlightHold(picks)
      picks.forEach((message, i) => buildSpotlight(message, i, picks.length, hold))
      // The next batch is scheduled when this one finishes clearing, not here.
    }

    // The mask is sized with room to grow, so early in an event actual
    // content fills only a fraction of it — framing the whole mask would
    // strand the real messages as a tiny cluster in empty space.
    function contentFitBounds() {
      const box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
      for (const motion of puffMotionRef.current.values()) {
        box.minX = Math.min(box.minX, motion.baseX)
        box.maxX = Math.max(box.maxX, motion.baseX)
        box.minY = Math.min(box.minY, motion.baseY)
        box.maxY = Math.max(box.maxY, motion.baseY)
      }
      if (box.minX > box.maxX) return cloudBounds()
      return {
        minX: box.minX - CONTENT_FIT_PADDING,
        maxX: box.maxX + CONTENT_FIT_PADDING,
        minY: box.minY - CONTENT_FIT_PADDING,
        maxY: box.maxY + CONTENT_FIT_PADDING,
      }
    }

    function contentCentre() {
      const motions = puffMotionRef.current
      let x = 0
      let y = 0
      for (const motion of motions.values()) {
        x += motion.baseX
        y += motion.baseY
      }
      return motions.size > 0 ? { x: x / motions.size, y: y / motions.size } : { x: 0, y: 0 }
    }

    /**
     * Gives every puff its pixel slot in the portrait. Returns false when
     * there's nothing to assemble yet (no puffs, or the image hasn't
     * finished loading).
     */
    function assignPortraitTargets(id: PortraitId = portraitIdRef.current): boolean {
      const entries = [...puffMotionRef.current.values()]
      if (entries.length === 0 || !isPortraitReady(id)) return false

      // Centre the portrait on the cloud so the gather reads as the cloud
      // itself reshaping rather than flying off somewhere else.
      const centre = contentCentre()
      // Ask for enough cells to draw a sharp picture even when few messages
      // have arrived; anything the messages can't fill is made up with plain
      // puffs below.
      const slotCount = Math.max(entries.length, PORTRAIT_MIN_CELLS)
      const layout = buildPortraitLayout(
        id,
        slotCount,
        PORTRAIT_CELL_SIZE,
        centre.x,
        centre.y,
      )
      if (layout.targets.length === 0) return false

      // Pair puffs to slots by angle around the centre, so the cloud swirls
      // inward keeping its rough left/right/top/bottom relationships instead
      // of puffs streaming across each other. Both sides sort by the same
      // deterministic key, and puff positions are themselves deterministic,
      // so every client resolves the identical picture without having to
      // send any of it over the wire.
      const angleKey = (x: number, y: number) => Math.atan2(y - centre.y, x - centre.x)
      const radiusKey = (x: number, y: number) => Math.hypot(x - centre.x, y - centre.y)
      entries.sort(
        (a, b) =>
          angleKey(a.baseX, a.baseY) - angleKey(b.baseX, b.baseY) ||
          radiusKey(a.baseX, a.baseY) - radiusKey(b.baseX, b.baseY),
      )
      const targets = layout.targets
        .slice()
        .sort(
          (a, b) =>
            angleKey(a.x, a.y) - angleKey(b.x, b.y) ||
            radiusKey(a.x, a.y) - radiusKey(b.x, b.y),
        )

      const targetScale = (PORTRAIT_CELL_SIZE * PORTRAIT_PUFF_OVERLAP) / PUFF_TEXTURE_SIZE

      // Real messages are spread evenly across the whole picture rather than
      // packed into one region of it — every message should be part of the
      // face, not relegated to a corner while filler draws the rest. Striding
      // through the angle-sorted targets keeps that spread while preserving
      // the left/right/top/bottom pairing above.
      const stride = targets.length / entries.length
      const takenByMessages = new Set<number>()
      for (let i = 0; i < entries.length; i++) {
        const index = Math.min(targets.length - 1, Math.floor(i * stride))
        const motion = entries[i]
        const target = targets[index]
        motion.targetX = target.x
        motion.targetY = target.y
        motion.targetTint = target.tint
        motion.targetScale = targetScale
        takenByMessages.add(index)
      }

      const spare: PortraitTarget[] = []
      for (let i = 0; i < targets.length; i++) {
        if (!takenByMessages.has(i)) spare.push(targets[i])
      }
      syncFillers(spare, targetScale)

      portraitLayoutRef.current = layout
      assignedPortraitRef.current = id
      return true
    }

    // Deterministic [0,1) from an integer, so filler puffs start from the same
    // scattered positions on every screen rather than drifting apart.
    function hashUnit(n: number): number {
      const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453
      return x - Math.floor(x)
    }

    /**
     * Builds (or rebuilds) the message-less puffs that pad the portrait out to
     * a readable resolution.
     *
     * They begin scattered through the existing cloud rather than appearing
     * out of empty sky, so the assembly reads as the cloud thickening into the
     * picture. They fade in with the assemble and back out on release — see
     * the ticker — and are destroyed once the cloud has fully dispersed.
     */
    function syncFillers(spare: PortraitTarget[], targetScale: number) {
      const layer = fillerLayerRef.current
      const currentApp = appRef.current
      if (!layer || !currentApp) return

      const texture = getPuffTexture(currentApp.renderer)
      const box = contentFitBounds()
      const spanX = box.maxX - box.minX
      const spanY = box.maxY - box.minY
      const pool = fillersRef.current

      // Grow or shrink the pool rather than rebuilding it. Constructing twelve
      // thousand sprites is the one genuinely expensive moment in an assemble
      // — it blocks the main thread — and rebuilding on every press would pay
      // that cost in front of the whole room each time. Kept between presses,
      // only the first assemble builds anything.
      while (pool.length > spare.length) pool.pop()!.sprite.destroy()
      while (pool.length < spare.length) {
        const sprite = new Sprite(texture)
        sprite.anchor.set(0.5)
        layer.addChild(sprite)
        pool.push({ sprite, startX: 0, startY: 0, targetX: 0, targetY: 0 })
      }

      for (let i = 0; i < spare.length; i++) {
        const target = spare[i]
        const filler = pool[i]
        filler.startX = box.minX + hashUnit(i * 2 + 1) * spanX
        filler.startY = box.minY + hashUnit(i * 2 + 2) * spanY
        filler.targetX = target.x
        filler.targetY = target.y
        filler.sprite.tint = target.tint
        filler.sprite.alpha = 0
        filler.sprite.scale.set(targetScale)
        filler.sprite.x = filler.startX
        filler.sprite.y = filler.startY
      }

      layer.visible = true
    }

    /**
     * Stands the filler puffs down once the cloud has dispersed. They're kept
     * allocated for the next assemble — a hidden layer costs one skipped
     * branch per frame, whereas rebuilding costs the hitch described above.
     */
    function releaseFillers() {
      const layer = fillerLayerRef.current
      if (layer) layer.visible = false
    }

    /**
     * Packs one theme's puffs into a cloud of their own, centred where the
     * big cloud already is. Every other puff's gather slot is reset to where
     * it already sits, so it simply stays put.
     *
     * Returns the bounds of the gathered cloud so the camera can frame it, or
     * null when there's nothing in that theme.
     */
    function assignGatherTargets(category: CategoryId) {
      const motions = puffMotionRef.current
      const centre = contentCentre()

      const members: Array<{ id: string; motion: PuffMotion }> = []
      for (const [id, motion] of motions) {
        // Reset first: a puff that belonged to the previously gathered theme
        // has to be released, not left holding an old slot.
        motion.gatherX = motion.baseX
        motion.gatherY = motion.baseY
        if (motion.category === category) members.push({ id, motion })
      }
      if (members.length === 0) {
        gatheredCategoryRef.current = null
        gatheredOrderRef.current = []
        return null
      }

      // Innermost puffs take the innermost spiral slots, so the gather reads
      // as the theme condensing in place rather than every puff swapping
      // sides. Same reasoning as assignPortraitTargets' pairing by angle, and
      // like it, deterministic — no randomness to desynchronise anything.
      const distance = (m: PuffMotion) => Math.hypot(m.baseX - centre.x, m.baseY - centre.y)
      members.sort((a, b) => distance(a.motion) - distance(b.motion))

      // The packer fills its spiral by array index, so holding the member
      // order steady is what keeps already-gathered puffs in the slots they
      // are already sitting in. Without this, one message arriving mid-gather
      // would sort into the middle and shuffle the whole cloud around it.
      const byId = new Map(members.map((m) => [m.id, m]))
      const order: string[] = []
      for (const id of gatheredOrderRef.current) {
        if (byId.has(id)) {
          order.push(id)
          byId.delete(id)
        }
      }
      for (const { id } of members) if (byId.has(id)) order.push(id)
      gatheredOrderRef.current = order

      // Fitted, not the plain packer: a theme is a fraction of the cloud, and
      // at that fill the full-size mask would leave it a featureless circle.
      const slots = layoutCloudFitted(order)
      const box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
      for (let i = 0; i < order.length; i++) {
        const motion = motions.get(order[i])
        if (!motion) continue
        const x = centre.x + slots[i].x
        const y = centre.y + slots[i].y
        motion.gatherX = x
        motion.gatherY = y
        box.minX = Math.min(box.minX, x)
        box.maxX = Math.max(box.maxX, x)
        box.minY = Math.min(box.minY, y)
        box.maxY = Math.max(box.maxY, y)
      }

      gatheredCategoryRef.current = category
      return {
        minX: box.minX - CONTENT_FIT_PADDING,
        maxX: box.maxX + CONTENT_FIT_PADDING,
        minY: box.minY - CONTENT_FIT_PADDING,
        maxY: box.maxY + CONTENT_FIT_PADDING,
      }
    }

    function syncPuffs() {
      const shadowsLayer = shadowsLayerRef.current
      const puffsLayer = puffsLayerRef.current
      const labelsLayer = labelsLayerRef.current
      const currentApp = appRef.current
      if (!shadowsLayer || !puffsLayer || !labelsLayer || !currentApp || !readyRef.current) return

      const currentMessages = messagesRef.current
      const ids = currentMessages.map((m) => m.id)
      const newLayouts = layoutCacheRef.current.placeNext(ids)
      const layoutById = new Map(newLayouts.map((l) => [l.id, l]))
      const texture = getPuffTexture(currentApp.renderer)

      for (const message of currentMessages) {
        if (spritesRef.current.has(message.id)) continue
        const slot = layoutById.get(message.id)
        if (!slot) continue

        const category = categoryByIdRef.current?.get(message.id) ?? FALLBACK_CATEGORY
        const motion = makePuffMotion(slot.x, slot.y, category)
        puffMotionRef.current.set(message.id, motion)
        const width = slot.radius * 2 * motion.scaleX
        const height = slot.radius * 2 * motion.scaleY

        const shadow = new Sprite(texture)
        shadow.anchor.set(0.5)
        shadow.tint = SHADOW_COLOR
        shadow.width = width
        shadow.height = height
        shadow.rotation = motion.baseRotation

        const tint = puffTint(message.hue_offset, category)
        const sprite = new Sprite(texture)
        sprite.anchor.set(0.5)
        sprite.tint = tint
        sprite.width = width
        sprite.height = height
        sprite.rotation = motion.baseRotation

        motion.baseScaleX = sprite.scale.x
        motion.baseScaleY = sprite.scale.y
        motion.baseTint = tint
        motion.targetTint = tint
        motion.targetScale = sprite.scale.x

        // Only the raw ingredients — the Text itself is built later, and only
        // if this puff is ever actually looked at.
        labelSourceRef.current.set(message.id, {
          text: message.text,
          radius: slot.radius,
        })

        const isJustSubmitted =
          message.id === justSubmittedIdRef.current &&
          !animatedIdsRef.current.has(message.id)

        if (isJustSubmitted) {
          animatedIdsRef.current.add(message.id)
          shadow.alpha = 0
          animateEntry(message.id, sprite, slot.x, slot.y)
        } else {
          // A message arriving while a theme is isolated joins already faded
          // back if it isn't part of that theme, rather than popping in lit
          // and then dimming a frame later.
          const alpha = filteredAlpha(
            category,
            activeCategoryRef.current,
            assembleProgressRef.current.value,
          )
          sprite.x = slot.x
          sprite.y = slot.y
          sprite.alpha = alpha
          shadow.x = slot.x + SHADOW_OFFSET_X
          shadow.y = slot.y + SHADOW_OFFSET_Y
          shadow.alpha = alpha * SHADOW_ALPHA
        }

        shadowsLayer.addChild(shadow)
        puffsLayer.addChild(sprite)
        shadowsRef.current.set(message.id, shadow)
        spritesRef.current.set(message.id, sprite)
      }

      // A message arriving while the portrait is on screen still belongs in
      // the picture, so re-fit the drawing to the new puff count.
      if (assembledRef.current && assignPortraitTargets()) {
        targetsDirtyRef.current = true
      }

      // Likewise for a gathered theme: a new message of that theme should
      // join its cloud rather than hang back at its slot in the big one.
      // assignGatherTargets holds the existing member order, so the puffs
      // already gathered keep the slots they're sitting in.
      const gathered = gatheredCategoryRef.current
      if (gathered && assignGatherTargets(gathered)) {
        targetsDirtyRef.current = true
      }
    }

    syncPuffsRef.current = syncPuffs

    app
      .init({
        resizeTo: container,
        backgroundAlpha: 0,
        antialias: true,
        resolution: renderResolution(),
        autoDensity: true,
        preference: 'webgl',
      })
      .then(() => {
        if (disposed) {
          app.destroy(true, { children: true })
          return
        }
        container.appendChild(app.canvas)

        const bounds = cloudBounds()
        const worldWidth = bounds.maxX - bounds.minX + WORLD_PADDING * 2
        const worldHeight = bounds.maxY - bounds.minY + WORLD_PADDING * 2

        const viewport = new Viewport({
          screenWidth: container.clientWidth || window.innerWidth,
          screenHeight: container.clientHeight || window.innerHeight,
          worldWidth,
          worldHeight,
          events: app.renderer.events,
          ticker: app.ticker,
        })
        viewportRef.current = viewport
        app.stage.addChild(viewport)

        // Pan clamp and zoom floor are both finalized below, once the actual
        // screen size and puff bounds are known — see the comment there for
        // why (a fixed pan box can end up smaller than the view needed to
        // fit content, which confuses pixi-viewport's clamp plugin).
        viewport.drag().pinch().wheel().decelerate({ friction: 0.9 })

        // Screen-space dimmer, behind everything the viewport draws and over
        // the page's CSS sky gradient. Lives on the stage rather than in the
        // viewport so it needs no world-space maths and is unaffected by pan
        // and zoom — it simply covers the screen.
        const dim = new Sprite(Texture.WHITE)
        dim.tint = PORTRAIT_DIM_COLOR
        dim.alpha = 0
        dim.width = container.clientWidth || window.innerWidth
        dim.height = container.clientHeight || window.innerHeight
        app.stage.addChildAt(dim, 0)
        dimSpriteRef.current = dim

        // Backdrop: a few large, very-low-opacity puffs matching the cloud
        // lobes, so the mass reads as a cloud silhouette when zoomed out.
        const backdropLayer = new Container()
        const texture = getPuffTexture(app.renderer)
        for (const lobe of CLOUD_LOBES) {
          const sprite = new Sprite(texture)
          sprite.anchor.set(0.5)
          sprite.tint = CLOUD_BACKDROP_TINT
          sprite.alpha = 0.16
          sprite.x = lobe.cx
          sprite.y = lobe.cy
          sprite.width = lobe.rx * 2.2
          sprite.height = lobe.ry * 2.2
          backdropLayer.addChild(sprite)
        }
        viewport.addChild(backdropLayer)
        backdropLayerRef.current = backdropLayer

        const shadowsLayer = new Container()
        viewport.addChild(shadowsLayer)
        shadowsLayerRef.current = shadowsLayer

        // Below the message puffs: filler is scenery, and a real message
        // should never be hidden behind one.
        const fillerLayer = new Container()
        viewport.addChild(fillerLayer)
        fillerLayerRef.current = fillerLayer

        const puffsLayer = new Container()
        viewport.addChild(puffsLayer)
        puffsLayerRef.current = puffsLayer

        const labelsLayer = new Container()
        viewport.addChild(labelsLayer)
        labelsLayerRef.current = labelsLayer

        viewport.on('zoomed', applyLabelVisibility)
        viewport.on('zoomed-end', applyLabelVisibility)

        // Frames a world-space box: sizes the pan clamp and zoom floor around
        // it, then snaps (animateMs === null) or eases the camera there.
        // Shared by the initial fit and by assemble/disperse, which all need
        // the same clamp-vs-fit reconciliation.
        function frameBounds(
          box: { minX: number; maxX: number; minY: number; maxY: number },
          animateMs: number | null,
          maxZoom: number = MAX_ZOOM,
        ) {
          const el = containerRef.current
          const screenWidth = el?.clientWidth || window.innerWidth
          const screenHeight = el?.clientHeight || window.innerHeight
          const centerX = (box.minX + box.maxX) / 2
          const centerY = (box.minY + box.maxY) / 2

          const fitScale = Math.min(
            (screenWidth * 0.85) / (box.maxX - box.minX),
            (screenHeight * 0.85) / (box.maxY - box.minY),
          )
          // The zoom-out floor accommodates whichever needs to zoom out
          // further: this box, or the full reserved mask (so a viewer can
          // still pull back to the whole shape). A fixed constant can't know
          // the runtime screen size, so derive both here instead.
          const fullMaskFitScale = Math.min(
            (screenWidth * 0.85) / (bounds.maxX - bounds.minX),
            (screenHeight * 0.85) / (bounds.maxY - bounds.minY),
          )
          const minZoom = Math.min(MIN_ZOOM, fullMaskFitScale, fitScale)
          const appliedZoom = Math.max(minZoom, Math.min(fitScale, maxZoom))

          // The pan-clamp box has to be at least as big as whatever's
          // actually visible (screen size / zoom, in world units), or the
          // clamp plugin's left and right rules can't both be satisfied and
          // it fights moveCenter below — the fit zoom needed for one axis
          // often requires showing more of the other axis than the mask
          // alone spans. Use the widest zoom the camera passes through, so
          // an animated move doesn't get clamped part-way.
          const widestZoom = Math.min(appliedZoom, viewport.scale.x || appliedZoom)
          const visibleWorldWidth = screenWidth / widestZoom
          const visibleWorldHeight = screenHeight / widestZoom
          viewport
            .clamp({
              left: Math.min(bounds.minX - WORLD_PADDING, centerX - visibleWorldWidth / 2),
              right: Math.max(bounds.maxX + WORLD_PADDING, centerX + visibleWorldWidth / 2),
              top: Math.min(bounds.minY - WORLD_PADDING, centerY - visibleWorldHeight / 2),
              bottom: Math.max(bounds.maxY + WORLD_PADDING, centerY + visibleWorldHeight / 2),
              // Required: the plugin's default "center the world when it
              // underflows the screen" path ignores the explicit bounds above
              // and positions as though the world spanned 0..worldHeight. This
              // cloud is centered on the origin (negative coords included), so
              // that path would snap the view somewhere far off the content.
              underflow: 'none',
            })
            .clampZoom({ minScale: minZoom, maxScale: MAX_ZOOM })

          if (animateMs === null) {
            viewport.setZoom(appliedZoom, true)
            viewport.moveCenter(centerX, centerY)
          } else {
            viewport.animate({
              time: animateMs,
              position: { x: centerX, y: centerY },
              scale: appliedZoom,
              ease: 'easeInOutSine',
            })
          }
        }

        // The mask is sized with room to grow, so early in an event actual
        // content fills only a fraction of it — framing the whole mask would
        // strand the real messages as a tiny cluster in empty space.
        // Eases the camera onto whatever the portrait layout currently is.
        function framePortrait(layout: PortraitLayout, ms: number) {
          const centre = contentCentre()
          frameBounds(
            {
              minX: centre.x - layout.width / 2,
              maxX: centre.x + layout.width / 2,
              minY: centre.y - layout.height / 2,
              maxY: centre.y + layout.height / 2,
            },
            ms,
          )
        }

        function runAssemble(next: boolean) {
          const wantedPortrait = portraitIdRef.current

          // Already assembled and the picture changed: scatter back to the
          // cloud, swap the slots at the bottom, and re-form. At progress 1
          // the new targets would otherwise simply teleport into place.
          if (
            next &&
            assembleProgressRef.current.value > 0 &&
            assignedPortraitRef.current !== null &&
            assignedPortraitRef.current !== wantedPortrait &&
            isPortraitReady(wantedPortrait)
          ) {
            gsap.killTweensOf(assembleProgressRef.current)
            gsap
              .timeline()
              .to(assembleProgressRef.current, {
                value: 0,
                duration: PORTRAIT_SWAP_OUT_S,
                ease: 'power2.in',
              })
              .call(() => {
                if (!assignPortraitTargets(wantedPortrait)) return
                const layout = portraitLayoutRef.current
                if (layout) framePortrait(layout, ASSEMBLE_DURATION_S * 1000)
              })
              .to(assembleProgressRef.current, {
                value: 1,
                duration: ASSEMBLE_DURATION_S,
                ease: 'power2.out',
                onComplete: applyCategoryFilter,
              })
            return
          }

          if (next) {
            if (!assignPortraitTargets(wantedPortrait)) return
            const layout = portraitLayoutRef.current
            if (!layout) return

            gsap.to(assembleProgressRef.current, {
              value: 1,
              duration: ASSEMBLE_DURATION_S,
              ease: 'power2.inOut',
              overwrite: true,
              // The ticker only writes alpha for puffs on screen, so any that
              // spent the flight culled would keep a stale filter alpha once
              // it stops running. One full pass at the end settles them.
              onComplete: applyCategoryFilter,
            })
            framePortrait(layout, ASSEMBLE_DURATION_S * 1000)
          } else {
            gsap.to(assembleProgressRef.current, {
              value: 0,
              duration: DISPERSE_DURATION_S,
              ease: 'power2.inOut',
              overwrite: true,
              onComplete: () => {
                applyCategoryFilter()
                // The picture's padding has served its purpose.
                releaseFillers()
              },
            })
            frameBounds(contentFitBounds(), DISPERSE_DURATION_S * 1000)
          }
        }
        runAssembleRef.current = runAssemble

        /**
         * Pulls one theme into a cloud of its own, or releases it back.
         *
         * The camera only follows while the portrait isn't up: assembling is
         * the shared moment and owns the framing, and gathering is a private
         * per-viewer thing that must not fight it.
         */
        function runGather(category: CategoryId | null) {
          const progress = gatherProgressRef.current
          const previous = gatheredCategoryRef.current
          gsap.killTweensOf(progress)

          if (category === null) {
            if (previous === null && progress.value === 0) return
            gatheredCategoryRef.current = null
            gatheredOrderRef.current = []
            gsap.to(progress, {
              value: 0,
              duration: SCATTER_DURATION_S,
              ease: 'power2.inOut',
              // Slots stay where they are during the scatter; only once it
              // lands is it safe to forget them.
              onComplete: () => {
                for (const motion of puffMotionRef.current.values()) {
                  motion.gatherX = motion.baseX
                  motion.gatherY = motion.baseY
                }
              },
            })
            if (!assembledRef.current) {
              frameBounds(contentFitBounds(), SCATTER_DURATION_S * 1000)
            }
            return
          }

          // Straight from one theme to another: scatter the old one first,
          // then gather the new. Sliding between two packings would send both
          // sets of puffs through each other, which reads as noise.
          if (previous !== null && previous !== category && progress.value > 0) {
            gsap
              .timeline()
              .to(progress, { value: 0, duration: GATHER_SWAP_OUT_S, ease: 'power2.in' })
              .call(() => {
                const box = assignGatherTargets(category)
                if (box && !assembledRef.current) {
                  frameBounds(box, GATHER_DURATION_S * 1000, GATHER_MAX_ZOOM)
                }
              })
              .to(progress, { value: 1, duration: GATHER_DURATION_S, ease: 'power2.out' })
            return
          }

          const box = assignGatherTargets(category)
          if (!box) return
          gsap.to(progress, {
            value: 1,
            duration: GATHER_DURATION_S,
            ease: 'power2.inOut',
          })
          if (!assembledRef.current) {
            frameBounds(box, GATHER_DURATION_S * 1000, GATHER_MAX_ZOOM)
          }
        }
        runGatherRef.current = runGather

        // Above the viewport, so spotlit messages sit in front of the cloud
        // and stay put while it pans underneath them.
        const spotlightLayer = new Container()
        app.stage.addChild(spotlightLayer)
        spotlightLayerRef.current = spotlightLayer

        readyRef.current = true
        syncPuffs()
        frameBounds(contentFitBounds(), null)

        // An assemble command can land before Pixi finishes initialising.
        if (assembledRef.current) runAssemble(true)

        scheduleSpotlight(SPOTLIGHT_FIRST_DELAY_MS)

        // Gentle idle sway/rotation for every settled puff, blended toward
        // that puff's pixel slot in the portrait as assemble progress rises.
        // Puffs still flying in via animateEntry's own tween are skipped.
        let lastProgress = -1
        let lastGather = -1
        app.ticker.add(() => {
          const progress = assembleProgressRef.current.value
          const gather = gatherProgressRef.current.value
          const progressChanged = progress !== lastProgress
          const gatherChanged = gather !== lastGather
          const targetsDirty = targetsDirtyRef.current
          lastProgress = progress
          lastGather = gather
          targetsDirtyRef.current = false
          // Either transition running is reason enough to keep updating.
          const moving = progressChanged || gatherChanged || targetsDirty

          // Fully assembled and settled: nothing is moving, so skip a loop
          // that would otherwise touch every puff in the cloud every frame.
          if (progress >= 1 && !moving) return

          // Zoomed out far enough that a puff's whole drift travels less than
          // a pixel on screen, the sway is invisible — and that's exactly the
          // view where every puff in the cloud is on screen at once. Holding
          // them still costs nothing and looks identical. A gather travels far
          // further than the drift does, so it has to be exempt or starting
          // one from the zoomed-out view would freeze it.
          if (!moving && DRIFT_MAX_AMPLITUDE * viewport.scale.x < DRIFT_VISIBLE_PIXELS) {
            return
          }

          const driftScale = 1 - progress
          // Shadows fade to nothing as the portrait forms — offset copies of
          // every pixel would only muddy the drawing — so past this point
          // they can be hidden outright, which skips both the per-frame
          // updates below and the cost of rendering them.
          const showShadows = driftScale > 0.1

          if (progressChanged) {
            applyLabelVisibility()
            // The soft cloud silhouette behind the puffs would show through
            // the drawing and muddy it, so it fades out as the portrait forms.
            const backdrop = backdropLayerRef.current
            if (backdrop) backdrop.alpha = driftScale
            // ...and the sky darkens behind it, so the picture has something
            // to read against.
            const dimSprite = dimSpriteRef.current
            if (dimSprite) {
              // The assigned picture, not the requested one: during a swap the
              // old picture is still on screen until the timeline reaches the
              // bottom and reassigns.
              const shown = assignedPortraitRef.current
              dimSprite.alpha = progress * (shown ? portraitDim(shown) : 0)
            }
            // Anything already in the air would land on top of the picture.
            if (progress > PORTRAIT_LABEL_CUTOFF) clearSpotlights()
            const shadowsLayer = shadowsLayerRef.current
            if (shadowsLayer) shadowsLayer.visible = showShadows
          }

          const now = performance.now()
          // Tint and scale only change while a transition is running, and
          // rewriting them per frame across thousands of sprites is the
          // expensive part of this loop.
          const writeAppearance = progressChanged || targetsDirty
          // Labels are hidden at low zoom and while the portrait is up.
          const writeLabels = labelsVisibleRef.current
          const activeCategory = activeCategoryRef.current
          // Everything below is limited to puffs on or near the screen. A
          // puff's position is a pure function of the clock and its own
          // constants, so one left stale off screen is simply correct again
          // on the frame it returns — there's no drift to accumulate. Zoomed
          // in, this is a few hundred puffs instead of every one in the
          // cloud; the margin keeps a screen's worth ready just out of sight
          // so panning reveals finished puffs rather than blanks.
          // Filler puffs read the same progress value as everything else, so
          // padding the picture costs one lerp each while a transition is
          // running and nothing at all once it settles. They have no drift,
          // no label and no filter state — they only exist to be pixels.
          if (progressChanged || targetsDirty) {
            for (const filler of fillersRef.current) {
              filler.sprite.x = lerp(filler.startX, filler.targetX, progress)
              filler.sprite.y = lerp(filler.startY, filler.targetY, progress)
              filler.sprite.alpha = progress
            }
            // Backstop for the disperse tween's onComplete. The !assembled
            // guard matters: zero is also where an assemble *starts*, and
            // without it this destroys the fillers on the very frame after
            // they're built, leaving the portrait as just the handful of real
            // messages.
            if (progress === 0 && !assembledRef.current) releaseFillers()
          }

          const view = viewport.getVisibleBounds()
          const cullLeft = view.x - CULL_MARGIN
          const cullRight = view.x + view.width + CULL_MARGIN
          const cullTop = view.y - CULL_MARGIN
          const cullBottom = view.y + view.height + CULL_MARGIN
          // Rasterising a Text is not free, so a burst of newly-revealed
          // labels is spread over a few frames rather than stalling one.
          let acquireBudget = LABEL_ACQUIRE_PER_FRAME

          for (const [id, sprite] of spritesRef.current) {
            const motion = puffMotionRef.current.get(id)
            if (motion && !enteringIdsRef.current.has(id)) {
              // Where the puff sits ignoring its sway — cheap to derive, and
              // within a few units of the real position at any progress, so
              // it's a sound basis for the cull test without having to
              // update the sprite first. Gather first, then portrait: the
              // portrait is the shared image and has to win outright, so it
              // interpolates from wherever the gather left the puff.
              const gatheredX = lerp(motion.baseX, motion.gatherX, gather)
              const gatheredY = lerp(motion.baseY, motion.gatherY, gather)
              const settledX = lerp(gatheredX, motion.targetX, progress)
              const settledY = lerp(gatheredY, motion.targetY, progress)
              if (
                settledX < cullLeft ||
                settledX > cullRight ||
                settledY < cullTop ||
                settledY > cullBottom
              ) {
                if (activeLabelsRef.current.has(id)) releaseLabel(id)
                continue
              }

              const dx =
                Math.sin(now * motion.freqX + motion.phaseX) * motion.ampX * driftScale
              const dy =
                Math.cos(now * motion.freqY + motion.phaseY) * motion.ampY * driftScale
              const wobble =
                Math.sin(now * motion.freqR + motion.phaseR) * motion.ampR * driftScale

              // Drift is added after the gather lerp, so a gathered theme
              // keeps swaying — it should read as a cloud, not a frozen blob.
              sprite.x = lerp(gatheredX + dx, motion.targetX, progress)
              sprite.y = lerp(gatheredY + dy, motion.targetY, progress)
              sprite.rotation = motion.baseRotation * driftScale + wobble

              if (writeAppearance) {
                sprite.tint = lerpTint(motion.baseTint, motion.targetTint, progress)
                sprite.scale.set(
                  lerp(motion.baseScaleX, motion.targetScale, progress),
                  lerp(motion.baseScaleY, motion.targetScale, progress),
                )
                // A filtered-out puff fades back up as the portrait forms.
                sprite.alpha = filteredAlpha(motion.category, activeCategory, progress)
              }

              // A faded-back puff shouldn't be labelled: the text would still
              // be fully opaque and would clutter the theme being read.
              if (writeLabels && !isDimmed(motion.category, activeCategory)) {
                let label = activeLabelsRef.current.get(id)
                if (!label && acquireBudget > 0) {
                  label = acquireLabel(id)
                  acquireBudget--
                }
                if (label) {
                  label.x = sprite.x
                  label.y = sprite.y
                  label.rotation = wobble
                }
              }
            }

            // Shadow always mirrors the puff's current transform (idle,
            // assembling, or still flying in via animateEntry's tween)
            // rather than tracking its own motion, so it never drifts out of
            // sync.
            if (showShadows) {
              const shadow = shadowsRef.current.get(id)
              if (shadow) {
                shadow.x = sprite.x + SHADOW_OFFSET_X
                shadow.y = sprite.y + SHADOW_OFFSET_Y
                shadow.rotation = sprite.rotation
                shadow.alpha = sprite.alpha * SHADOW_ALPHA * driftScale
                shadow.scale.copyFrom(sprite.scale)
              }
            }
          }
        })
      })
      .catch((err) => {
        console.error('Failed to initialize the cloud canvas:', err)
        container.innerHTML =
          '<p style="padding:24px;color:#c22a4f;font:14px system-ui;">Something went wrong rendering the cloud. Check the browser console for details.</p>'
      })

    const resizeObserver = new ResizeObserver(() => {
      const vp = viewportRef.current
      if (vp && container) {
        vp.resize(container.clientWidth, container.clientHeight)
      }
      const dimSprite = dimSpriteRef.current
      if (dimSprite && container) {
        dimSprite.width = container.clientWidth
        dimSprite.height = container.clientHeight
      }
    })
    resizeObserver.observe(container)

    return () => {
      disposed = true
      resizeObserver.disconnect()
      readyRef.current = false
      if (spotlightTimerRef.current !== null) {
        window.clearTimeout(spotlightTimerRef.current)
        spotlightTimerRef.current = null
      }
      for (const { timeline } of activeSpotlightsRef.current) timeline.kill()
      activeSpotlightsRef.current = []
      spotlightLayerRef.current = null
      gsap.killTweensOf(assembleProgressRef.current)
      gsap.killTweensOf(gatherProgressRef.current)
      runAssembleRef.current = () => {}
      applyCategoryFilterRef.current = () => {}
      runGatherRef.current = () => {}
      gatheredCategoryRef.current = null
      gatheredOrderRef.current = []
      appRef.current?.destroy(true, { children: true })
      appRef.current = null
      viewportRef.current = null
      backdropLayerRef.current = null
      dimSpriteRef.current = null
      // The app teardown below destroys the sprites themselves.
      fillersRef.current = []
      fillerLayerRef.current = null
      assignedPortraitRef.current = null
      shadowsLayerRef.current = null
      puffsLayerRef.current = null
      labelsLayerRef.current = null
      spritesRef.current.clear()
      shadowsRef.current.clear()
      labelSourceRef.current.clear()
      fittedLabelsRef.current.clear()
      activeLabelsRef.current.clear()
      labelPoolRef.current.length = 0
      puffMotionRef.current.clear()
      enteringIdsRef.current.clear()
    }
  }, [])

  // Add sprites for any new messages (e.g. from realtime inserts) without
  // rebuilding the whole scene.
  useEffect(() => {
    syncPuffsRef.current()
  }, [messages])

  // Assemble into / disperse from the portrait whenever the shared command
  // changes. Before Pixi finishes initialising this is a no-op, and the
  // mount path picks up the current state instead.
  useEffect(() => {
    runAssembleRef.current(assembled)
  }, [assembled, portraitId])

  // Picking a theme fades the rest of the cloud back and pulls that theme's
  // puffs into a cloud of their own.
  useEffect(() => {
    applyCategoryFilterRef.current()
    runGatherRef.current(activeCategory)
  }, [activeCategory])

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        // Hand every touch gesture to pixi-viewport. Without this the browser
        // also claims drags and pinches for its own scroll and page zoom, so a
        // one-finger pan fights the page and a pinch zooms the chrome instead
        // of the cloud.
        touchAction: 'none',
      }}
    />
  )
}
