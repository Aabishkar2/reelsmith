# Design base (shared by every style pack)

> **The look lives in a style pack:** `styles/<name>/STYLE.md` (palette, fonts, the Google Fonts link, subtitle props, layouts, kit components). Built-in packs: **`reflective`** (warm photo-led essays, the default), **`motion`** (bright motion graphics for developer tutorials, with `styles/motion/kit.jsx`) and **`tech-news`** (red Barlow news look, only when asked). Pick the pack from `script.md` frontmatter `style:`, else the project default in `reelsmith.config.json` (`"style"`). `reelsmith styles` lists what is installed.
>
> This file holds the rules every pack shares: canvas, the CDN scripts and base HTML, safe area, banned defaults and animation principles. A pack may tighten a rule; it never loosens one.

## Canvas

- Format: 9:16 vertical portrait
- Width: 720px, Height: 1280px
- Background: the pack's background colour, set on `<Stage background>` **and** `html, body` (so nothing flashes white while fonts load)
- Overflow: hidden

## Palette and fonts

See the style pack. Every pack keeps to one display face, one UI/body face (plus a mono face for code, where the pack has one) and one accent family. Load fonts with the pack's exact Google Fonts `<link>`. A weight that is not in the link gets faux-bolded by the browser, so only use weights the pack loads.

## Safe area (all styles)

No text line within 48 px of the left or right edge, and none wider than 520 px (~72% of the frame). Full-width text looks cramped on a phone. `reelsmith sheet` (the contact sheet) flags violations and the list must be empty before the preview gate. Subtitles are exempt (the runtime manages them), and so are decorative bleeds marked `data-bleed` (a giant "?" or numeral behind the content). Keep overlays above y ≈ 1000 so they never collide with the subtitle rail.

## Banned defaults

These are what every AI-made video looks like. Do not ship them:

- A centered title on a gradient or empty background as the whole scene
- Every element entering the same way (all slide-up + fade, same duration, same stagger)
- A large empty band in the middle of the frame while text sits at top and bottom
- Corner labels and frame borders as decoration, glow on UI chrome, generic particle bursts
- Body text under 24px (unreadable on a phone). If it only reads at full size, it is too small
- A scene that holds still: **something new must happen on screen every 2–4 seconds**

## Animation principles

- **Every frame is a pure function of time.** No `Math.random` (use `seededRandom`), timers, `requestAnimationFrame`, wall clock, or CSS transitions/animations. Compute everything from `localTime` (`spring`, `track`, `interpolate`). `reelsmith lint` (check-sync) enforces it for `index.html`; kit files follow the same rule.
- **Bind reveals to the voice.** Every element that appears with a spoken word gets its time from `useWordCue(N, "phrase")`, never a hand-typed number.
- **Vary entries.** Pick per element: slide-up, spring scale-in, horizontal push, mask/wipe reveal, count-up, strike-through → replace. Never use one entry for everything in a video
- **Springs over eases for physical motion.** `spring(t, k, d)` / `track(t, keys, k, d)` from the runtime give overshoot and settle that easing curves can't. Snappy UI: `k=320, d=30`. Soft/heavy: `k=140, d=22`. Bouncy punch: `k=200, d=14`
- **Entry (default):** slide-up + fade — `translateY` from +22px to 0, opacity 0→1, duration 0.45–0.55s, `easeOutCubic`
- **Enter only.** Text overlays never fade out before their scene ends (no early exits); the next scene's transition replaces them. Exit fades (opacity 1→0, 0.35 s) are for background scrims and CTA cards only
- **Stagger:** delay consecutive elements by 0.12–0.3s
- **Stats:** scale punch-in from 0.7 to 1.0 with `easeOutBack` (or `spring` k=200 d=14), duration 0.55s
- **Dividers:** width grows from 0 to target using `easeOutCubic`, duration 0.5s
- **Overlap:** adjacent scene sprites overlap by 0.5s (`useSceneWindow` does this) for seamless scene transitions; the incoming scene sits on top

## Layout conventions

- Content area padding: at least `48px` left and right (the safe area); most packs use 56–100
- Top content (labels, kickers): `80–150px` from top
- Subtitle rail at the bottom (`bottom` 150–170 in the current packs); everything else above y ≈ 1000
- Line height — headlines: `1.05–1.1`, body: `1.4–1.5`
- `textWrap: 'balance'` on multi-line headlines, `textWrap: 'pretty'` on body text

## Required CDN scripts

Always include in `<head>` in this exact order. A pack's `kit.jsx`, when used, goes directly after the runtime:
```html
<script src="https://unpkg.com/react@18.3.1/umd/react.development.js" integrity="sha384-hD6/rw4ppMLGNu3tX5cjIb+uRZ7UkRJ6BPkLpg4hAu/6onKUg4lLsHAs9EBPT82L" crossorigin="anonymous"></script>
<script src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js" integrity="sha384-u6aeetuaXnQ38mYT8rp6sbXaQe3NL9t+IBXmnYxwkUI2Hw4bsp2Wvmx4yRQF1uAm" crossorigin="anonymous"></script>
<script src="https://unpkg.com/@babel/standalone@7.29.0/babel.min.js" integrity="sha384-m08KidiNqLdpJqLq95G/LEi8Qvjl/xUYll3QILypMoQ65QorJ9Lvtp2RXYGBFj1y" crossorigin="anonymous"></script>
<script type="text/babel" src="../../runtime/animations.jsx"></script>
<!-- optional, per pack: -->
<script type="text/babel" src="../../styles/<pack>/kit.jsx"></script>
```

The relative paths resolve because every tool (renderer, preview, contact sheet) serves the **project root** over HTTP. In a project made by `reelsmith init`, `runtime/` and `styles/` in the project root link to the framework's copies, so the same paths work.

## Base HTML structure

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>[Video Title]</title>
  <!-- fonts: the pack's Google Fonts <link> -->
  <!-- CDN scripts + runtime (+ kit) -->
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; background: [pack background]; overflow: hidden; }
    #root { width: 100%; height: 100vh; position: relative; }
  </style>
</head>
<body>
<div id="root"></div>
<script type="text/babel">
  /* scene code here: one function per scene, each <Sprite {...useSceneWindow(N)}> */
  function App() {
    return (
      <Stage width={720} height={1280} scenesSrc="scenes.json" background="[pack background]" loop={false} autoplay={true} persistKey="[unique-per-video]">
        {/* <Scene1 /> <Scene2 /> ... */}
      </Stage>
    );
  }
  ReactDOM.createRoot(document.getElementById('root')).render(<App />);
</script>
</body>
</html>
```

`<Stage scenesSrc="scenes.json">` takes no `duration` prop: the length comes from `scenes.json`. `persistKey` is unique per video. Every narrated scene has `<SubtitleRail sceneIdx={N} … />` (with the pack's props) as the last child of its root, written out literally in each scene (the linter looks for it).
