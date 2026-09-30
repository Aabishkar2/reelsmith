# Scene Templates

Every video is composed of scenes. Each scene is a `<Sprite>` whose timing is determined by the voiceover chunk for that scene — use `useSceneWindow(N)` for every scene-level Sprite. Scenes overlap by 0.5s with the next for smooth transitions.

## Visual Pacing — Hard Rule

**No image held static for more than 3 seconds.** Every scene with a background image must use one of the motion primitives from `animations.jsx`:

| Scene duration | Required primitive |
|---|---|
| ≤4s | `KenBurns` — single image with zoom+pan |
| 4–8s | `ImageCut` — 2 images, cut at ~3s mark |
| >8s | `ImageCut` — 3+ images, cuts every 2–3s |
| Two spatially related images | `Parallax` — depth drift |

`SceneBg` (the old static helper from `components.md`) is **deprecated** for new videos. Replace it with `KenBurns` or `ImageCut`.

**Before writing HTML**, plan the cuts:
1. List images available for each scene (from `script.md` Scene Hints / research.md Visual targets)
2. Compute cut timestamps: scene duration ÷ number of images ≈ interval (target 2–3s per image)
3. Write `<ImageCut images={[...]} cuts={[0, cut1, ...]} localTime={localTime} duration={duration} />`

## Timing Guidelines

| Scene type | Duration | Animation guidance |
|---|---|---|
| breaking-opener | determined by voiceover chunk — design animations to fit comfortably | Strong hook — keep animations punchy and immediate |
| context-stat | determined by voiceover chunk — design animations to fit comfortably | Longer narration gives more time for stat punch-in |
| talking-head-context | determined by voiceover chunk — design animations to fit comfortably | Standard for person/country attribution |
| timeline-events | determined by voiceover chunk — design animations to fit comfortably | Stagger rows 0.3s apart; all rows should enter well before midpoint |
| impact | determined by voiceover chunk — design animations to fit comfortably | Short and punchy — minimal elements |
| cta-end | determined by voiceover chunk — design animations to fit comfortably | Centered, simple fade-in composition |

Total video target: **45–60 seconds**. Aim for 6–8 scenes. Not every template needs to be used — use what the story requires.

---

## Template: breaking-opener

**Use for:** Scene 1 always. The hook.

**Contains:**
- Full-bleed background image — use `KenBurns` (hook scene is typically 6–12s; use `ImageCut` with 2 images if >6s)
- `DateBadge` — top left
- `BreakingTag` — below date badge
- `Divider` — above headline
- Large headline (68–72px Barlow Condensed 800)
- Subheadline / context line

**Layout:**
```
[DATE BADGE]          top-left, y=80
[BREAKING TAG]        top-left, y=124
                      ... (image fills background)
[DIVIDER LINE]        bottom area, above headline
[HEADLINE]            large, bottom area
[SUBHEADLINE]         smaller, below headline
```

**Timing deltas (localTime offsets):**
- DateBadge: starts at 0
- BreakingTag: starts at 0
- Divider: delay 0.3s
- Headline: delay 0.4s — or bind to `useWordCue` for the person/subject name
- Subheadline: delay 0.7s — or bind to `useWordCue`
- SubtitleRail: always present, no delay needed (self-managed)

**Image motion:**
```jsx
// ≤6s: single KenBurns
<KenBurns src="hook-image.jpg" localTime={localTime} duration={duration}
  endScale={1.06} panTo={{ x: 1, y: 0 }} />

// >6s: ImageCut with 2 images
<ImageCut
  images={[
    { src: "hook-image-a.jpg", panDir: { x: 1, y: 0 } },
    { src: "hook-image-b.jpg", position: "center top", panDir: { x: 0, y: -1 } },
  ]}
  cuts={[0, 3.0]}
  localTime={localTime} duration={duration}
/>
```

---

## Template: context-stat

**Use for:** Explaining what something is + a big number that proves why it matters.

**Contains:**
- Full-bleed background — use `ImageCut` with 2 images (establishing shot → detail shot)
- Section label (red uppercase, 20px)
- Headline (52px)
- `Stat` component with large number + label text

**Timing deltas:**
- Label: 0s
- Headline: delay 0.15s
- Stat: delay 0.5s (punch-in animation)

**Image motion:**
```jsx
<ImageCut
  images={[
    { src: "wide-establishing.jpg", panDir: { x: 0, y: -1 } },
    { src: "detail-shot.jpg", position: "center top", panDir: { x: 1, y: 0 } },
  ]}
  cuts={[0, Math.min(3.0, duration * 0.45)]}
  localTime={localTime} duration={duration}
/>
```

---

## Template: talking-head-context

**Use for:** Attributing actions to a person, country, or official. Best with a portrait/official photo as background.

**Contains:**
- Full-bleed background — use `KenBurns` (portrait with slow upward pan feels cinematic)
- Section label
- Headline (52px)
- Body text (26px)

**Timing deltas:**
- Label: 0s
- Headline: delay 0.15s
- Body: delay 0.45s

**Image motion:**
```jsx
// Portrait: zoom in + slow upward pan
<KenBurns
  src="portrait.jpg"
  position="center top"
  localTime={localTime} duration={duration}
  startScale={1.0} endScale={1.06}
  panFrom={{ x: 0, y: 1 }} panTo={{ x: 0, y: -1 }}
/>
// If duration >6s, add a second image cut (e.g., context/location shot)
```

---

## Template: timeline-events

**Use for:** A sequence of events that happened in order (Friday/Saturday, before/after, Step 1/Step 2).

**Contains:**
- Full-bleed background — use `ImageCut`, cycling images as rows appear (1 image per row works well)
- Multiple labeled rows: `[DAY/STEP]  [Event description]`
  - Day/Step label: red, uppercase, Barlow Condensed 800, 22px, minWidth 80px
  - Event text: Barlow 400, 26px
- Optional condition/callout box (red-tinted background with border)

**Timing deltas:**
- Row 1: 0s
- Row 2: delay 0.3s
- Row 3: delay 0.6s (if present)
- Condition box: delay 0.6–0.9s

**Image motion:** sync cuts to row reveals — cut to new image ~0.2s before each new row
```jsx
<ImageCut
  images={[
    { src: "event-before.jpg", panDir: { x: 0, y: -1 } },
    { src: "event-after.jpg", panDir: { x: 1, y: 0 } },
    { src: "event-result.jpg", panDir: { x: 0, y: 1 } },
  ]}
  cuts={[0, 2.8, 5.8]}   // just before each row's reveal
  localTime={localTime} duration={duration}
/>
```

---

## Template: impact

**Use for:** Consequences, what happens next, market/global effects. Often penultimate scene before CTA.

**Contains:**
- Full-bleed background — use `ImageCut` with 2 images or `Parallax` if images are spatially related (wide shot + close-up)
- Section label "The Impact" (or similar)
- Headline (52px) — the key consequence
- Body text — one sentence on secondary effect

**Timing deltas:**
- Label: 0s
- Headline: delay 0.2s
- Body: delay 0.45s

**Image motion:**
```jsx
// Option A: two-image cut
<ImageCut
  images={[
    { src: "impact-wide.jpg", panDir: { x: 1, y: 0 } },
    { src: "impact-detail.jpg", position: "center top" },
  ]}
  cuts={[0, 3.0]}
  localTime={localTime} duration={duration}
/>

// Option B: parallax depth (e.g., aerial + street level)
<Parallax
  bg={{ src: "aerial.jpg" }}
  fg={{ src: "street.jpg", x: 48, y: 380, width: 624, height: 340, radius: 8 }}
  localTime={localTime} duration={duration}
  direction="up" amount={28}
/>
```

---

## Template: cta-end

**Use for:** Always the last scene.

**Contains:**
- Solid dark background (`#080c14`)
- Red pulse dot (centered)
- "Follow for daily [topic] updates" (centered, 42px Barlow Condensed 800)
- Short red divider line (centered)

No background image. No section label. Centered layout. Fade in and out.

---

## Combining Templates — Example Structure

```jsx
// Scene order (timings come from scenes.json via useSceneWindow — do not hardcode)
// SubtitleRail is REQUIRED on every narrated scene — add as last child of root div
<Sprite {...useSceneWindow(1)}>
  {({ localTime, duration }) => (
    <div style={{ position: 'absolute', inset: 0 }}>
      {/* breaking-opener content */}
      <SubtitleRail sceneIdx={1} />
    </div>
  )}
</Sprite>
<Sprite {...useSceneWindow(2)}>
  {({ localTime, duration }) => (
    <div style={{ position: 'absolute', inset: 0 }}>
      {/* context-stat content */}
      <SubtitleRail sceneIdx={2} />
    </div>
  )}
</Sprite>
<Sprite {...useSceneWindow(3)}>
  {({ localTime, duration }) => (
    <div style={{ position: 'absolute', inset: 0 }}>
      {/* timeline-events content */}
      <SubtitleRail sceneIdx={3} bottom={380} />
    </div>
  )}
</Sprite>
{/* ... remaining scenes ... */}
<Sprite {...useSceneWindow(7)}>
  {({ localTime, duration }) => (
    <CTACard localTime={localTime} duration={duration} />
    // No SubtitleRail — CTA is exempt
  )}
</Sprite>
```

Scene indices (N in `useSceneWindow(N)`) are 1-based and must match the `### Scene N` headers in `script.md`.
