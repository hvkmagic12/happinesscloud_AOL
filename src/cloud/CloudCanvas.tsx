import { useEffect, useRef } from 'react'
import { Application, CanvasTextMetrics, Container, Sprite, Text, TextStyle } from 'pixi.js'
import { Viewport } from 'pixi-viewport'
import gsap from 'gsap'
import { MotionPathPlugin } from 'gsap/MotionPathPlugin'
import type { Message } from '../types'
import { createLayoutCache } from './layout'
import { CLOUD_LOBES, cloudBounds } from './cloudShape'
import { getPuffTexture, PUFF_TEXTURE_SIZE } from './puffTexture'
import { puffTint } from './color'
import { buildPortraitLayout, isPortraitReady, preloadPortrait } from './portrait'
import type { PortraitLayout } from './portrait'

gsap.registerPlugin(MotionPathPlugin)

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

interface PuffMotion {
  baseX: number
  baseY: number
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

function makePuffMotion(baseX: number, baseY: number): PuffMotion {
  return {
    baseX,
    baseY,
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

export interface CloudCanvasProps {
  messages: Message[]
  justSubmittedId?: string | null
  onJustSubmittedAnimationDone?: () => void
  /** When true, the cloud gathers into the Gurudev portrait. */
  assembled?: boolean
}

export default function CloudCanvas({
  messages,
  justSubmittedId,
  onJustSubmittedAnimationDone,
  assembled = false,
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
  const labelsRef = useRef<Map<string, Text>>(new Map())
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
  const portraitLayoutRef = useRef<PortraitLayout | null>(null)
  // Forces one more ticker pass after targets change while already
  // assembled (the loop otherwise short-circuits when nothing is moving).
  const targetsDirtyRef = useRef(false)
  const runAssembleRef = useRef<(next: boolean) => void>(() => {})
  const assembledRef = useRef(assembled)
  assembledRef.current = assembled

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

    // Decode the portrait up front so an assemble command can fire with no
    // image-loading latency in the way — every screen has to start together.
    preloadPortrait()
      .then(() => {
        // The command may have arrived while the image was still loading.
        if (!disposed && assembledRef.current) runAssembleRef.current(true)
      })
      .catch((err) => console.error(err))

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

    // Labels fade in once the viewer has zoomed in far enough to read them
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
      for (const label of labelsRef.current.values()) {
        label.visible = visible
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
    function assignPortraitTargets(): boolean {
      const entries = [...puffMotionRef.current.values()]
      if (entries.length === 0 || !isPortraitReady()) return false

      // Centre the portrait on the cloud so the gather reads as the cloud
      // itself reshaping rather than flying off somewhere else.
      const centre = contentCentre()
      const layout = buildPortraitLayout(
        entries.length,
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
      for (let i = 0; i < entries.length; i++) {
        const motion = entries[i]
        const target = targets[i % targets.length]
        motion.targetX = target.x
        motion.targetY = target.y
        motion.targetTint = target.tint
        motion.targetScale = targetScale
      }

      portraitLayoutRef.current = layout
      return true
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

        const motion = makePuffMotion(slot.x, slot.y)
        puffMotionRef.current.set(message.id, motion)
        const width = slot.radius * 2 * motion.scaleX
        const height = slot.radius * 2 * motion.scaleY

        const shadow = new Sprite(texture)
        shadow.anchor.set(0.5)
        shadow.tint = SHADOW_COLOR
        shadow.width = width
        shadow.height = height
        shadow.rotation = motion.baseRotation

        const tint = puffTint(message.hue_offset)
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

        const { text: labelText, style: labelStyle } = fitLabel(message.text, slot.radius)
        const label = new Text({ text: labelText, style: labelStyle })
        label.anchor.set(0.5, 0.5)
        label.x = slot.x
        label.y = slot.y
        label.visible = labelsVisibleRef.current

        const isJustSubmitted =
          message.id === justSubmittedIdRef.current &&
          !animatedIdsRef.current.has(message.id)

        if (isJustSubmitted) {
          animatedIdsRef.current.add(message.id)
          shadow.alpha = 0
          animateEntry(message.id, sprite, slot.x, slot.y)
        } else {
          sprite.x = slot.x
          sprite.y = slot.y
          sprite.alpha = 1
          shadow.x = slot.x + SHADOW_OFFSET_X
          shadow.y = slot.y + SHADOW_OFFSET_Y
          shadow.alpha = SHADOW_ALPHA
        }

        shadowsLayer.addChild(shadow)
        puffsLayer.addChild(sprite)
        labelsLayer.addChild(label)
        shadowsRef.current.set(message.id, shadow)
        spritesRef.current.set(message.id, sprite)
        labelsRef.current.set(message.id, label)
      }

      // A message arriving while the portrait is on screen still belongs in
      // the picture, so re-fit the drawing to the new puff count.
      if (assembledRef.current && assignPortraitTargets()) {
        targetsDirtyRef.current = true
      }
    }

    syncPuffsRef.current = syncPuffs

    app
      .init({
        resizeTo: container,
        backgroundAlpha: 0,
        antialias: true,
        resolution: window.devicePixelRatio || 1,
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

        // Backdrop: a few large, very-low-opacity puffs matching the cloud
        // lobes, so the mass reads as a cloud silhouette when zoomed out.
        const backdropLayer = new Container()
        const texture = getPuffTexture(app.renderer)
        for (const lobe of CLOUD_LOBES) {
          const sprite = new Sprite(texture)
          sprite.anchor.set(0.5)
          sprite.tint = puffTint(0)
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
          const appliedZoom = Math.max(minZoom, Math.min(fitScale, MAX_ZOOM))

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
        function contentFitBounds() {
          const box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
          for (const motion of puffMotionRef.current.values()) {
            box.minX = Math.min(box.minX, motion.baseX)
            box.maxX = Math.max(box.maxX, motion.baseX)
            box.minY = Math.min(box.minY, motion.baseY)
            box.maxY = Math.max(box.maxY, motion.baseY)
          }
          if (box.minX > box.maxX) return bounds
          return {
            minX: box.minX - CONTENT_FIT_PADDING,
            maxX: box.maxX + CONTENT_FIT_PADDING,
            minY: box.minY - CONTENT_FIT_PADDING,
            maxY: box.maxY + CONTENT_FIT_PADDING,
          }
        }

        function runAssemble(next: boolean) {
          if (next) {
            if (!assignPortraitTargets()) return
            const layout = portraitLayoutRef.current
            if (!layout) return

            gsap.to(assembleProgressRef.current, {
              value: 1,
              duration: ASSEMBLE_DURATION_S,
              ease: 'power2.inOut',
              overwrite: true,
            })
            const centre = contentCentre()
            frameBounds(
              {
                minX: centre.x - layout.width / 2,
                maxX: centre.x + layout.width / 2,
                minY: centre.y - layout.height / 2,
                maxY: centre.y + layout.height / 2,
              },
              ASSEMBLE_DURATION_S * 1000,
            )
          } else {
            gsap.to(assembleProgressRef.current, {
              value: 0,
              duration: DISPERSE_DURATION_S,
              ease: 'power2.inOut',
              overwrite: true,
            })
            frameBounds(contentFitBounds(), DISPERSE_DURATION_S * 1000)
          }
        }
        runAssembleRef.current = runAssemble

        readyRef.current = true
        syncPuffs()
        frameBounds(contentFitBounds(), null)

        // An assemble command can land before Pixi finishes initialising.
        if (assembledRef.current) runAssemble(true)

        // Gentle idle sway/rotation for every settled puff, blended toward
        // that puff's pixel slot in the portrait as assemble progress rises.
        // Puffs still flying in via animateEntry's own tween are skipped.
        let lastProgress = -1
        app.ticker.add(() => {
          const progress = assembleProgressRef.current.value
          const progressChanged = progress !== lastProgress
          const targetsDirty = targetsDirtyRef.current
          lastProgress = progress
          targetsDirtyRef.current = false

          // Fully assembled and settled: nothing is moving, so skip a loop
          // that would otherwise touch every puff in the cloud every frame.
          if (progress >= 1 && !progressChanged && !targetsDirty) return

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
            const shadowsLayer = shadowsLayerRef.current
            if (shadowsLayer) shadowsLayer.visible = showShadows
          }

          const now = performance.now()
          // Tint and scale only change while a transition is running, and
          // rewriting them per frame across thousands of sprites is the
          // expensive part of this loop.
          const writeAppearance = progressChanged || targetsDirty
          // Labels are hidden at low zoom and while the portrait is up;
          // there's no point moving thousands of invisible Text objects.
          const writeLabels = labelsVisibleRef.current

          for (const [id, sprite] of spritesRef.current) {
            const motion = puffMotionRef.current.get(id)
            if (motion && !enteringIdsRef.current.has(id)) {
              const dx =
                Math.sin(now * motion.freqX + motion.phaseX) * motion.ampX * driftScale
              const dy =
                Math.cos(now * motion.freqY + motion.phaseY) * motion.ampY * driftScale
              const wobble =
                Math.sin(now * motion.freqR + motion.phaseR) * motion.ampR * driftScale

              sprite.x = lerp(motion.baseX + dx, motion.targetX, progress)
              sprite.y = lerp(motion.baseY + dy, motion.targetY, progress)
              sprite.rotation = motion.baseRotation * driftScale + wobble

              if (writeAppearance) {
                sprite.tint = lerpTint(motion.baseTint, motion.targetTint, progress)
                sprite.scale.set(
                  lerp(motion.baseScaleX, motion.targetScale, progress),
                  lerp(motion.baseScaleY, motion.targetScale, progress),
                )
              }

              if (writeLabels) {
                const label = labelsRef.current.get(id)
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
    })
    resizeObserver.observe(container)

    return () => {
      disposed = true
      resizeObserver.disconnect()
      readyRef.current = false
      gsap.killTweensOf(assembleProgressRef.current)
      runAssembleRef.current = () => {}
      appRef.current?.destroy(true, { children: true })
      appRef.current = null
      viewportRef.current = null
      backdropLayerRef.current = null
      shadowsLayerRef.current = null
      puffsLayerRef.current = null
      labelsLayerRef.current = null
      spritesRef.current.clear()
      shadowsRef.current.clear()
      labelsRef.current.clear()
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
  }, [assembled])

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
}
