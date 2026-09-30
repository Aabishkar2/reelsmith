# Component Library Reference

These components are available globally (from `animations.jsx` and defined inline in each HTML file). Do not re-define them — use them directly.

## From animations.jsx (global, no import needed)

### `Stage` — the root container and timeline

```jsx
<Stage
  width={720}          // canvas width in px
  height={1280}        // canvas height in px
  scenesSrc="scenes.json"  // path to scenes.json — Stage computes total duration from this
  background="#000"    // canvas background color
  loop={false}         // whether to loop after end
  autoplay={true}      // start playing on mount
  persistKey="unique-video-key"  // localStorage key for playhead position
>
  {/* your scenes */}
</Stage>
```

## Motion: `spring`, `track`, `seededRandom`

Pure functions of time from `animations.jsx` — safe for frame-by-frame rendering.

```jsx
// spring(t, k = 170, d = 26) → 0..1 (may overshoot above 1 when d is low)
const cue = useWordCue(2, "600 milliseconds");
const s = spring(localTime - cue, 200, 14);            // bouncy punch-in
<div style={{ transform: `scale(${0.6 + 0.4 * s})`, opacity: clamp(s, 0, 1) }}>+600ms</div>

// track(t, [[time, value], ...], k, d) → chained keyframes, each move springs from the last
const x = track(localTime, [[0, -720], [cueA, 0], [cueB, 180]], 320, 30);

// Stretchy indicator: leading edge stiffer than trailing edge
const lead  = track(localTime, stops, 320, 30);
const trail = track(localTime, stops, 140, 22);
const left = Math.min(lead, trail), right = Math.max(lead, trail) + 120;

// seededRandom(seed) → () => 0..1, identical every render. Never use Math.random.
const rand = seededRandom(7);
const dots = Array.from({ length: 24 }, () => ({ x: rand() * 720, y: rand() * 1280 }));
```

Presets: snappy UI `k=320, d=30` · soft/heavy `k=140, d=22` · bouncy punch `k=200, d=14`. No overshoot when `d ≥ 2·√k`.

## Scene timing: `useSceneWindow`

All scene durations come from the voiceover, not from hardcoded numbers. At the top of your index.html, pass `scenesSrc="scenes.json"` to `<Stage>`. Inside each scene's `<Sprite>`, use the `useSceneWindow(N)` hook — it returns `{ start, end }` for scene N (1-based), with the 0.5s overlap between adjacent scenes already applied.

```jsx
<Stage width={720} height={1280} scenesSrc="scenes.json" persistKey="my-video">
  <Sprite {...useSceneWindow(1)}>
    {/* scene 1 content */}
  </Sprite>
  <Sprite {...useSceneWindow(2)}>
    {/* scene 2 content */}
  </Sprite>
</Stage>
```

Rules:
- Do NOT define a `TOTAL` constant — Stage computes total duration from `scenes.json`.
- Do NOT hardcode `start`/`end` on scene-level Sprites — always use `useSceneWindow`.
- Scene indices are 1-based and match `### Scene N` headers in `script.md`.
- Design animations to fit comfortably in the measured duration listed in the prompt for each scene. If narration is longer than your animation, the Sprite's exit animations simply fire later — scenes hold their composition naturally.

### `Sprite` — time-gated scene container

Only renders children when `start <= currentTime <= end`.

```jsx
<Sprite start={7} end={16.5}>
  {({ localTime, progress, duration }) => (
    /* render scene content */
    /* localTime = seconds since start of this sprite */
    /* progress = 0..1 through the sprite duration */
  )}
</Sprite>
```

### `useTime()` — read current playhead time

```jsx
const t = useTime(); // global playhead time in seconds
```

### `Easing` — easing functions

Available: `easeOutCubic`, `easeOutBack`, `easeInCubic`, `easeOutElastic`, `easeInOutCubic`, `easeOutQuad`, `easeInQuad`, `linear`, and more.

```jsx
const t = Easing.easeOutCubic(progress); // 0..1 → 0..1
```

### `clamp(value, min, max)` — clamp a number

```jsx
const t = clamp(localTime / 0.5, 0, 1);
```

---

## Helper functions — define these at the top of your script block

Always include these in the HTML file:

```jsx
function fadeIn(t, dur = 0.4) {
  return Math.min(1, t / dur);
}
function fadeOut(t, totalDur, dur = 0.35) {
  const exitStart = totalDur - dur;
  if (t > exitStart) return 1 - (t - exitStart) / dur;
  return 1;
}
function fade(localTime, duration, inDur = 0.4, outDur = 0.35) {
  return Math.min(fadeIn(localTime, inDur), fadeOut(localTime, duration, outDur));
}
function slideUp(localTime, inDur = 0.45) {
  const t = clamp(localTime / inDur, 0, 1);
  const e = Easing.easeOutCubic(t);
  return { opacity: e, transform: `translateY(${(1 - e) * 22}px)` };
}
```

**Usage of `slideUp`:**
```jsx
<div style={{ ...slideUp(Math.max(0, localTime - 0.2), 0.5) }}>
  Headline text
</div>
```

---

## Scene Components — define these in the HTML file

### `SceneBg` — full-bleed image with dark gradient overlay

```jsx
function SceneBg({ src, position = 'center', duration, start }) {
  const t = useTime();
  const local = t - start;
  const op = Math.min(fade(local, duration, 0.5, 0.5), 1);
  const scale = 1 + 0.03 * clamp(local / duration, 0, 1); // Ken Burns
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: op, overflow: 'hidden' }}>
      <img src={src} alt="" style={{
        width: '100%', height: '100%',
        objectFit: 'cover',
        objectPosition: position,
        transform: `scale(${scale})`,
        transformOrigin: 'center',
      }}/>
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.55) 45%, rgba(0,0,0,0.3) 100%)',
      }}/>
    </div>
  );
}
```

**Props:**
- `src` — image path (e.g. `uploads/strait.png`)
- `position` — CSS `object-position` (e.g. `'center'`, `'center top'`, `'50% 30%'`)
- `duration` — scene duration in seconds (for fade timing)
- `start` — scene start time in seconds (for Ken Burns timing)

### `BreakingTag` — red "Breaking" pill with pulse dot

```jsx
function BreakingTag({ localTime, x = 48, y = 96 }) {
  const op = clamp(localTime / 0.3, 0, 1);
  const pulse = 0.5 + 0.5 * Math.cos(localTime * 2 * Math.PI); // 1s cycle, driven by time (no CSS animation)
  return (
    <div style={{ position: 'absolute', left: x, top: y, display: 'flex', alignItems: 'center', gap: 8, opacity: op }}>
      <div style={{
        background: '#c8102e', color: '#fff',
        fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800,
        fontSize: 18, letterSpacing: '0.12em', textTransform: 'uppercase',
        padding: '4px 12px', borderRadius: 3,
      }}>Breaking</div>
      <div style={{ width: 6, height: 6, background: '#c8102e', borderRadius: 3, opacity: 0.5 + 0.5 * pulse, transform: `scale(${0.7 + 0.3 * pulse})` }}/>
    </div>
  );
}
```

### `Divider` — red horizontal line that grows in

```jsx
function Divider({ localTime, y, delay = 0.15 }) {
  const adj = Math.max(0, localTime - delay);
  const t = Easing.easeOutCubic(clamp(adj / 0.5, 0, 1));
  return (
    <div style={{
      position: 'absolute', left: 48, top: y,
      width: `${t * 60}px`, height: 3,
      background: '#c8102e', borderRadius: 2,
    }}/>
  );
}
```

### `DateBadge` — faint date text

```jsx
function DateBadge({ localTime, y }) {
  const op = clamp(localTime / 0.4, 0, 1);
  return (
    <div style={{
      position: 'absolute', left: 48, top: y, opacity: op,
      fontFamily: "'Barlow', sans-serif", fontWeight: 600, fontSize: 16,
      color: 'rgba(255,255,255,0.5)', letterSpacing: '0.08em', textTransform: 'uppercase',
    }}>
      [TODAY'S DATE]
    </div>
  );
}
```

### `Stat` — large animated number + label

```jsx
function Stat({ value, label, localTime, x, y, delay = 0 }) {
  const adj = Math.max(0, localTime - delay);
  const t = Easing.easeOutBack(clamp(adj / 0.55, 0, 1));
  return (
    <div style={{ position: 'absolute', left: x, top: y, opacity: t, transform: `scale(${0.7 + 0.3 * t})`, transformOrigin: 'left center' }}>
      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 88, color: '#fff', lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ fontFamily: "'Barlow', sans-serif", fontWeight: 500, fontSize: 22, color: 'rgba(255,255,255,0.65)', letterSpacing: '0.04em', textTransform: 'uppercase', marginTop: 4 }}>
        {label}
      </div>
    </div>
  );
}
```

**Usage:** `<Stat value="20%" label="of global oil daily" localTime={localTime} x={0} y={0} delay={0.5} />`

### `CTACard` — end card (always last scene)

```jsx
function CTACard({ localTime, duration }) {
  const op = fade(localTime, duration, 0.5, 0.4);
  const t = Easing.easeOutCubic(clamp(localTime / 0.6, 0, 1));
  return (
    <div style={{
      position: 'absolute', inset: 0, background: '#080c14', opacity: op,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24,
    }}>
      <div style={{ width: 14, height: 14, borderRadius: 7, background: '#c8102e', boxShadow: '0 0 0 6px rgba(200,16,46,0.2)', transform: `scale(${t})` }}/>
      <div style={{
        fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 42,
        color: '#fff', letterSpacing: '-0.01em', textAlign: 'center',
        opacity: t, transform: `translateY(${(1 - t) * 16}px)`,
      }}>
        Follow for daily<br/>[topic] updates
      </div>
      <div style={{ width: 48, height: 3, background: '#c8102e', borderRadius: 2, transform: `scaleX(${t})`, transformOrigin: 'center' }}/>
    </div>
  );
}
```

---

## Word-Sync Primitives (from animations.jsx — global, no import needed)

These are powered by the `words` array in `scenes.json`, which the pipeline writes from the voice (`reelsmith tts <name>`, or `reelsmith cut <name>` / the app's Finalize for a recorded take). No extra setup needed.

### `useWordTimings(sceneIdx)` — get word timestamps for a scene

Returns the word list for a scene with timestamps on the scene Sprite's `localTime` clock — i.e. relative to `useSceneWindow(N).start`, which begins 0.5s before the scene's audio for scenes after the first. Compare against `localTime` (or `useTime() - useSceneWindow(N).start`), never against raw `useTime()`. `useWordCue` and `SubtitleRail` use this same clock, so cues line up with the voice.

```jsx
const words = useWordTimings(3); // [{word, start, end}, ...] — Sprite localTime clock
// localTime >= words[0].start  ⇔  narrator is on the first word of scene 3
```

Returns `[]` if scenes.json has no words for this scene (take not finalized yet).

---

### `WordReveal` — word-by-word text synced to narrator

Renders narration text word by word, each word fading in at the exact timestamp Whisper extracted. ALL-CAPS words and words containing digits auto-highlight in accent red at 1.15× scale.

```jsx
// Basic usage — text appears word-by-word synced to narration
<WordReveal sceneIdx={3} />

// With style overrides (applied to each word span)
<WordReveal
  sceneIdx={3}
  style={{ fontSize: 28, fontFamily: "'Barlow', sans-serif", color: '#fff' }}
/>

// Disable emphasis highlighting
<WordReveal sceneIdx={3} emphasis={false} />

// Slower per-word fade (default 0.08s)
<WordReveal sceneIdx={3} fadeDur={0.15} />
```

**Props:**
- `sceneIdx` — 1-based scene index (matches `### Scene N` in script.md)
- `style` — CSS object spread onto every word `<span>`
- `emphasis` — if true (default), ALL-CAPS words and digit words render in `#c8102e` at 1.15× scale
- `fadeDur` — per-word fade-in duration in seconds (default `0.08`)

**How it works:** Each word fades in via `easeOutCubic` at its Whisper-extracted timestamp. The `marginRight: '0.22em'` spaces words naturally. Wrap in a text container with the right font/size/color and `WordReveal` handles the timing.

**Typical usage pattern:**
```jsx
<Sprite {...useSceneWindow(3)}>
  {({ localTime }) => (
    <div style={{ position: 'absolute', left: 48, right: 48, bottom: 120 }}>
      <div style={{
        fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800,
        fontSize: 52, lineHeight: 1.1, color: '#fff',
      }}>
        <WordReveal sceneIdx={3} />
      </div>
    </div>
  )}
</Sprite>
```

**Fallback:** If `scenes.json` has no `words` for this scene, renders nothing silently. Always safe to include.

---



These three components replace `SceneBg` for all new video HTML. They enforce the **no image held >3 seconds** rule by providing zoom, cuts, and parallax depth.

### `KenBurns` — single image with zoom + pan

Use for short scenes (≤4s) or the breaking-opener where one strong image suffices.

```jsx
<KenBurns
  src="image.jpg"
  localTime={localTime}
  duration={duration}
  startScale={1.0}      // initial zoom
  endScale={1.08}       // final zoom (default 1.08)
  panFrom={{ x: 0, y: 0 }}   // starting translate in % (default no pan)
  panTo={{ x: 1, y: 0 }}     // ending translate in % — subtle drift
  position="center"    // CSS object-position
  gradient={true}      // dark gradient overlay (default true)
  entryDur={0.5}
  exitDur={0.4}
/>
```

**Pan presets** (use one of these for `panFrom`/`panTo`):
- Left-to-right drift: `panFrom={{ x: -1, y: 0 }}` → `panTo={{ x: 1, y: 0 }}`
- Upward drift: `panFrom={{ x: 0, y: 1 }}` → `panTo={{ x: 0, y: -1 }}`
- Corner zoom: `panFrom={{ x: -1, y: -1 }}` → `panTo={{ x: 0, y: 0 }}`

---

### `ImageCut` — cycles through N images at beat points

Use for any scene where narration runs **longer than 3 seconds**. Computes Ken Burns motion per image automatically.

```jsx
<ImageCut
  images={[
    { src: "image-a.jpg", position: "center", panDir: { x: 1, y: 0 } },
    { src: "image-b.jpg", position: "center top", panDir: { x: 0, y: -1 } },
    { src: "image-c.jpg", position: "center" },
  ]}
  cuts={[0, 3.0, 6.0]}       // localTime offsets for each image (cuts[0] must be 0)
  localTime={localTime}
  duration={duration}
  crossfadeDur={0.15}         // fast dissolve between cuts (default 0.15)
  kenBurnsScale={1.06}        // max zoom per image (default 1.06)
  gradient={true}
  entryDur={0.5}
  exitDur={0.4}
/>
```

**Cut timing rule:** target **2–3 seconds per image**. Formula:
- 2 images: `cuts = [0, duration / 2]`
- 3 images: `cuts = [0, duration * 0.33, duration * 0.66]`
- Round to nearest 0.5s for clean numbers

**`panDir`** drives the translate drift for that image's hold duration (in %). Values of ±1–2 are subtle and effective.

---

### `Parallax` — two-layer depth drift

Use when you have two related images (e.g., satellite view + street-level) and want cinematic depth.

```jsx
<Parallax
  bg={{ src: "wide-shot.jpg", position: "center" }}
  fg={{ src: "detail.jpg", x: 48, y: 400, width: 300, height: 200, radius: 8 }}
  localTime={localTime}
  duration={duration}
  amount={28}           // total pixels background drifts (default 24)
  direction="up"        // 'up' | 'down' | 'left' | 'right'
  fgSpeedMult={-0.5}    // fg drifts at half speed, opposite direction (default -0.5)
  gradient={true}
  entryDur={0.5}
  exitDur={0.4}
/>
```

`fg` is optional — omit it for a single-layer parallax drift on the background.

---

## Visual Pacing Rule

**No image held static >3 seconds.** Decision chart:

| Scene duration | Use |
|---|---|
| ≤4s | `KenBurns` (one image, strong zoom) |
| 4–8s | `ImageCut` with 2 images, cut at ~3s |
| >8s | `ImageCut` with 3+ images, cuts every 2–3s |
| Two related images | `Parallax` |

`SceneBg` (the old static full-bleed helper) is **deprecated for new videos**. Use `KenBurns` or `ImageCut` instead.

---

## Inline Text Patterns (no separate component needed)

### Section label (red uppercase)

```jsx
<div style={{
  fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700,
  fontSize: 20, letterSpacing: '0.1em', textTransform: 'uppercase',
  color: '#c8102e', marginBottom: 10,
  ...slideUp(localTime, 0.4),
}}>Background</div>
```

### Headline

```jsx
<div style={{
  fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800,
  fontSize: 52, lineHeight: 1.1, color: '#fff', textWrap: 'pretty',
  ...slideUp(Math.max(0, localTime - 0.15), 0.5),
}}>Largely blocked since February.</div>
```

### Body text

```jsx
<div style={{
  marginTop: 20,
  fontFamily: "'Barlow', sans-serif", fontWeight: 400,
  fontSize: 26, color: 'rgba(255,255,255,0.8)', lineHeight: 1.5, textWrap: 'pretty',
  ...slideUp(Math.max(0, localTime - 0.45), 0.5),
}}>After the US and Israel launched military strikes on Iran.</div>
```

### Condition / callout box

```jsx
<div style={{
  background: 'rgba(200,16,46,0.15)', border: '1px solid rgba(200,16,46,0.4)',
  borderRadius: 8, padding: '14px 18px',
  fontFamily: "'Barlow', sans-serif", fontSize: 22,
  color: 'rgba(255,255,255,0.85)', lineHeight: 1.45,
  ...slideUp(Math.max(0, localTime - 0.6), 0.5),
}}>
  Strait stays closed until the US lifts its naval blockade.
</div>
```

### Timeline row (day + event)

```jsx
<div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 24, ...slideUp(localTime, 0.4) }}>
  <div style={{
    fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800,
    fontSize: 22, color: '#c8102e', textTransform: 'uppercase',
    letterSpacing: '0.06em', paddingTop: 4, minWidth: 80,
  }}>Friday</div>
  <div style={{ fontFamily: "'Barlow', sans-serif", fontSize: 26, color: '#fff', lineHeight: 1.4 }}>
    Iran declared the strait open. Oil prices fell.
  </div>
</div>
```

---

## App Shell

Always wrap in `Stage` with a unique `persistKey`:

```jsx
function App() {
  return (
    <Stage width={720} height={1280} scenesSrc="scenes.json" background="#000" loop={false} autoplay={true} persistKey="[unique-key]">
      <VideoContent />
    </Stage>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
```

---

## SubtitleRail — karaoke subtitle bar (REQUIRED on every narrated scene)

Every scene that has narration **must** include `<SubtitleRail sceneIdx={N} />`. This is a non-negotiable rule — it is how every video gets engaging, word-synced subtitles automatically.

**How it works:** Displays narration in 5-word chunks (TikTok / Reels style), cycling through as the narrator speaks. Within each chunk:
- **Current word** — full white, `scale(1.1)`, accent red if number or ALL-CAPS
- **Past words** — dimmed (`rgba(255,255,255,0.28)`)
- **Upcoming words** — soft white (`rgba(255,255,255,0.52)`)

A semi-transparent dark pill behind each chunk ensures readability over any background image.

```jsx
// Inside every narrated Sprite — add as the LAST child before closing the Sprite
<Sprite {...useSceneWindow(3)}>
  {({ localTime, duration }) => (
    <div style={{ position: 'absolute', inset: 0 }}>
      <ImageCut ... />
      {/* ... overlay elements ... */}
      <SubtitleRail sceneIdx={3} />
    </div>
  )}
</Sprite>
```

**Props:**
- `sceneIdx`  — 1-based scene index (must match the Sprite's `useSceneWindow(N)`)
- `chunkSize` — words per chunk (default `5`, increase to `6` for fast speakers)
- `bottom`    — CSS bottom offset in px (default `300` — adjust per scene if overlay text sits higher)
- `fontSize`  — px (default `32`)
- `accentColor` — color for numbers and ALL-CAPS words (default `#c8102e`)

**Default spacing (runtime-managed, no manual overrides):**
- Row gap (between wrapped lines): `fontSize × 0.1` (≈3px at default 32px)
- Column gap (between words): `fontSize × 0.22` (≈7px at default 32px)
- Line height: `1.25`
- Letter spacing: `0.03em`
- Pill padding: `fontSize × 0.18` × `fontSize × 0.4` (≈6px 13px at default 32px)
- Pill max-width: `660px`
- Pill background: `rgba(0,0,0,0.52)`

**Rules:**
- Include on every scene EXCEPT `cta-end` (Scene 7 / the last scene, which has its own text)
- Always place it as the last child inside the scene's root div so it renders above images but doesn't interfere with overlay elements
- Do NOT add `// sync-ok` to suppress missing-subtitle warnings — fix the omission instead
- The `bottom` default of 300px sits just above the standard overlay content band (bottom 0–280px). If a scene's overlay content is taller, increase `bottom` by the extra height (e.g. `bottom={380}` for timeline-events with 4 rows)
