# Animation

Each video's animation is one file, `videos/<name>/index.html`: React 18 and Babel in the browser, no build step, plus the Reelsmith runtime `runtime/animations.jsx`. The agent writes it with the html-animation skill. This page is the reference for what the runtime provides and the rules the file must follow.

## The skeleton

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My video</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <script src="https://unpkg.com/react@18.3.1/umd/react.development.js" integrity="sha384-hD6/rw4ppMLGNu3tX5cjIb+uRZ7UkRJ6BPkLpg4hAu/6onKUg4lLsHAs9EBPT82L" crossorigin="anonymous"></script>
  <script src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js" integrity="sha384-u6aeetuaXnQ38mYT8rp6sbXaQe3NL9t+IBXmnYxwkUI2Hw4bsp2Wvmx4yRQF1uAm" crossorigin="anonymous"></script>
  <script src="https://unpkg.com/@babel/standalone@7.29.0/babel.min.js" integrity="sha384-m08KidiNqLdpJqLq95G/LEi8Qvjl/xUYll3QILypMoQ65QorJ9Lvtp2RXYGBFj1y" crossorigin="anonymous"></script>
  <script type="text/babel" src="../../runtime/animations.jsx"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; background: #0a0a0a; overflow: hidden; }
    #root { width: 100%; height: 100vh; position: relative; }
  </style>
</head>
<body>
<div id="root"></div>
<script type="text/babel">
function slideUp(t, dur = 0.45) {
  const e = Easing.easeOutCubic(clamp(t / dur, 0, 1));
  return { opacity: e, transform: `translateY(${(1 - e) * 22}px)` };
}

function Scene1() {
  const cueBill = useWordCue(1, "bill");
  return (
    <Sprite {...useSceneWindow(1)}>
      {({ localTime }) => (
        <div style={{ position: 'absolute', inset: 0, background: '#0B0F19' }}>
          <div style={{ position: 'absolute', left: 64, top: 420, width: 520,
                        fontFamily: 'Inter', fontSize: 64, fontWeight: 600, color: '#F5F7FF',
                        ...slideUp(Math.max(0, localTime - cueBill)) }}>
            Your bill
          </div>
          <SubtitleRail sceneIdx={1} bottom={150} fontSize={28} variant="clean" accentColor="#22D3EE" fontFamily="Inter" />
        </div>
      )}
    </Sprite>
  );
}

function App() {
  return (
    <Stage width={720} height={1280} scenesSrc="scenes.json" background="#0B0F19"
           loop={false} persistKey="my-video">
      <Scene1 />
    </Stage>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
</script>
</body>
</html>
```

Rules of the skeleton:

- Load the scripts in this order: React, ReactDOM, Babel, the runtime, then the style's kit if it has one (`<script type="text/babel" src="../../styles/motion/kit.jsx"></script>`; reflective has `styles/reflective/kit.jsx`). The skeleton above uses the runtime alone; a motion scene would use the kit's `SceneRoot` and components instead of hand-written divs.
- `<Stage>` gets `width={720} height={1280}` and `scenesSrc="scenes.json"`. No `duration` prop: the length is Σ `dur` from `scenes.json`.
- `persistKey` is unique per video (the preview remembers the playhead under it).
- One `<Sprite {...useSceneWindow(N)}>` per scene.

The page is always served over HTTP from the project root, so `../../runtime/animations.jsx` resolves. Every Reelsmith tool that opens it (`preview`, `sheet`, `draft`, `render`) does this for you. Opening the file with `file://` does not work.

## Scene clocks

Each scene has two start times on the global playhead:

| Clock | Value | Used for |
|---|---|---|
| `audioStart` | Σ `dur` of the earlier scenes | where `sN.mp3` starts inside `voiceover.mp3`; Whisper times in `scenes.json` count from here |
| `windowStart` | `audioStart − 0.5` (0 for scene 1) | where the scene's Sprite mounts, so it can crossfade over the previous scene |

A Sprite's `localTime` runs on the **window clock**. `useWordTimings` and `useWordCue` add the difference, so their times are on the same clock as `localTime`. Compare cues against `localTime`, never against the global time.

If you pass a custom overlap to `useSceneWindow(N, { overlap: X })`, pass the same `{ overlap: X }` to `useWordTimings` and `useWordCue` for that scene. `SubtitleRail` and `WordReveal` always use the default.

During the 0.5 s overlap two scenes are mounted. Give each scene root a `zIndex` equal to its number and a short opacity fade-in (about 0.3 s) so the overlap reads as a crossfade.

## Runtime API

Everything below is on `window` (no imports).

### Timing and word sync

| API | Signature | Returns |
|---|---|---|
| `useSceneWindow` | `useSceneWindow(idx, { overlap = 0.5 } = {})` | `{ start, end }` in global seconds; spread into `<Sprite>` |
| `useWordTimings` | `useWordTimings(sceneIdx, { overlap = 0.5 } = {})` | `[{ word, start, end }]` on the scene's window clock; `[]` if the scene has no words |
| `useWordCue` | `useWordCue(sceneIdx, phrase, { overlap = 0.5 } = {})` | seconds (window clock) when `phrase` starts, or `Infinity` |
| `useScenes` | `useScenes()` | the parsed `scenes.json` array, or `null` while loading |
| `useTime` | `useTime()` | the global playhead in seconds |
| `useTimeline` | `useTimeline()` | `{ time, duration, playing, setTime, setPlaying }` |
| `useSprite` | `useSprite()` | the enclosing Sprite's `{ localTime, progress, duration, visible }` |

### `useWordCue` phrase matching

```jsx
const cueStat = useWordCue(2, "103 billion");
...slideUp(Math.max(0, localTime - cueStat))
```

- Case-insensitive, punctuation stripped on both sides: `"$103B"` matches Whisper's `"103"`, `"four of five"` matches `"Four of five,"`.
- A multi-word phrase matches consecutive tokens: `"sound of one"` matches `["sound", "of", "one."]`.
- The first match in the scene wins.
- If the whole phrase is not found, the first word of the phrase is tried, with a console warning.
- If nothing matches, it warns and returns `Infinity`, so the overlay stays hidden instead of appearing at the wrong time. `reelsmith lint` reports every cue that does not resolve.
- Digits match digits: `"21 million"` matches `["21", "million"]`; `"twenty-one million"` does not unless Whisper wrote it that way. Check `scenes.json` before choosing a phrase.

### Components

| Component | Props (defaults) | Notes |
|---|---|---|
| `Stage` | `width = 1280, height = 720, duration, background = '#f6f4ef', loop = true, autoplay = true, persistKey = 'animstage', scenesSrc = null, audioSrc, children` | Always pass `width={720} height={1280} scenesSrc="scenes.json"`. `audioSrc`: `undefined` finds `voiceover-mix.mp3`, then `voiceover.mp3`, next to the page; a string plays that file; `null` is silent. Preview only; render mode never plays audio |
| `Sprite` | `start = 0, end = Infinity, keepMounted = false, children` | Renders only while `start ≤ time ≤ end`. `children` may be a function receiving `{ localTime, progress, duration, visible }` |
| `SubtitleRail` | `sceneIdx, chunkSize = 5, bottom = 300, fontSize = 32, accentColor = '#c8102e', variant = 'caps', fontFamily = "'Manrope', sans-serif"` | Karaoke subtitles in chunks of `chunkSize` words, see below |
| `WordReveal` | `sceneIdx, x = 30, y = 900, width = 660, fontSize = 52, fontWeight = 800, fontFamily = "'Barlow Condensed', sans-serif", color = '#fff', accentColor = '#c8102e', lineHeight = 1.15, animDur = 0.07, uppercase = false` | The scene's words appear one by one as spoken. Numbers and ALL-CAPS words turn `accentColor` |
| `KenBurns` | `src, localTime = 0, duration = 1, startScale = 1.0, endScale = 1.08, panFrom = {x:0,y:0}, panTo = {x:0,y:0}, position = 'center', gradient = true, entryDur = 0.5, exitDur = 0.4, width = '100%', height = '100%', x = 0, y = 0, radius = 0` | One image with a slow zoom and pan. Pass the Sprite's `localTime` and `duration` |
| `ImageCut` | `images: [{ src, position, panDir: {x,y}, alt }], cuts: [0, …], localTime, duration, crossfadeDur = 0.15, kenBurnsScale = 1.06, gradient = true, entryDur = 0.5, exitDur = 0.4, …` | Cuts between images at `cuts` (local seconds, `cuts[0]` is 0), each with its own Ken Burns. Bind the cut times to word cues |
| `Parallax` | `bg: { src, position }, fg = null, localTime, duration, amount = 24, direction = 'up', fgSpeedMult = -0.5, gradient = true, entryDur = 0.5, exitDur = 0.4, …` | Two-layer depth drift |
| `TextSprite` | `text, x = 0, y = 0, size = 48, color = '#111', font, weight = 600, entryDur = 0.45, exitDur = 0.35, entryEase, exitEase, align = 'left', letterSpacing` | Text with a built-in entry and exit; it fades out at the end of its Sprite |
| `ImageSprite` | `src, x, y, width = 400, height = 300, entryDur = 0.6, exitDur = 0.4, kenBurns = false, kenBurnsScale = 1.08, radius = 12, fit = 'cover', placeholder = null` | An image with entry and exit |
| `RectSprite` | `x, y, width = 100, height = 100, color = '#111', radius = 8, entryDur = 0.4, exitDur = 0.3, render` | A rectangle with a spring entry; `render(ctx)` returns style overrides |

`TextSprite`, `ImageSprite` and `RectSprite` have exits baked in. For content overlays use enter-only motion instead (the "no early exits" rule below).

### Motion helpers (pure functions)

| Helper | Signature | Returns |
|---|---|---|
| `interpolate` | `interpolate(input, output, ease = Easing.linear)` | a function `t => value`; `input` and `output` are equal-length arrays; `ease` may be an array, one per segment |
| `animate` | `animate({ from = 0, to = 1, start = 0, end = 1, ease = Easing.easeInOutCubic })` | a function `t => value` |
| `spring` | `spring(t, k = 170, d = 26)` | displacement 0 → 1 of a spring released at `t = 0`; low `d` overshoots, `d ≥ 2√k` does not |
| `track` | `track(t, keys, k = 170, d = 26)` | value at `t` for keyframes `[[time, value], …]`, each key springing from the previous value |
| `seededRandom` | `seededRandom(seed = 1)` | a function returning 0..1, deterministic per seed (use instead of `Math.random`) |
| `clamp` | `clamp(v, min, max)` | `v` limited to the range |
| `Easing` | `linear`, `easeIn/Out/InOut` + `Quad`, `Cubic`, `Quart`, `Expo`, `Sine`, `Back`, and `easeOutElastic` | functions from 0..1 to 0..1 |

Spring presets that work: snappy UI `k=320, d=30`, soft `k=140, d=22`, punch `k=200, d=14`.

```jsx
const cue = useWordCue(2, "600 milliseconds");
const s = spring(localTime - cue, 200, 14);          // bouncy punch-in
const x = track(localTime, [[0, -200], [cueA, 0], [cueB, 180]]);
const rand = seededRandom(42);                       // same scatter every frame
```

Contexts are exported too (`TimelineContext`, `ScenesContext`, `SpriteContext`), for custom components.

## `SubtitleRail`

Every narrated scene has one, as the **last child of the scene's root div**.

```jsx
<SubtitleRail sceneIdx={N} bottom={150} fontSize={28} variant="clean" accentColor={CYAN} fontFamily="Inter" />
```

| Prop | Default | Meaning |
|---|---|---|
| `sceneIdx` | required | the scene number, same as `useSceneWindow(N)` |
| `chunkSize` | `5` | words per subtitle chunk |
| `bottom` | `300` | distance from the bottom edge in px |
| `fontSize` | `32` | px |
| `accentColor` | `'#c8102e'` | `caps`: numbers and ALL-CAPS words; `clean`: the word being spoken |
| `variant` | `'caps'` | `'caps'`: condensed uppercase on a dark pill, the current word scales up. `'clean'`: sentence case, no pill, soft shadow, wider gaps, the current word in `accentColor` at the same size |
| `fontFamily` | `"'Manrope', sans-serif"` | used by `clean` only |

The rail is hidden until the scene's first word is spoken. Row gap, line height and letter spacing are managed by the runtime; do not override them. Each style pack gives its props:

| Style | Props |
|---|---|
| reflective | `bottom={170} fontSize={26} variant="clean" accentColor={GOLD2}` |
| tech-news | defaults |
| motion | `bottom={150} fontSize={28} variant="clean" accentColor={CYAN} fontFamily="Inter"` |

Only a silent scene (no `words` in `scenes.json`, like a tech-news `cta-end` card) goes without a rail.

## Rule 4: every frame is a pure function of time

The renderer seeks to a time, captures a frame, and moves on, across several browsers at once and in any order. A frame must depend only on the time.

**Banned in `index.html`:**

| Banned | Use instead |
|---|---|
| `Math.random()` | `seededRandom(seed)` |
| `setTimeout`, `setInterval` | values computed from `localTime` |
| `requestAnimationFrame` | values computed from `localTime` |
| `Date.now()`, `performance.now()`, `new Date()` | `localTime`, `useTime()` |
| CSS `transition:` and `animation:` | `spring`, `track`, `interpolate`, `Easing` |

Render mode (`?render=1`, used by the renderer and the contact sheet) also disables every CSS transition and animation on the page, so anything that only moves through CSS is static in the MP4.

## Word-cue binding

Every overlay that introduces a spoken thing (a name, a number, a callout, a bullet) gets its time from `useWordCue`. A raw delay over 0.6 s is a bug. Allowed raw delays of 0.6 s or less: scene-opening flourishes (a label, a divider, the first headline) and stagger offsets after a cue (`cue + 0.15`).

## No early exits

Text overlays must not fade out before the scene ends. Use enter-only motion (`slideUp`-style helpers, springs, the kit's entries). A `fade()` helper that includes an exit is fine only for full-scene backgrounds and CTA cards.

## Layout rules

- Canvas 720×1280.
- **Safe area:** every text line keeps 48 px or more from both sides and is 520 px wide or less. The contact sheet lists every violation; decoration that bleeds on purpose carries a `data-bleed` attribute.
- Keep content clear of the subtitle band (above `bottom` plus two subtitle lines).
- Something new on screen every 2 to 4 s. Vary entries. No scene that is only a centered title.

The shared base rules are in `styles/design.md`; each style pack adds its own (see [Styles](styles.md)).

## The linters

```bash
reelsmith lint videos/<name>
```

Runs both linters and exits non-zero if either fails.

**check-sync** (`tools/check-sync.js`) flags:

- `localTime - N`, `delay={N}` and `delay: N` with N over 0.6 on a line with no `useWordCue` call or `cue…` variable;
- `Math.random`, timers, `requestAnimationFrame`, the wall clock, CSS `transition:` and `animation:`;
- `...fade(` spread on a text overlay.

**validate-sync** (`tools/validate-sync.js`) checks against `scenes.json`:

- every `useWordCue(N, "phrase")` resolves to a real word in scene N;
- no `fade()` on text overlays;
- every narrated scene (one with words) has a `SubtitleRail` for its number (a warning).

To allow a deliberate exception, put `// sync-ok` on the line or the line above.

## Previewing

```bash
reelsmith preview videos/<name>              # live playback with the voice
reelsmith preview videos/<name> --lan        # also reachable from a phone on the same Wi-Fi
reelsmith preview videos/<name> --port=3001 --no-open   # another port, no browser tab
```

The port defaults to 3000, or a free one when 3000 is taken.

The preview has a playback bar. Keys: Space plays and pauses, the arrow keys step 0.1 s (1 s with Shift), `0` or Home goes to the start. With `--lan`, open the printed `/qr` page on your computer and scan it with the phone.

## Checking the result

```bash
reelsmith sheet videos/<name>            # frames/contact-sheet.png
reelsmith sheet videos/<name> --stills   # plus full-size frames/stills/*.jpg
reelsmith draft videos/<name>            # draft.mp4, 15 fps, 0.75× size, with the voice
reelsmith clip videos/<name> --from=12 --to=24   # clip-12s-24s.mp4 (add --draft for draft quality)
```

`sheet` also takes `--per-scene=<N>` (default 3), `--cols=<N>` (default 4), `--times=<a,b,c>` for extra frames and `--out=<file.png>`.

The contact sheet samples the hook (0.3, 1 and 2 s) and three frames per scene, and labels each with the words being spoken, so sync can be judged from the sheet alone. The html-animation skill scores it on hook, phone readability, breathing room, motion, variety, style accuracy and sync, and iterates until every score is 8 or higher.
