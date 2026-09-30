# Styles

A style pack decides how a video looks: palette, fonts, subtitle props, scene layouts, transitions and reusable components. The same script rendered with three packs gives three different videos. The agent reads the pack before it writes a single line of HTML (html-animation Rule 0).

## Which style a video uses

1. `style:` in the video's `script.md` frontmatter.
2. Otherwise `style` in `reelsmith.config.json`.
3. Otherwise `reflective`.

```markdown
---
title: How the animation stays in sync
style: motion
---
```

```json
{ "style": "reflective" }
```

List the packs the project can see:

```bash
reelsmith styles
```

## What a pack contains

```
styles/<name>/
  STYLE.md       the look, written for the agent (required)
  kit.jsx        reusable components, loaded after the runtime (optional)
  reference/     a finished reference index.html and stills (optional)
  plugin.js      { name, kind: 'style', version, description } (optional)
```

`STYLE.md` starts with frontmatter that names the pack:

```markdown
---
name: motion
description: Bright motion graphics for developer tutorials
---
```

Without a `plugin.js`, the plugin registry builds the pack's entry from these two fields.

Every pack also relies on `styles/design.md`, the shared base: the 720×1280 canvas, the CDN scripts and their order, the HTML skeleton, the banned defaults and the animation principles.

## The built-in packs

### `reflective` (default)

Warm, photo-led and calm. For essays and "think it through" videos.

| | |
|---|---|
| Palette | near-black `#0b0906`, gold `#e0a458` (structure), bright gold `#f2c46d` (emphasis), cream `#f5efe6` (text). One warm family, no red, no blue, no pure white text |
| Fonts | Fraunces 500/700 with italics (display), Manrope 600 to 800 (labels, subtitles) |
| Visuals | Photos in `images/` with `images/CREDITS.md`, always graded, always moving (Ken Burns), a cut every 2.5 to 3.5 s on word cues |
| Subtitles | `<SubtitleRail sceneIdx={N} bottom={170} fontSize={26} variant="clean" accentColor={GOLD2} />` |
| Ending | a narrated closing card; the music tail holds the last frame. No silent CTA card |
| Kit | `styles/reflective/kit.jsx`: the palette constants, `PhotoSeq`, `Grade`, `Glow`, `Enter` (scene transitions), `Label`, `Chip`, `StrikeLine`, and entry helpers (`rise`, `pop`, `reveal`, `blurIn`, `drop`, `slideUp`) |
| Reference | `styles/reflective/reference/index.html` (read it as code; its photos are not shipped) |

### `tech-news`

The "breaking tech news" look. For fast news breakdowns.

| | |
|---|---|
| Palette | near-black `#080c14` / `#000`, one red accent `#c8102e`, white text |
| Fonts | Barlow Condensed 800 (display), Barlow 400 to 600 (body) |
| Visuals | Designed from code: diagrams, stat cards, code blocks, comparison tables. No stock photos |
| Subtitles | `<SubtitleRail sceneIdx={N} />` (runtime defaults: caps on a pill, red accent) |
| Ending | a silent `cta-end` card, never narrated |
| Files | `styles/tech-news/STYLE.md`, `components.md` (primitives and per-video helpers), `templates.md` (scene templates, including the `cta-end` card) |

### `motion`

Bright motion graphics for developer and teaching content: terminals, code, file trees and diagrams. The ten tutorial videos use it.

| | |
|---|---|
| Palette | ink `#0B0F19` with a subtle vignette, violet `#7C5CFF` (accent), cyan `#22D3EE` (secondary), success `#34D399`, warn `#FBBF24`, danger `#F87171`, text `#F5F7FF`, muted `rgba(245,247,255,0.62)` |
| Fonts | Sora 600 to 800 (display), Inter 400 to 600 (body), JetBrains Mono 400/600 (code) |
| Visuals | Designed from code with the kit components. No stock photos |
| Subtitles | `<SubtitleRail sceneIdx={N} bottom={150} fontSize={28} variant="clean" accentColor={CYAN} fontFamily="Inter" />` |
| Motion | something new every 2 to 4 s, varied entries, springs `k=320, d=30` (snappy) and `k=200, d=14` (punch) |
| Layouts | hook, terminal-led, split, diagram, code walk, checklist, grid / timeline, close |
| Ending | a narrated close (the wordmark or a final terminal command); no silent CTA card unless the creator asks |
| Reference | `videos/tut-01-what-is-reelsmith/index.html` |

The kit loads after the runtime:

```html
<script type="text/babel" src="../../runtime/animations.jsx"></script>
<script type="text/babel" src="../../styles/motion/kit.jsx"></script>
```

Its components are pure functions of time, exported on `window` together with the palette constants (`INK`, `VIOLET`, `CYAN`, `OK`, `WARN`, `DANGER`, `TEXT`, `MUTED`, …) and the spring presets `SNAPPY` and `PUNCH`. Every component reads the scene clock from the enclosing Sprite and takes an `at` time (pass a `useWordCue` result, never a typed number), plus `x`, `y`, `z`, `style` and usually `enter`:

| Component | What it draws |
|---|---|
| `SceneRoot` | the scene root: ink background with glows, dot grid and vignette, the scene transition, stacking |
| `Glow`, `Watermark` | decorative depth behind a hero element |
| `Title`, `Kicker` | a display headline with a word-by-word reveal; a small uppercase label |
| `Counter` | a count-up numeral |
| `Chip`, `Badge`, `Icon` | pills, tags, stroke icons |
| `Card`, `Callout`, `Tile` | containers |
| `Terminal` | a window with a typed command and output rows revealed on cues, cursor driven by time |
| `PromptBox` | an agent prompt being typed and sent |
| `Typed`, `Strike` | inline typing and strike-through |
| `CodeCard` | a file with syntax colours, line reveal and highlighted lines |
| `FileTree` | folders and files with guide lines, revealed row by row |
| `StatusRows` | a checklist with state icons |
| `FlowDiagram` | nodes that light up along an animated connector |
| `PluginDock` | a core block with tiles snapping onto it |
| `Wordmark`, `Logo` | the brand |
| `Waveform` | seeded audio bars |
| `ProgressBar`, `Ring` | progress |
| `Timeline` | clips, cuts and a playhead |
| `Grid` | contact-sheet thumbnails with scores |
| `SplitCard` | two panels with a medallion |
| `PhoneFrame`, `MiniReel` | a device showing a short |
| `BrowserFrame`, `Window` | app mockups |
| `Stamp` | a rubber stamp punch-in |
| `Arrow`, `Cursor` | canvas-space pointers |

Entries are named (`slideUp`, `rise`, `pop`, `wipe`, `fromLeft`, `fromRight`, `blur`, `drop`, `zoom`, `fadeIn`, …) and also available as helpers for your own elements: `enter.slideUp(localTime - cue)`.

`styles/motion/STYLE.md` has a snippet for each component, the props, and the banned defaults.

## Rules every pack shares

- **Safe area:** text keeps 48 px or more from both sides and is 520 px wide or less.
- **Something new every 2 to 4 s.** Vary entries; no everything-fades-in.
- **No empty middle band** while text sits at the top and bottom.
- **Body text 24 px or larger.** If it only reads at full size, it is too small.
- **One display face, one UI face, one accent**, unless the pack says otherwise.
- Every frame is a pure function of time, including inside `kit.jsx`.

## Making your own pack

Start from the pack closest to what you want:

```bash
cp -RL styles/motion styles/acme
```

`-L` copies the files behind a symlink, which matters in package mode, where `styles/motion` is a link into `node_modules` (GNU `cp -r` would copy the link itself). Then edit, in this order:

1. **`STYLE.md` frontmatter:** `name: acme` and a one-line `description`.
2. **Palette table:** token names, values and what each is for. The agent uses the names as constants in `index.html`.
3. **Fonts:** the Google Fonts `<link>` and a table of which face is used for what.
4. **Type scale:** sizes for the lone word, headline, body, label, subtitle.
5. **Subtitles:** the exact `<SubtitleRail … />` line.
6. **Layouts table:** each layout, when to use it, and what it looks like. This is what the agent picks from per scene.
7. **Banned defaults:** what the pack must never do (fonts you rejected, colours that clash).
8. **`kit.jsx`:** your components, exported with `Object.assign(window, { … })`. Keep them pure functions of time: no timers, no `Math.random`, no CSS transitions.
9. **`reference/`:** once a video in the new style is approved, copy its `index.html` here so the next video starts from it.

Use it:

```markdown
style: acme
```

Check that it is found with `reelsmith styles`.

### Where packs live

The framework's packs are in `styles/`. A project's `index.html` loads a kit by relative path (`../../styles/<name>/kit.jsx`), so a pack must sit in the `styles/` folder at the project root.

- **Clone mode:** `styles/` is a normal folder. Add packs there.
- **Package mode:** `styles/` is a real folder in your project. `reelsmith init` puts one symlink per built-in pack in it (`styles/reflective`, `styles/tech-news`, `styles/motion` → `node_modules/reelsmith/styles/<pack>`) plus `styles/design.md`, and lists those links in `.gitignore`. Your own pack is a normal folder beside them (`styles/acme/`), so it is yours to commit and survives a reinstall. Start one with `cp -RL styles/motion styles/acme` (above). Do not edit inside a linked pack: that edits the installed framework.

The plugin contract for `style` is in [Plugins](plugins.md#style).
