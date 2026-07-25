# Happiness Cloud — Build Spec for Claude Code

## 1. What we're building

A two-part web experience for Art of Living event feedback:

1. **Submit view** — a landing page with a single text input where a participant types a positive message and sends it.
2. **Cloud view** — after sending, the user's message animates as a small pink "puff" that rises and merges into a large collective cloud made of everyone's puffs. The user can then pan, swipe, and zoom around the big cloud, and tap/hover individual puffs to read other participants' messages.

Scale target: **400–500 messages**, smooth pan/zoom, works well on mobile touch and desktop.

Hosting: **local dev now, Netlify for production.**

---

## 2. Recommended stack

| Layer | Choice | Why |
|---|---|---|
| Frontend framework | **Vite + React + TypeScript** | Fast local dev, clean build for Netlify static hosting |
| Rendering for the cloud | **PixiJS** (WebGL canvas) | Hundreds of animated, pannable/zoomable shapes stay at 60fps; DOM/SVG with 500 nodes will not |
| Entry animation (puff rising into place) | **GSAP** (or Framer Motion if you'd rather stay in React-land for the *form* UI only) | Reliable tweening, easing, and sequencing for the "puff floats up and docks" motion |
| Pan/zoom/swipe on the big cloud | **pixi-viewport** plugin | Purpose-built for exactly this: drag, pinch-zoom, momentum, clamping |
| Backend / data store | **Supabase** (Postgres + REST + realtime) | Free tier is plenty for 500 rows; gives you realtime so new puffs appear live for everyone; works identically local and on Netlify since it's just an API |
| Serving new messages to the app | Supabase client SDK direct from the frontend (no custom server needed) | Simplest path to Netlify (pure static site + external DB, no serverless function required for reads/writes) |
| Optional moderation | A `approved` boolean column, default `true` or `false` depending on whether you want to review messages before they appear | Prevents spam/inappropriate text from appearing publicly without review |
| Deployment | **Netlify** (static site), env vars for Supabase URL/anon key | Matches your requirement |

Why not "just a JSON file"? A flat file works for a single local demo, but on Netlify a static file can't accept writes, and multiple simultaneous submitters would race/overwrite each other. Supabase avoids building a custom backend while still giving you real persistence and realtime updates. If you'd rather avoid any external service, the fallback is **Netlify Functions + Netlify Blobs** (see Section 6).

---

## 3. Data model

Single table, `messages`:

| column | type | notes |
|---|---|---|
| `id` | uuid, primary key, default `gen_random_uuid()` | |
| `text` | text, not null, max ~200 chars | enforce max length client-side and with a DB check constraint |
| `created_at` | timestamptz, default `now()` | used to order/seed cloud position deterministically |
| `x` | float | pre-computed or computed on read; position within the cloud |
| `y` | float | pre-computed or computed on read |
| `hue_offset` | float | small random variance so puffs aren't all identical pink |
| `approved` | boolean, default true | flip to false-by-default if you want a moderation queue |

Positions (`x`, `y`) can either be:
- **Stored** at insert time using a packing algorithm (Section 5), so the layout is stable across reloads, or
- **Computed client-side** on load using a seeded random/packing function keyed off `id`, so you don't need to store x/y at all.

Recommendation: compute client-side with a seeded layout (simpler schema, same visual result, avoids a layout migration if you change the packing algorithm later).

---

## 4. App flow / pages

### Route `/` — Submit view
- Full-screen soft sky-gradient background.
- Centered card: heading ("Share something positive from this week"), text input (single line or small textarea, character counter, ~200 char cap), Send button.
- On submit:
  1. Insert row into Supabase `messages`.
  2. Transition to Cloud view, passing the new message's id so it can be visually highlighted as "yours."

### Route `/cloud` — Cloud view
- Fetches all approved messages on load.
- Renders the big cloud (Section 5).
- Plays the entry animation for the just-submitted puff (Section 5.3) if the user arrived from the submit flow.
- Supports pan (drag/swipe), pinch-to-zoom, scroll-to-zoom.
- Tap/click a puff → small tooltip/card popup showing that message's text.
- A subtle "X messages shared this week" counter is a nice touch, optional.
- Realtime: subscribe to Supabase inserts so new puffs from other people fade in live without a refresh (optional but easy with Supabase's realtime channel).

---

## 5. How the cloud + animations actually work

### 5.1 Rendering approach — why WebGL/canvas, not 500 DOM divs
With 400–500 independently animated, pannable, zoomable shapes, DOM elements (even with CSS transforms) will start dropping frames, especially on mobile — every pan/zoom frame triggers layout/paint on hundreds of nodes. **PixiJS** renders everything on a single WebGL canvas as sprites/graphics objects, so pan and zoom are just matrix transforms on the GPU. This is the standard approach for "many small interactive shapes at once" (particle systems, data-viz swarms, etc.) and is the part of this project most likely to feel bad if skipped.

### 5.2 Building a "cloud" shape out of many puffs
- Each message = one **puff**: a soft, blurred circular/blob PNG or an SVG blob converted to a Pixi texture, tinted a pink shade (base hue + `hue_offset` for subtle variation).
- Puffs are laid out using a **packing algorithm** so they cluster into a cloud silhouette instead of a grid:
  - Simplest: **Poisson-disk sampling** or a spiral/phyllotaxis layout (sunflower-seed pattern) constrained inside a cloud-shaped mask (an SVG cloud outline used as a bitmap hit-test — only accept candidate points that fall inside the mask).
  - Alternative: a physics-lite approach using a force layout (d3-force with collision) run once at load time to settle puffs into a blobby mass, then cache the resulting positions.
- Layer a few large, very-low-opacity "backdrop" puffs behind the small ones to give the mass a soft cloud silhouette at zoomed-out view, so it doesn't just look like a scatter of dots.

### 5.3 The "puff rises and joins the cloud" entry animation
Sequence (GSAP timeline), triggered right after a successful submit:
1. Small puff spawns at the bottom of the screen, low opacity, small scale.
2. Tween: float upward along a gently curved path (use GSAP's `MotionPathPlugin` or a simple bezier interpolation) while opacity and scale increase — mimicking a cloud puff drifting up.
3. As it approaches its assigned slot in the big cloud (its packed x/y from Section 5.2), ease into that exact position and settle (slight overshoot + settle reads as "joining").
4. On arrival, briefly highlight/glow it (e.g., pulse scale 1 → 1.08 → 1) so the user sees *which one is theirs*, then let it blend into the crowd at normal opacity.
5. Camera (pixi-viewport) can simultaneously ease its center/zoom toward that region of the cloud so the join is visible even if the full cloud is large.

Because this is a single new object animating into a canvas that's otherwise idle, it's cheap even though the full cloud has hundreds of members — you're only tweening one sprite's transform each time, not all 500.

### 5.4 Pan / zoom / swipe on the assembled cloud
- `pixi-viewport` (a plugin built for exactly this on top of PixiJS) gives you drag-to-pan, pinch/scroll-to-zoom, momentum/inertia, and clamped bounds out of the box — you configure min/max zoom and a bounding box around the cloud so users can't pan/zoom into empty void.
- Click/tap handling: each puff sprite gets `interactive = true` and a `pointertap` handler that opens a small message popup (rendered as a normal React/HTML overlay positioned at the sprite's current screen coordinates, or as a Pixi text bubble — HTML overlay is simpler to style nicely).
- At low zoom, you can fade small puffs' text-hit-targets and just show the cloud silhouette; at higher zoom, puffs become individually distinguishable and tappable (classic "cluster to individual" pattern, similar to map pin clustering).

### 5.5 Performance for 400–500 items specifically
- 500 sprites on a single WebGL canvas is trivial for any modern device — the earlier DOM-based concern goes away entirely with Pixi.
- Batch textures (use a single spritesheet/texture atlas for the puff graphic variants) so Pixi can batch-render them in as few draw calls as possible.
- Only run the packing/layout algorithm once (cache positions), not on every render.
- Debounce the realtime "new message" subscription so a burst of submissions doesn't retrigger layout thrash.

---

## 6. Netlify + local hosting notes

- **Local dev:** `npm run dev` (Vite) against a Supabase project — same project can be used locally and in production, or use a separate `-dev` Supabase project and swap env vars.
- **Env vars:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — set locally in `.env.local`, and in Netlify's Site settings → Environment variables for production.
- **Netlify build:** static Vite build (`npm run build`, publish dir `dist`), no serverless functions required if using Supabase directly from the client (the anon key is safe to expose client-side; lock down writes with a Supabase Row Level Security policy that only allows inserts with a valid length/content check, and only allows reads of `approved = true` rows).
- **No-external-service fallback:** if you'd rather not stand up Supabase, the same app works with **Netlify Functions** (`/netlify/functions/messages.ts`) reading/writing to **Netlify Blobs** as a simple key-value/JSON store. You lose realtime subscriptions (poll every N seconds instead) but keep everything inside Netlify's own product. Mention which of these two you'd prefer and the instructions below can be adjusted.

---

## 7. Step-by-step instructions for Claude Code

Give Claude Code this file plus the following task list:

1. Scaffold a Vite + React + TypeScript project.
2. Install dependencies: `pixi.js`, `pixi-viewport`, `gsap`, `@supabase/supabase-js`, `react-router-dom`.
3. Set up a Supabase project (or stub it locally with instructions for the user to create one), create the `messages` table per Section 3, and add an RLS policy allowing public insert (with a server-side length check) and public select where `approved = true`.
4. Build the Submit view (`/`) per Section 4, wired to insert into Supabase.
5. Build the Cloud view (`/cloud`):
   - A `CloudCanvas` component that mounts a Pixi `Application` and `Viewport`.
   - A layout module implementing the packing algorithm from Section 5.2, taking an array of message ids and returning `{id, x, y}[]`.
   - Puff sprite creation + tinting + interactivity (tap → open message popup).
   - The GSAP entry-animation sequence from Section 5.3 for a freshly-submitted message.
   - Realtime subscription to insert new puffs live (optional flag to disable if not wanted).
6. Add a lightweight message popup component (HTML overlay, not Pixi text) that follows the tapped sprite's screen position.
7. Add basic empty/loading/error states (no messages yet, fetch failed, etc.).
8. Write a `.env.example` with the two Supabase env vars.
9. Add a `README.md` covering: local setup, Supabase table/RLS SQL, and Netlify deploy steps (connect repo, set build command/publish dir, set env vars).
10. Test with a seed script that inserts ~450 fake messages, to confirm pan/zoom/animation performance at target scale before real event data comes in.

---

## 8. Open questions to settle before/while building
- Moderation: auto-approve everything, or review queue before messages appear publicly?
- Should the "yours" puff stay visually marked (e.g., a small outline) so a user can find their own message again later, or blend in permanently after the entry animation?
- Any profanity/length filtering needed beyond a character cap?
- Do you want a live counter or "X people shared this week" stat visible on the submit page too?
