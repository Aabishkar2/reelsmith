# Design System

> **Styles live in `config/styles/`.** The default for new videos is **`reflective`** (`config/styles/reflective.md`: warm near-black, gold, Fraunces + Manrope, graded photos; reference `videos/devotion-tts/`). The red / Barlow rules in this file are the **`tech-news`** style (`config/styles/tech-news.md`), used only when the creator asks or `script.md` frontmatter has `style: tech-news`. The canvas size (720×1280), required CDN scripts, base HTML structure, banned defaults and animation principles below apply to both styles. Colours, fonts and the "one display face, one UI face, one accent" line come from the style file.

## Canvas

- Format: 9:16 vertical portrait
- Width: 720px, Height: 1280px
- Background: deep dark — default `#000` or `#080c14`
- Overflow: hidden

## Color Palette

| Role | Value | Usage |
|---|---|---|
| Background | `#000` / `#080c14` | Scene and CTA backgrounds |
| Accent | `#c8102e` | Breaking tags, dividers, labels, CTA dot |
| Text primary | `#fff` | Headlines, stat values |
| Text secondary | `rgba(255,255,255,0.80)` | Body copy |
| Text muted | `rgba(255,255,255,0.65)` | Stat labels, supporting text |
| Text faint | `rgba(255,255,255,0.50)` | Date badges, timestamps |
| Overlay card | `rgba(200,16,46,0.15)` with border `rgba(200,16,46,0.4)` | Condition/callout boxes |

## Typography

### Fonts — always load these via Google Fonts
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800&family=Barlow:wght@400;500;600&display=swap" rel="stylesheet">
```

| Role | Family | Weight | Size (reference) |
|---|---|---|---|
| Display headline | Barlow Condensed | 800 | 52–72px |
| Section label | Barlow Condensed | 700 | 18–22px |
| Stat value | Barlow Condensed | 800 | 72–96px |
| Body copy | Barlow | 400 | 24–28px |
| Sub-label / badge | Barlow | 600 | 14–18px |
| Stat label | Barlow | 500 | 20–24px |

## Image Overlays

Full-bleed background images always get a gradient dark overlay:
```
background: linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.55) 45%, rgba(0,0,0,0.3) 100%)
```

All motion primitives (`KenBurns`, `ImageCut`, `Parallax`) include this gradient automatically via `gradient={true}` (the default).

**Visual pacing rule:** no image held static >3 seconds. Use the appropriate primitive from `config/components.md`:
- `KenBurns` — single image, slow zoom+pan (scale 1.0 → 1.08, translate ±1–2% over scene)
- `ImageCut` — cycles 2–4 images with 0.15s cross-dissolve and per-image Ken Burns
- `Parallax` — two-layer depth drift (background moves slowly, optional foreground at different speed)

`SceneBg` (legacy static helper) is retired for new videos.

## Safe area (all styles)

No text line within 48 px of the left or right edge, and none wider than 520 px (~72% of the frame). Full-width text looks cramped on a phone. `scripts/contact-sheet.js` flags violations. Details and fixes: `config/styles/reflective.md` → "Safe area".

## Banned defaults

These are what every AI-made video looks like. Do not ship them:

- A centered title on a gradient or empty background as the whole scene
- Every element entering the same way (all slide-up + fade, same duration, same stagger)
- A large empty band in the middle of the frame while text sits at top and bottom
- Corner labels and frame borders as decoration, glow on UI chrome, generic particle bursts
- Body text under 24px (unreadable on a phone). If it only reads at full size, it is too small
- A scene that holds still: **something new must happen on screen every 2–4 seconds**

One display face (Barlow Condensed), one UI face (Barlow), one accent (`#c8102e`) unless the brief says otherwise.

## Animation Principles

- **Vary entries.** Pick per element: slide-up, spring scale-in, horizontal push, mask/wipe reveal, count-up, strike-through → replace. Never use one entry for everything in a video
- **Springs over eases for physical motion.** `spring(t, k, d)` / `track(t, keys, k, d)` from the runtime give overshoot and settle that easing curves can't. Snappy UI: `k=320, d=30`. Soft/heavy: `k=140, d=22`. Bouncy punch: `k=200, d=14`
- **Entry (default):** slide-up + fade — `translateY` from +22px to 0, opacity 0→1, duration 0.45–0.55s, `easeOutCubic`
- **Exit:** fade only — opacity 1→0, duration 0.35s
- **Stagger:** delay consecutive text elements by 0.15–0.3s
- **Stats:** scale punch-in from 0.7 to 1.0 with `easeOutBack`, duration 0.55s
- **Dividers:** width grows from 0 to target using `easeOutCubic`, duration 0.5s
- **Overlap:** adjacent sprites overlap by 0.5s for seamless scene transitions

## Layout Conventions

- Content area padding: `48px` left and right
- Bottom content block: positioned `80–160px` from bottom
- Top content (date, breaking tag): `80–130px` from top
- Line height — headlines: `1.05–1.1`, body: `1.45–1.5`
- `textWrap: 'pretty'` on all multi-line text

## Required CDN Scripts

Always include in `<head>` in this exact order:
```html
<script src="https://unpkg.com/react@18.3.1/umd/react.development.js" integrity="sha384-hD6/rw4ppMLGNu3tX5cjIb+uRZ7UkRJ6BPkLpg4hAu/6onKUg4lLsHAs9EBPT82L" crossorigin="anonymous"></script>
<script src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js" integrity="sha384-u6aeetuaXnQ38mYT8rp6sbXaQe3NL9t+IBXmnYxwkUI2Hw4bsp2Wvmx4yRQF1uAm" crossorigin="anonymous"></script>
<script src="https://unpkg.com/@babel/standalone@7.29.0/babel.min.js" integrity="sha384-m08KidiNqLdpJqLq95G/LEi8Qvjl/xUYll3QILypMoQ65QorJ9Lvtp2RXYGBFj1y" crossorigin="anonymous"></script>
<script type="text/babel" src="../../runtime/animations.jsx"></script>
```

## Base HTML Structure

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>[Video Title]</title>
  <!-- fonts -->
  <!-- CDN scripts -->
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; background: #0a0a0a; overflow: hidden; }
    #root { width: 100%; height: 100vh; position: relative; }
  </style>
</head>
<body>
<div id="root"></div>
<script type="text/babel">
  /* scene code here */
  ReactDOM.createRoot(document.getElementById('root')).render(<App />);
</script>
</body>
</html>
```
