import { useEffect, useRef } from 'react'
import { Application, CanvasTextMetrics, Container, Sprite, Text, TextStyle } from 'pixi.js'
import { Viewport } from 'pixi-viewport'
import gsap from 'gsap'
import { MotionPathPlugin } from 'gsap/MotionPathPlugin'
import type { Message } from '../types'
import { layoutCloud } from './layout'
import { CLOUD_LOBES, cloudBounds } from './cloudShape'
import { getPuffTexture } from './puffTexture'
import { puffTint } from './color'

gsap.registerPlugin(MotionPathPlugin)

const MIN_ZOOM = 0.35
const MAX_ZOOM = 4
const WORLD_PADDING = 500
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
  baseRotation: number
  scaleX: number
  scaleY: number
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function periodToFreq(periodMs: number): number {
  return (Math.PI * 2) / periodMs
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
    baseRotation: randomBetween(0, Math.PI * 2),
    scaleX: 1 + randomBetween(-SHAPE_SCALE_JITTER, SHAPE_SCALE_JITTER),
    scaleY: 1 + randomBetween(-SHAPE_SCALE_JITTER, SHAPE_SCALE_JITTER),
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
}

export default function CloudCanvas({
  messages,
  justSubmittedId,
  onJustSubmittedAnimationDone,
}: CloudCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const appRef = useRef<Application | null>(null)
  const viewportRef = useRef<Viewport | null>(null)
  const shadowsLayerRef = useRef<Container | null>(null)
  const puffsLayerRef = useRef<Container | null>(null)
  const labelsLayerRef = useRef<Container | null>(null)
  const spritesRef = useRef<Map<string, Sprite>>(new Map())
  const shadowsRef = useRef<Map<string, Sprite>>(new Map())
  const labelsRef = useRef<Map<string, Text>>(new Map())
  const labelsVisibleRef = useRef(false)
  const readyRef = useRef(false)
  const syncPuffsRef = useRef<() => void>(() => {})
  const animatedIdsRef = useRef<Set<string>>(new Set())
  const puffMotionRef = useRef<Map<string, PuffMotion>>(new Map())
  const enteringIdsRef = useRef<Set<string>>(new Set())

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

    function syncPuffs() {
      const shadowsLayer = shadowsLayerRef.current
      const puffsLayer = puffsLayerRef.current
      const labelsLayer = labelsLayerRef.current
      const currentApp = appRef.current
      if (!shadowsLayer || !puffsLayer || !labelsLayer || !currentApp || !readyRef.current) return

      const currentMessages = messagesRef.current
      const ids = currentMessages.map((m) => m.id)
      const layout = layoutCloud(ids)
      const layoutById = new Map(layout.map((l) => [l.id, l]))
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

        const sprite = new Sprite(texture)
        sprite.anchor.set(0.5)
        sprite.tint = puffTint(message.hue_offset)
        sprite.width = width
        sprite.height = height
        sprite.rotation = motion.baseRotation

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

        viewport
          .drag()
          .pinch()
          .wheel()
          .decelerate({ friction: 0.9 })
          .clamp({
            left: bounds.minX - WORLD_PADDING,
            right: bounds.maxX + WORLD_PADDING,
            top: bounds.minY - WORLD_PADDING,
            bottom: bounds.maxY + WORLD_PADDING,
          })
          .clampZoom({ minScale: MIN_ZOOM, maxScale: MAX_ZOOM })

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

        const shadowsLayer = new Container()
        viewport.addChild(shadowsLayer)
        shadowsLayerRef.current = shadowsLayer

        const puffsLayer = new Container()
        viewport.addChild(puffsLayer)
        puffsLayerRef.current = puffsLayer

        const labelsLayer = new Container()
        viewport.addChild(labelsLayer)
        labelsLayerRef.current = labelsLayer

        // Toggle feedback labels on/off as the viewer crosses the zoom
        // threshold, instead of requiring a click to read each message.
        function updateLabelVisibility() {
          const vp = viewportRef.current
          if (!vp) return
          const shouldShow = vp.scale.x >= LABEL_ZOOM_THRESHOLD
          if (shouldShow === labelsVisibleRef.current) return
          labelsVisibleRef.current = shouldShow
          for (const label of labelsRef.current.values()) {
            label.visible = shouldShow
          }
        }
        viewport.on('zoomed', updateLabelVisibility)
        viewport.on('zoomed-end', updateLabelVisibility)

        // Fit the whole cloud in view initially.
        const screenWidth = container.clientWidth || window.innerWidth
        const screenHeight = container.clientHeight || window.innerHeight
        const fitScale = Math.min(
          (screenWidth * 0.85) / (bounds.maxX - bounds.minX),
          (screenHeight * 0.85) / (bounds.maxY - bounds.minY),
        )
        viewport.setZoom(Math.max(MIN_ZOOM, Math.min(fitScale, MAX_ZOOM)), true)
        viewport.moveCenter(
          (bounds.minX + bounds.maxX) / 2,
          (bounds.minY + bounds.maxY) / 2,
        )

        // Gentle idle sway/rotation for every settled puff (skipped while a
        // puff is still flying in via animateEntry's own tween of x/y).
        app.ticker.add(() => {
          const now = performance.now()
          for (const [id, sprite] of spritesRef.current) {
            const motion = puffMotionRef.current.get(id)
            if (motion && !enteringIdsRef.current.has(id)) {
              const dx = Math.sin(now * motion.freqX + motion.phaseX) * motion.ampX
              const dy = Math.cos(now * motion.freqY + motion.phaseY) * motion.ampY
              const wobble = Math.sin(now * motion.freqR + motion.phaseR) * motion.ampR

              sprite.x = motion.baseX + dx
              sprite.y = motion.baseY + dy
              sprite.rotation = motion.baseRotation + wobble

              const label = labelsRef.current.get(id)
              if (label) {
                label.x = motion.baseX + dx
                label.y = motion.baseY + dy
                label.rotation = wobble
              }
            }

            // Shadow always mirrors the puff's current transform (idle or
            // still flying in via animateEntry's tween) rather than tracking
            // its own motion, so it never drifts out of sync.
            const shadow = shadowsRef.current.get(id)
            if (shadow) {
              shadow.x = sprite.x + SHADOW_OFFSET_X
              shadow.y = sprite.y + SHADOW_OFFSET_Y
              shadow.rotation = sprite.rotation
              shadow.alpha = sprite.alpha * SHADOW_ALPHA
              shadow.scale.copyFrom(sprite.scale)
            }
          }
        })

        readyRef.current = true
        syncPuffs()
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
      appRef.current?.destroy(true, { children: true })
      appRef.current = null
      viewportRef.current = null
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

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
}
