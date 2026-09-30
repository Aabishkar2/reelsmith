---
name: motion
description: Bright, fast motion graphics for developer tutorials. Ink background, violet + cyan, Sora / Inter / JetBrains Mono, terminals, code cards, file trees, diagrams, phone frames. No stock photos.
---

# Style: motion

Bright, fast, motion-graphic teaching videos: terminals, code cards, file trees, flow diagrams, phone frames. Designed from code, **no stock photos**. It's the look of the Reelsmith tutorial series. Use it when `script.md` frontmatter says `style: motion`, or when the creator asks for it.

Read `styles/design.md` first (canvas, CDN scripts, safe area, banned defaults, animation principles). This file adds the palette, fonts, subtitle props, the kit (`styles/motion/kit.jsx`) and the layouts.

**Reference:** `styles/motion/reference/` (see its README; the finished `videos/tut-01-what-is-reelsmith/index.html` is copied there once it's approved).

## Setup: fonts, scripts, subtitles

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
```

Script order: React, ReactDOM, Babel (the three CDN tags from `styles/design.md`), then **the runtime, then the kit**:

```html
<script type="text/babel" src="../../runtime/animations.jsx"></script>
<script type="text/babel" src="../../styles/motion/kit.jsx"></script>
```

Subtitles, the last child of every narrated scene's `SceneRoot`, written out literally in each scene (validate-sync looks for `<SubtitleRail sceneIdx={N}` in the file, so don't wrap it in a helper):

```jsx
<SubtitleRail sceneIdx={N} bottom={150} fontSize={28} variant="clean" accentColor={CYAN} fontFamily="Inter" />
```

Only use font weights the link loads: Sora 600/700/800, Inter 400/500/600, JetBrains Mono 400/600. Anything else is faux-bold.

## Palette (constants exported by kit.jsx)

| Constant | Value | Use |
|---|---|---|
| `INK` | `#0B0F19` | Background (`SceneRoot`, `<Stage background>`, `html, body`) |
| `VIOLET` | `#7C5CFF` | Primary accent: active nodes, core blocks, highlights, gradient start |
| `CYAN` | `#22D3EE` | Secondary accent: prompt `$`, cursors, kickers, **subtitle active word**, gradient end |
| `OK` | `#34D399` | Success: checks, "ready", output files |
| `WARN` | `#FBBF24` | Warnings, the one yellow row that makes the point |
| `DANGER` | `#F87171` | Errors, strikes, stamps, cut segments |
| `TEXT` | `#F5F7FF` | Headlines and body |
| `MUTED` | `rgba(245,247,255,0.62)` | Secondary text, terminal output |
| `FAINT` | `rgba(245,247,255,0.38)` | Comments, dim rows, meta labels |
| `CARD` | `rgba(255,255,255,0.05)` | Glass card fill |
| `CARD_BORDER` | `rgba(255,255,255,0.10)` | Card border |
| `CODE_BG` | `#0F1524` | Windows (terminal, code, browser), tiles |
| `GRAD` / `GRAD_DIAG` | violet → cyan, 90° / 135° | Gradient words, progress fills, underlines, logo |

Also exported: fonts `DISPLAY` (Sora), `SANS` (Inter), `MONO` (JetBrains Mono); `SHADOW`, `TS` (text shadow); `SNAPPY` `{k:320,d:30}`, `PUNCH` `{k:200,d:14}`; `CODE` (syntax colours); helpers `alpha(color, a)`, `mix(a, b, p)`, `tone(name)` (`'violet' | 'cyan' | 'ok' | 'warn' | 'danger' | 'ghost'` → hex).

**Background.** `SceneRoot` paints `INK` with two static glows (violet 20 % top-left, cyan 12 % bottom-right), a faint dot grid and a vignette. Keep it; add a `Glow` or `Watermark` behind a hero element when a scene needs depth.

## Type scale (720 × 1280)

| Role | Spec |
|---|---|
| Hero numeral | Sora 800, 160–220 (`Counter`, often `gradient`) |
| Headline | Sora 800, 56–72, `TEXT`, accent words in `GRAD` (`Title` with `*word*`) |
| Wordmark | Sora 800, 64–80, letters violet → cyan |
| Card / tile title | Sora 700, 28–32 |
| Body / labels | Inter 500–600, 24–28 |
| Kicker | Inter 600, 22, uppercase, `0.22em`, `CYAN` |
| Code / terminal | JetBrains Mono 400/600, 22–24 (24 default) |
| Window chrome, line numbers, grid labels | 18–20 (the only text allowed under 24: it's chrome, not content) |
| Subtitle | Inter 600, 28 (runtime) |

## How the kit works (read this before using any component)

**Clock.** Every component reads the scene clock from `useSprite().localTime`, so it must render inside the scene's `<Sprite {...useSceneWindow(N)}>`. Every time prop — `at`, `rows[i].at`, `until`, `outAt`, `cutAt`, `sendAt`, `hotAt`, `ringAt` — is in seconds on that same clock. **Pass `useWordCue(N, "phrase")` results, never typed numbers.** Offsets from a cue (`cueX + 0.2`) are fine for staggering. A cue that isn't found returns `Infinity`, and the element stays hidden. Pass `t={…}` only to drive a component from a different clock.

**Enter only.** Components enter at `at` and stay. The only things that leave are the ones with a prop for it (`outAt` on a dock tile, `cutAt` on a timeline clip, `until` on a code highlight). The next scene's transition replaces everything.

**Placement.** Every component takes `x`, `y` (canvas px), `z` and `style`:
- neither `x` nor `y` → normal flow (put it in your own flex row/column),
- only `y` → absolutely positioned at that top, **centred horizontally** (the common case),
- `x` and `y` → absolute at that point.

`Arrow` and `Cursor` work in canvas coordinates; make them direct children of `SceneRoot`.

**Entries.** Most components take `enter` (a name or a function `dt → style`). Names: `slideUp`, `rise` (spring up), `pop` (spring scale, punch), `wipe` (reveal left → right), `wipeLeft`, `wipeUp`, `wipeDown`, `fromLeft`, `fromRight`, `fromTop`, `fromBottom` (spring push from that side), `blur`, `drop`, `zoom`, `fadeIn`, `none`. For your own elements use the helpers directly; they take `dt = localTime - at` (negative = hidden) and return a style object:

```jsx
<div style={{ position: 'absolute', top: 300, left: 100, ...enter.slideUp(localTime - cueX) }}>…</div>
enter.pop(dt)            enter.wipe(dt, 0.55, 'right')     enter.push(dt, 'left')    // from the left
enter.blur(dt, 0.5)      enter.rise(dt)    enter.drop(dt)   enter.zoom(dt)    enter.fadeIn(dt)
entry('fromRight', dt)   // same thing by name
```

(Inside a scene, name the Sprite clock `localTime`, e.g. `<Sprite {...win}>{({ localTime }) => …}</Sprite>` or `const { localTime } = useSprite()` in a child component. Write `enter.slideUp(localTime - cueX)`, not `localTime - 2.4`: check-sync rejects hand-typed delays.)

**Determinism.** The kit has no timers, rAF, `Math.random`, `Date` or CSS transitions. Cursor blink is `Math.floor(t * 2) % 2`; noise comes from `seededRandom(seed)`. Your scene code must follow the same rule (`reelsmith lint`).

**Safe area.** Every text-bearing component defaults to a width that keeps text ≤ 520 px and ≥ 48 px from the edges when centred (windows 580–600 wide with padding, cards 520–560). If you widen something, the contact sheet tells you. Decorative layers (`SceneRoot` background, `Glow`, `Watermark`, `Arrow`, `Cursor`, timeline ruler) carry `data-bleed`.

## Layouts

| Layout | When | Build it with |
|---|---|---|
| **Hook** | The first 2 s. One big thing lands at 0.3 s and something moves by 1.0 s | `Counter` (hero numeral) or `Title` + `Watermark`/`Glow` behind; a `Chip` row or `PhoneFrame` + `MiniReel` on the next cue. Never a lone centred title |
| **Terminal-led** | A command is the point ("run `reelsmith doctor`") | `Kicker` at y≈130, `Terminal` at y≈190 typing on the command's cue, output `rows` on their cues with `status`; a `Badge`/`Callout`/`ProgressBar` under it on the payoff word |
| **Split** | Two ways, before/after, TTS vs your take | `SplitCard` (row), each panel with its own `at`; put a `Waveform`, `Chip`s or a small `CodeCard` inside. A `Ring`/`Counter` or `Callout` below on the verdict |
| **Diagram** | A pipeline, an architecture, a flow of data | `FlowDiagram` vertical (4–6 nodes) lighting up on each word; or `PluginDock` for "core + plugins"; `Arrow` for one-off links |
| **Code walk** | Showing a file and pointing at lines | `CodeCard` with `highlight=[{ line, at }]` moving down the file on cues, line `label`s (`s1.1`), a `Stamp` or `Badge` on the punchline; `FileTree` for "where it lives" |
| **Checklist** | Doctor output, lint results, take review | `StatusRows` with `doneAt` spinners → states; one `warn` row to make the point |
| **Grid / timeline** | Contact sheets, renders, cuts | `Grid` (scores, `ringAt` on the worst), `Timeline` (clips, `cutAt`, playhead), `ProgressBar` |
| **Close** | The last beat | `Wordmark` (letter pop) + a `Title` punch line, or the final `Terminal` command with `finalPrompt`; the music tail holds it. No silent CTA card unless the creator asks |

Put the scene's main element between y≈180 and y≈900. Stack two elements rather than leaving a hole in the middle (banned: empty middle band).

## Motion rules

- **Something new every 2–4 s**, bound to the word that introduces it (`useWordCue`).
- **Vary entries** inside a scene and between scenes: a window `rise`s, rows push `fromLeft`, a stamp `pop`s, a label `wipe`s. Never everything `slideUp`.
- **Scene transitions** (`SceneRoot enter`): `fade`, `wipe` (cyan light edge), `push`, `up`, `zoom`, `iris`. Scene 1 has none. Don't use the same one twice in a row.
- **Springs:** snappy UI `k=320, d=30` (`SNAPPY`); punch `k=200, d=14` (`PUNCH`) for stamps, chips, counters, dock tiles.
- **Stagger** 0.12–0.2 s between siblings that share a cue (`at={cueX + i * 0.15}`), otherwise each on its own word.
- **No early exits**: overlays never fade out before the scene ends. A thing that must go away uses its explicit prop (`outAt`, `cutAt`, `until`).
- **Keep it moving without noise**: a typing cursor, flowing connector dots, a breathing `Glow`, a playhead. No particle bursts, no glow on chrome for decoration.

## Components

Every snippet below assumes it sits inside `<SceneRoot>` in a scene Sprite, with `cueX` values from `useWordCue`. Common props on everything: `at` (default 0), `x`, `y`, `z`, `style`, `t`, and `enter` where noted.

### SceneRoot — the scene root (background, transition, stacking)
```jsx
<SceneRoot idx={3} enter="wipe" pattern="dots">   {/* enter: fade|wipe|push|up|zoom|iris|none; idx 1 never transitions */}
  …content…
  <SubtitleRail sceneIdx={3} bottom={150} fontSize={28} variant="clean" accentColor={CYAN} fontFamily="Inter" />
</SceneRoot>
```
Props: `idx` (= scene number: sets `zIndex` so the incoming scene covers the outgoing one during the 0.5 s overlap), `enter`, `bg` (INK), `glow` (true), `pattern` (`'dots' | 'grid' | 'none'`), `vignette` (true), `style`.

### Glow, Watermark — depth behind a hero element (decorative, `data-bleed`)
```jsx
<Glow x={360} y={420} r={300} color={VIOLET} opacity={0.3} breathe={0.04} />
<Watermark text="150" y={560} size={560} opacity={0.09} />
```
`Glow`: `x, y` centre, `r`, `color`, `opacity`, `breathe` (0 = static; 0.03–0.05 = slow pulse), `at` (fade in). `Watermark`: giant faint text, `x` (360), `y` centre, `size`, `color`, `opacity`, `drift` (px/s upward), `at`.

### Title — display headline, word-by-word reveal
```jsx
<Title y={450} at={cueWords} size={64} text="*Words* in,|video out." />
<Title y={130} ats={[cueEvery, cueThing, cueIs, cuePlugin]} text="Everything is a *plugin*" />
```
`text` (or children): `*word*` = accent, `|` or `\n` = line break. `at` + `stagger` (0.08) or `ats` (per-word cues; words past the end of `ats` follow the previous word by `stagger`), `size` (64), `weight` (800), `color`, `accent` (`'gradient'` or a colour), `align` (center), `width` (520), `lineHeight`, `enter` (`'mask'` default: words rise out of a mask; or any entry name), `font`.

### Kicker — small uppercase label over a title
```jsx
<Kicker y={130} at={0}>Episode 03 · First video</Kicker>
```
`children`/`label`, `color` (CYAN), `size` (22). Gradient bar grows, text wipes in.

### Counter — count-up numeral
```jsx
<Counter y={220} value={150} at={cueHundred} dur={1.4} size={200} gradient />
<Counter value={41} suffix=" MB" at={cueSize} size={96} />
<Counter value={89} at={cueRender} format={(n) => `${Math.floor(n / 60)}:${String(Math.round(n % 60)).padStart(2, '0')}`} />
```
`value` (target), `from` (start value, 0), `at`, `dur` (1.2, easeOutCubic), `decimals`, `prefix`, `suffix`, `format(n)`, `size` (180), `weight`, `color`, `gradient`, `font`, `enter` (`'blur'`). Tabular numerals, so the width doesn't jitter.

### Chip, Badge — pills and tags
```jsx
<Chip at={cueAgent} icon="sparkle">Claude Code</Chip>
<Chip at={cueCmd} mono color="cyan" variant="outline">reelsmith init</Chip>
<Badge variant="ok" icon="check" at={cueReady}>ready to render</Badge>
```
`Chip`: `children`/`label`, `icon`, `color` (any `tone` name or hex), `variant` (`soft | solid | outline | ghost`), `mono`, `size` (24), `enter` (`'pop'`). `Badge`: `variant` (`violet | cyan | ok | warn | danger | ghost`), `icon`, `size` (22), `mono`, `upper` (true), `enter` (`'pop'`). Rows of chips: put them in a flex row with `gap: 14`, each with its own `at`.

### Icon — stroke icons drawn in SVG
```jsx
<Icon name="check" size={28} color={OK} />
```
Names: `check x warn info file folder mic wave send lock play eye cog bolt palette words terminal code sparkle arrow plus video chat globe clock cloud plug shield film user key rec dot`. `size`, `color`, `stroke` (2.2), `fill`. No brand logos: use a `Chip` with the name.

### Card, Callout, Tile — containers
```jsx
<Card y={360} width={520} at={cueOpen} title="publish.md" icon="file">…your content…</Card>
<Callout y={880} icon="bolt" color="warn" at={cueLint} title="Lint before render">check-sync + validate-sync</Callout>
<Tile icon="wave" title="TTS" sub="text → voice" at={cueTts} activeAt={cueSwap} width={250} />
```
`Card`: `width`, `padding` (26), `title` (uppercase label; `titleMono` for a file name), `icon`, `color`, `glowAt` (border lights up), `enter` (`'slideUp'`). `Callout`: `icon` (name or node), `color`, `title`, `children`/`text`, `width` (520), `enter` (`'wipe'`). `Tile`: `icon`, `title`, `sub`, `color`, `activeAt`, `width` (250), `height`, `enter` (`'pop'`), `children`. For a 2 × 2 grid: a flex-wrap div `width: 528, gap: 28` with four `Tile width={250}`.

### Terminal — typed command + output rows
```jsx
<Terminal y={190} title="~/my-channel" command="reelsmith doctor" at={cueRun} finalPrompt rows={[
  { text: 'node 22.17.0', status: 'ok', at: cueNode },
  { text: 'playwright chromium', status: 'warn', right: 'install', at: cueChromium },
  { text: 'OPENROUTER_API_KEY', status: 'ok', right: 'set', at: cueKey },
]} />
```
The window opens 0.4 s before `at` (or at `showAt`), then `command` types at `speed` (28 chars/s) with a block cursor (solid while typing, blinking after). `rows[i]`: `text`, `at` (default: 0.3 s after typing ends, 0.18 s apart), `status` (`ok | warn | err | info` → coloured icon), `right` (right-aligned detail), `color`, `dim`, `bold`. Rows grow in with a fade + slide. Props: `title` ('zsh'), `prompt` ('$'), `speed`, `width` (580), `fontSize` (24), `lineHeight` (1.5), `height` (fixed body height: content anchors to the bottom and scrolls up like a real terminal), `finalPrompt` (a fresh `$` line with a blinking cursor after the last step), `cursorColor`, `accent` (top gradient line), `enter` (`'rise'`).

Several commands in one window: `steps` instead of `command`/`rows`:
```jsx
<Terminal y={180} at={cueSheet} steps={[
  { cmd: 'reelsmith sheet my-video', at: cueSheet },
  { text: 'contact sheet → frames/contact-sheet.png', status: 'ok', at: cueSheetDone },
  { cmd: 'reelsmith draft my-video', at: cueDraft },
  { text: 'draft.mp4 · 15 fps · 0.75×', status: 'ok', at: cueDraftDone },
]} />
```
Long commands wrap (monospace, `break-all`). At 24 px a line holds ~36 characters. `typeDuration(text, speed)` gives the typing time if you need to place something after a command finishes (`at={cueRun + typeDuration('reelsmith doctor')}`).

### PromptBox — an agent prompt being typed and sent
```jsx
<PromptBox y={560} at={cueAsk} text="make me a video about prompt caching" sendAt={cueSend} label="Claude Code" />
```
`text`, `at` (typing starts), `speed` (24), `sendAt` (send button presses), `label`, `placeholder`, `width` (580), `fontSize` (26), `showAt`, `enter` (`'rise'`).

### Typed, Strike — inline text effects
```jsx
<span style={{ fontFamily: MONO, color: CYAN }}><Typed text="Just files." at={cueFiles} /></span>
<div style={{ fontFamily: SANS, fontSize: 30 }}>No <Strike at={cueNo}>timeline editor</Strike>.</div>
```
`Typed`: `text`, `at`, `speed` (28), `cursor` (true), `cursorColor`, `bar` (thin bar cursor instead of a block). `Strike`: `children`, `at`, `color` (DANGER), `thickness` (6), `rotate` (−3°), `dim` (0.5: text opacity under the strike), `dur` (0.4). For "strike → replace", put the replacement word next to it with its own entry on the next cue.

### CodeCard — a file with syntax colours, line reveal and highlights
```jsx
<CodeCard y={150} title="script.md" at={cueFile} highlight={[{ line: 1, at: cueTitle, until: cueStyle }, { line: 2, at: cueStyle }]} lines={[
  '---',
  'title: Prompt caching',
  'style: motion',
  '---',
  { text: 'One sentence per line.', label: 's1.1', labelAt: cueLine },
  { text: '> say: "one hundred"', dim: true },
]} />
<CodeCard y={560} title=".env" lines={[{ text: 'OPENROUTER_API_KEY=sk-or-v1-••••', type: true, at: cueKey }]} />
```
The window enters at `at` (`enter` `'fromRight'`); line *i* shows at `at + 0.25 + i * stagger` (0.12) unless the line has its own `at`. `lines[i]`: a string or `{ text, at, type (typewriter at speed), dim, color (plain colour, no highlighting), segs ([{ s, c }] custom colouring), label (a small badge at the line end), labelTone, labelAt }`. `highlight`: line indexes (0-based; lit once shown) or `{ line, at, until, color }` (move it down the file on cues). `lang` is taken from the file name (`md json js jsx html sh env yaml py …`; override with `lang`); the highlighter knows keywords, strings, numbers, JSX tags, keys, flags, comments, markdown headings/quotes/frontmatter. Props: `numbers` (true), `start` (1), `fontSize` (24; 22 for dense code), `width` (600), `speed` (30), `badge` (replaces the lang badge), `accent`.

> **Showing code that contains `useWordCue(…)`:** validate-sync scans the whole file for `useWordCue(N, "…")`, including inside strings you display, and fails when the phrase isn't in that scene. Put `// sync-ok` at the end of that line (or on the line above), e.g. `'const cue = useWordCue(2, "bill");', // sync-ok (on-screen code)`.

### FileTree — folders and files with CSS icons and guide lines
```jsx
<FileTree y={150} title="my-channel/" at={cueInit} rows={[
  { name: 'videos/', depth: 0 },
  { name: 'my-video/', depth: 1 },
  { name: 'script.md', depth: 2, at: cueScript, badge: 'new', hotAt: cueScript },
  { name: 'index.html', depth: 2, at: cueIndex, note: 'you + agent' },
  { name: 'reelsmith.config.json', depth: 0, at: cueConfig },
]} />
```
`rows[i]`: `name` (a trailing `/` makes it a folder), `depth`, `kind` (`'dir' | 'file'`), `at` (default `at + 0.2 + i * stagger`), `badge` (+ `badgeVariant`, `badgeAt`), `note` (right-aligned), `hotAt` (row lights cyan), `color` (icon colour; files are tinted by extension). Props: `title` (mono, on a glass card), `card` (true), `width` (540), `fontSize` (24), `stagger` (0.14), `enter` (`'fromLeft'`, per row).

### StatusRows — checklists with state icons
```jsx
<StatusRows y={560} title="doctor" rows={[
  { label: 'check-sync', state: 'ok', detail: '0 errors', at: cueCheck },
  { label: 'validate-sync', state: 'warn', detail: '1 warning', at: cueValidate },
  { label: 'render', state: 'ok', detail: '1:29', at: cueRender, doneAt: cueDone },
]} />
```
`rows[i]`: `label`, `state` (`ok | warn | bad | pending`), `at`, `detail` (mono, right; coloured for warn/bad), `doneAt` (a spinner from `at` until `doneAt`, then the state pops). Props: `title`, `card` (true), `width` (560), `fontSize` (26), `mono` (labels in mono), `stagger` (0.2), `enter` (`'fromLeft'`).

### FlowDiagram — nodes that light up with an animated connector
```jsx
<FlowDiagram y={180} nodes={[
  { label: 'script.md', sub: 'you write', icon: 'file', at: cueScript },
  { label: 'voice.mp3', sub: 'tts or your take', icon: 'mic', at: cueVoice },
  { label: 'words[]', sub: 'whisper timings', icon: 'words', at: cueTimings, color: 'cyan' },
  { label: 'output.mp4', icon: 'film', at: cueMp4, color: 'ok' },
]} />
<FlowDiagram y={800} direction="horizontal" width={560} nodes={[{ label: 'take', icon: 'mic', at: cueA }, …]} />
```
All nodes show dim from `at` (default 0.6 s before the first node's cue), each lights up (tint, border, glow, spring punch) at its own `at`, and the connector into it draws during the 0.4 s before (`drawDur`), then dots keep flowing along it. `nodes[i]`: `label`, `sub`, `icon` (else the step number), `color`, `at`, `id`. Props: `direction` (`'vertical'` default, 4–6 nodes; `'horizontal'` for ≤ 3 short labels), `nodeW` (420 vertical), `nodeH` (86 / 150), `gap` (44), `width` (horizontal total, 600), `color`, `mono` (labels in mono, true), `steps` (01…05 on the right), `drawDur`.

### PluginDock — a core block with tiles snapping in
```jsx
<PluginDock y={290} core={{ label: 'reelsmith', sub: 'core' }} tiles={[
  { label: 'tts', sub: 'openrouter', icon: 'wave', at: cueTts, slot: 'left', outAt: cueSwap },
  { label: 'tts', sub: 'elevenlabs', icon: 'wave', at: cueNew, slot: 'left', color: 'ok' },
  { label: 'publish', sub: 'youtube', icon: 'send', at: cuePublish, slot: 'right', color: 'warn' },
]} />
```
Tiles fly in from outside their slot with the punch spring, dock (socket lights, core pulses) and stay; `outAt` flies one away (swap = `outAt` on the old tile, a new tile in the same slot on the next cue). `tiles[i]`: `label`, `sub`, `icon`, `color`, `at`, `slot` (`top | right | bottom | left | topLeft | topRight | bottomLeft | bottomRight`, default in that order), `outAt`. Props: `core` (`{ label, sub, icon }`), `at` (core pops in), `width` (620), `height` (520).

### Wordmark, Logo — brand
```jsx
<Wordmark y={200} at={cueReelsmith} />                  {/* "REELSMITH", letters spring in 0.06 s apart */}
<Wordmark y={200} at={cueName} text="ACME" mark size={72} />
<Logo x={60} y={100} size={56} at={0} />
```
`Wordmark`: `text` ('REELSMITH'), `at`, `size` (76), `stagger` (0.06), `gradient` (true: violet → cyan per letter), `color`, `underline` (true: a gradient bar grows after the last letter), `mark` (the `Logo` before it). Keep it ≤ 520 px wide (9 letters at 76 ≈ 450 px).

### Waveform — seeded audio bars
```jsx
<Waveform width={236} height={120} bars={22} at={cueTts} active={[cueTts, cueDone]} />   {/* dances while "speaking" */}
<Waveform width={520} height={110} seed={11} sweep={[cuePlay, cueEnd]} />                 {/* player playhead */}
```
`bars` (40), `width` (520), `height` (120), `seed`, `active` (`[from, to]`: bars move and light up, then settle low), `sweep` (`[from, to]`: playhead colours bars left → right), `at` (bars grow in from the centre), `color` / `color2` (gradient ends), `gap`, `speed`.

### ProgressBar, Ring — progress
```jsx
<ProgressBar y={760} at={cueStart} until={cueDone} label="rendering · 4 shards" />
<Ring y={580} at={cueCount} until={cueDone} size={240}><Counter value={150} at={cueCount} dur={1} size={72} enter="none" /></Ring>
```
`ProgressBar`: `at` → `until` (aliases `from` → `to`, both **times**), `value` (final fill, 1), `width` (520), `height` (16), `label`, `pct` (show %), `color` (default gradient), `ease`. Striped shimmer while filling. `Ring`: `at` → `until`, `value` (0..1), `size` (240), `stroke` (16), `color`/`color2`, `children` centred.

### Timeline — clips, cuts, playhead
```jsx
<Timeline y={720} at={cueTimeline} playhead={{ at: cuePlay, until: cueEnd }} clips={[
  { label: 's1.1', dur: 2 }, { label: 'um', dur: 0.8, cutAt: cueCut }, { label: 's1.2', dur: 2.4 }, { label: 's2.1', dur: 1.8, color: 'ok' },
]} />
```
`clips[i]`: `label`, `dur` (relative length), `color`, `at`, `cutAt` (flashes red with hatching, then collapses; later clips slide left). Props: `width` (580), `height` (66), `gap`, `stagger`, `playhead` (`{ at, until }`), `ruler` (true), `fontSize` (20).

### Grid — contact-sheet thumbnails
```jsx
<Grid y={140} cols={4} at={cueSheet} cells={[
  { label: '0.3s', score: 9, scoreAt: cueScore }, { label: '1.0s', score: 6, scoreAt: cueScore, ringAt: cueWorst }, …
]} />
```
`cells[i]`: `label`, `color`, `at` (default `at + i * stagger`), `score` (chip coloured ≥8 ok, 7 warn, else danger; `scoreAt`), `ringAt` (+ `ringColor`) to circle a cell, `dim`. Or `count` for auto cells. Props: `cols` (3), `width` (520), `gap` (14), `aspect` (16/9: portrait frames), `stagger` (0.06), `seed`, `labels`.

### SplitCard — two panels with a medallion
```jsx
<SplitCard y={150} height={360} divider="or"
  left={{ title: 'TTS', sub: 'one API call', icon: 'wave', at: cueTts, children: <Waveform width={236} height={110} bars={22} active={[cueTts, cueEnd]} /> }}
  right={{ title: 'Your take', sub: 'teleprompter', icon: 'mic', at: cueTake, children: <Chip mono size={22}>reelsmith record</Chip> }} />
```
`left` / `right`: `{ title, sub, icon, color, at, children }` (panels push in from their side). Props: `layout` (`'row'` | `'column'`), `width` (620), `height` (380), `gap` (26), `divider` (medallion text, `null` for none), `dividerAt`. Panel content area is ~236 px wide in a row.

### PhoneFrame + MiniReel — a device showing a short
```jsx
<PhoneFrame y={140} width={300} at={cuePhone}>
  <MiniReel at={cuePhone} title="Prompt caching, explained" look="motion" />
</PhoneFrame>
```
`PhoneFrame`: `width` (300), `scale` (multiplies the size), `screenBg`, `tilt` (deg), `enter` (`'rise'`), `children` rendered in a **360 × 640 virtual screen** scaled to fit (design phone content once, at that size). `MiniReel`: a fake short for the screen: kicker, title, a card, a karaoke subtitle line advancing at `wps` (2.6), a progress bar; `look` (`'motion' | 'reflective' | 'news'`, for "three styles" scenes), `accent`, `words`, `kicker`, `at`.

### BrowserFrame, Window — app mockups
```jsx
<BrowserFrame y={120} url="localhost:4310" height={300} at={cueApp}>…absolutely positioned content…</BrowserFrame>
<Window y={200} title="preview-approved.json" icon="lock" width={560} at={cueApprove}>…</Window>
```
`BrowserFrame`: `url`, `width` (600), `height` (body), `children`. `Window`: `title`, `icon`, `right` (node in the title bar), `url` (turns the title into an address bar), `width` (580), `height`, `padding`, `bodyStyle`, `accent`, `enter` (`'rise'`). Terminal and CodeCard are built on `Window`.

### Stamp — rubber stamp punch-in
```jsx
<Stamp y={620} at={cueNotSpoken} rotate={-10}>not spoken</Stamp>
<Stamp y={700} at={cueExpired} color="danger">expired</Stamp>
```
`children`/`label`, `at`, `color` (DANGER; `'ok'` for APPROVED), `rotate` (−12), `size` (44). Scales from 2.3× with the punch spring and throws a ring.

### Arrow, Cursor — canvas-space pointers (direct children of SceneRoot)
```jsx
<Arrow from={[560, 420]} to={[470, 720]} curve={-60} at={cueLink} />
<Cursor path={[[cueMove, 620, 980], [cueClick - 0.3, 380, 820]]} clicks={[cueClick]} />
```
`Arrow`: `from`, `to` (canvas px), `at`, `dur` (0.5), `curve` (px bend), `color` (CYAN), `width`, `head`, `dashed`; the head rides the tip while it draws. `Cursor`: `path` (`[[time, x, y], …]`, spring-chained with `track`, `k`/`d`), `clicks` (times: press + ripple), `kind` (`'pointer' | 'touch'`), `size`. The tip of the pointer is at (x, y).

## Safe area

Every text line ≥ 48 px from both edges and ≤ 520 px wide (`styles/design.md`). With the kit defaults, centred components are safe. Watch: wide custom rows, a `Wordmark` longer than 9 letters at 76 px, `CodeCard`/`Terminal` widened past 600, long `Chip` rows (wrap them in a 520 px flex-wrap container). `reelsmith sheet` lists offenders; the list must be empty before the preview gate.

## Banned defaults (motion-specific)

- **A centred title on an empty background as the whole scene.** Every scene has a primary element (terminal, card, diagram, device) and the title supports it
- **Everything `slideUp`.** Mix `rise`, `pop`, `wipe`, `fromLeft`/`fromRight`, typing, drawing, count-ups
- **An empty middle band**: content at the top and the subtitles at the bottom with nothing between y≈400 and y≈900
- **Tiny text**: content under 24 px (only window chrome, line numbers and grid labels may go to 18–20)
- **Static for more than 3 s**: a new row, a highlight moving, a node lighting, a cursor, a counter, something on a cue every 2–4 s
- Stock photos, emoji as icons, brand logos drawn from memory, glows on window chrome, particle bursts

## Minimal video skeleton

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My tutorial</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
  <script src="https://unpkg.com/react@18.3.1/umd/react.development.js" integrity="sha384-hD6/rw4ppMLGNu3tX5cjIb+uRZ7UkRJ6BPkLpg4hAu/6onKUg4lLsHAs9EBPT82L" crossorigin="anonymous"></script>
  <script src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js" integrity="sha384-u6aeetuaXnQ38mYT8rp6sbXaQe3NL9t+IBXmnYxwkUI2Hw4bsp2Wvmx4yRQF1uAm" crossorigin="anonymous"></script>
  <script src="https://unpkg.com/@babel/standalone@7.29.0/babel.min.js" integrity="sha384-m08KidiNqLdpJqLq95G/LEi8Qvjl/xUYll3QILypMoQ65QorJ9Lvtp2RXYGBFj1y" crossorigin="anonymous"></script>
  <script type="text/babel" src="../../runtime/animations.jsx"></script>
  <script type="text/babel" src="../../styles/motion/kit.jsx"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; background: #0B0F19; overflow: hidden; }
    #root { width: 100%; height: 100vh; position: relative; }
  </style>
</head>
<body>
<div id="root"></div>
<script type="text/babel">
// ── Scene 1 · hook: the command ──────────────────────────────────────────────
function Scene1() {
  const win = useSceneWindow(1);
  const cueRun = useWordCue(1, "run");
  const cueChecks = useWordCue(1, "checks");
  const cueGreen = useWordCue(1, "green");
  return (
    <Sprite {...win}>
      <SceneRoot idx={1}>
        <Glow x={360} y={420} r={320} opacity={0.26} />
        <Kicker y={130} at={0}>Episode 02 · Install</Kicker>
        <Terminal y={190} title="~/my-channel" command="reelsmith doctor" at={cueRun} finalPrompt rows={[
          { text: 'node 22.17.0', status: 'ok', at: cueChecks },
          { text: 'ffmpeg 7.1', status: 'ok', at: cueChecks + 0.2 },
          { text: 'python3.11 + whisper', status: 'ok', at: cueChecks + 0.4 },
        ]} />
        <Badge y={560} variant="ok" icon="check" at={cueGreen}>ready</Badge>
        <SubtitleRail sceneIdx={1} bottom={150} fontSize={28} variant="clean" accentColor={CYAN} fontFamily="Inter" />
      </SceneRoot>
    </Sprite>
  );
}

function App() {
  return (
    <Stage width={720} height={1280} scenesSrc="scenes.json" background={INK} loop={false} autoplay={true} persistKey="my-tutorial">
      <Scene1 />
    </Stage>
  );
}
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
</script>
</body>
</html>
```

Each later scene is the same shape with `SceneRoot idx={N} enter="…"` and its own cues. Then `reelsmith lint <video>` (must exit 0) and `reelsmith sheet <video>` (look at it, fix the three worst, repeat).

## Kit changes and the preview gate

The kit is part of what decides a frame. The preview approval fingerprint must include `styles/<pack>/kit.jsx` for every kit the page loads; if you edit the kit after an approval, re-run the preview and the approval. Changing the kit changes every video that uses it, so re-check their contact sheets too.
