---
name: html-animation
description: Write or edit videos/<name>/index.html — the React/Babel scene animation the renderer captures. Use whenever an index.html is being written or changed, after scenes.json + voiceover.mp3 exist (post-finalize). Starts by loading the video's style (config/styles/<style>.md; default reflective, tech-news only when asked). Enforces word-cue binding (useWordCue), SubtitleRail on every narrated scene, the style's visuals (graded photos for reflective, code-driven for tech-news), deterministic time-driven motion, both sync linters exiting 0, a contact-sheet self-critique loop (every score 8+), and a human preview gate (user approves stills) before render.
---

# HTML Animation Skill — Voiceover-Synced Text

Invoke this skill whenever you're writing or editing `videos/<name>/index.html`.

This file enforces non-negotiable rules that fix our biggest recurring bugs and the generic "AI video" look.

## Rule 0 — Load the style first

Every video has one style, and its file decides palette, fonts, subtitles, photos, transitions and scene layouts:

| Style | When | File | Reference video |
|---|---|---|---|
| **`reflective`** (default) | Always, unless one of the tech-news conditions holds | `config/styles/reflective.md` | `videos/devotion-tts/index.html` |
| `tech-news` | The creator asks for it, or `script.md` frontmatter has `style: tech-news` | `config/styles/tech-news.md` → `config/design.md` | — |

For reflective, copy the style kit from `videos/devotion-tts/index.html` (constants, motion helpers, `Shot`/`PhotoSeq`/`Grade`/`Glow`/`Enter`/`Label`/`Chip`/`StrikeLine`) instead of re-writing it, and pick scene layouts from the style file's table. Rules 1, 2, 4, 5 and 6 apply to both styles. Rule 3 is tech-news only.

## Rule 1 — Word-cue binding

Every text overlay that introduces a specific piece of narration (a name, number, stat, callout, bullet) MUST have its reveal delay bound to a Whisper word cue via `useWordCue(sceneIdx, "phrase")`.

**DO NOT use hand-picked second-based delays** like `delay={0.4}` / `delay={7.5}` for content reveals. Those numbers are always wrong because scene durations are derived from actual voiceover length and Whisper is the source of truth for *when* specific words are spoken.

### Banned

```jsx
// ❌ Wrong — hardcoded delay, no relation to narrator
...slideUp(Math.max(0, localTime - 7.5), 0.5)
<Stat value="$103B" label="..." delay={0.6} />
{text: 'Rationed nationwide', delay: 0.5}
```

### Required

```jsx
// ✅ Right — delay comes from Whisper
const cueCallout = useWordCue(1, "sound of one");
const cueStat    = useWordCue(2, "103 billion");
const cueFuel    = useWordCue(3, "fuel rationed");

...slideUp(Math.max(0, localTime - cueCallout), 0.5)
<Stat value="$103B" label="..." delay={cueStat} />
{text: 'Rationed nationwide', delay: cueFuel}
```

## Rule 2 — SubtitleRail on every narrated scene (REQUIRED)

Every scene Sprite that has narration **must** include `<SubtitleRail sceneIdx={N} />` as the last child of the scene's root div. This gives every video automatic karaoke-style subtitles synced to Whisper word timestamps. It is not optional.

```jsx
// ✅ Required pattern — SubtitleRail always last inside root div
<Sprite {...useSceneWindow(3)}>
  {({ localTime, duration }) => (
    <div style={{ position: 'absolute', inset: 0 }}>
      <ImageCut ... />
      {/* overlay elements */}
      <SubtitleRail sceneIdx={3} />
    </div>
  )}
</Sprite>
```

**Exempt:** CTA scene only (last scene, `cta-end` template — has its own centered text, no narration map). Reflective videos have no CTA scene: they end on the closing card, which is narrated and keeps its SubtitleRail.

**Reflective (default):** always `<SubtitleRail sceneIdx={N} bottom={170} fontSize={26} variant="clean" accentColor={GOLD2} />`. That's sentence case, no pill, soft shadow, wider word gap, and the spoken word in gold at the same size. The old 32 px CAPS pill felt big, mid-screen and crowded. Keep overlays above y ≈ 1000.

**Tech-news `bottom` prop guidance** — default `300` sits above the standard overlay band. Increase for taller content:
- `timeline-events` with 3–4 rows: `bottom={380}`
- `context-stat` with large stat: `bottom={340}`
- `impact` / centered layout: `bottom={200}`

Run `node scripts/validate-sync.js <file>` — it warns if any narrated scene is missing SubtitleRail.

**Spacing is runtime-managed** — row-gap (fontSize × 0.1), line-height (1.25), letter-spacing (0.03em) are baked into the `SubtitleRail` component in `runtime/animations.jsx`. Do NOT attempt to override subtitle spacing via props or CSS. Only use the documented props: `sceneIdx`, `chunkSize`, `bottom`, `fontSize`, `accentColor`, `variant` (`'caps'` default / `'clean'`), `fontFamily`.

## Rule 3 — Design from code, not stock photos (tech-news only)

> **Applies to the `tech-news` style only.** Reflective videos (the default) are photo-led: Unsplash/Wikimedia photos in `images/`, credited in `images/CREDITS.md`, Ken Burns on every shot, a cut every 2.5–3.5 s on word cues, always under a warm `Grade`. See `config/styles/reflective.md`.


**Do NOT use stock photos as the primary visual in scenes.** The HTML/CSS/typography itself IS the visual design. Stock photos add nothing for technical content — a photo of a server rack doesn't explain S3 Files. Build every scene as a designed composition using code.

### Visual primitives (render these in HTML/CSS/React, not as images)

| Content type | How to build it |
|---|---|
| Typography treatments | Barlow Condensed 800 headlines in `#fff`, strike-throughs via CSS `textDecoration`, color shifts to `#c8102e` for emphasis |
| CSS diagrams | Draw boxes, borders, arrows, connecting lines using styled `<div>` elements with `border`, `background`, CSS pseudo-elements for arrows |
| Code blocks | Dark terminal-style box (`background: '#111'`, monospace font via Barlow style, `fontFamily: "'Courier New', monospace"`), green prompt (`$`), syntax-colored text |
| Stat cards | `Barlow Condensed 800` for the number (72-96px), `Barlow 500` for the label (20-24px). Use `easeOutBack` scale punch for entry |
| Comparison tables | CSS flexbox/grid — rows and columns with `border-bottom: 1px solid rgba(255,255,255,0.1)`, headers in red accent, values in white |
| Warning/callout boxes | `background: 'rgba(200,16,46,0.15)'`, `border: '1px solid rgba(200,16,46,0.4)'`, `borderRadius: 8`, icon + text |
| Decision frameworks | Connected boxes with arrows (─, →) or conditional `if / then` layout using nested divs and colored borders |
| Timeline/steps | Numbered circles + text in horizontal or vertical sequence, `border: '2px solid #c8102e'` for active step |
| Terminal output | `fontFamily: "'Courier New', monospace"`, `color: '#0f0'` for green text on `#111` background, line numbers optional |

### Scene background

Every scene uses a solid dark background (`#080c14` or `#000`). No background images. The composition — text, diagrams, code blocks — fills the canvas.

### When an image IS acceptable

Only use images for things that CANNOT be built in CSS:
- Photos of actual people (portraits for attribution)
- Real-world photos of hardware (only if visually necessary and the topic demands it)
- Maps/geography

For everything else — architecture diagrams, code, comparison tables, decision trees — **build it in HTML/CSS**.

### How this changes the `ImageCut`/`KenBurns` pattern

Previous approach: `ImageCut` cycled stock photos.  
New approach: `ImageCut` and `KenBurns` are **removed**. Scenes have no image primitives. The `<Sprite>` root div applies the dark background directly.

```jsx
// ✅ New pattern — no image primitive, CSS design fills the scene
<Sprite {...useSceneWindow(1)}>
  {({ localTime, duration }) => (
    <div style={{ position: 'absolute', inset: 0, background: '#080c14' }}>
      {/* Designed HTML/CSS content */}
      <SubtitleRail sceneIdx={1} />
    </div>
  )}
</Sprite>
```

### Scene hints update

When writing `## Scene Hints` in script.md, primitives are now **design types**, not image motion types:

```markdown
- Scene 1 (breaking-opener): Typography treatment — "S3 IS OBJECT STORAGE" with strike-through → "S3 FILES"
  Primitive: Typography

- Scene 2 (context-stat): Animated stat cards — ~1ms, TB/s, no download
  Primitive: StatCards

- Scene 3 (context-stat): Terminal code block — mount command and sync demo
  Primitive: CodeBlock

- Scene 4 (context-stat): Two-tier CSS diagram + warning callout
  Primitive: Diagram
```

### Visual references

Read `config/design.md` for the full tech-news design system (colors, fonts, sizing, animation easing). Every tech-news scene must follow it.

## Rule 4 — Every frame is a pure function of time

The renderer seeks to each frame with `setTime(t)` and screenshots it. Anything driven by the wall clock renders differently on every run and differently from preview.

**Banned in index.html** (`check-sync.js` fails on them): `Math.random()`, `setTimeout`/`setInterval`, `requestAnimationFrame`, `Date.now()`/`performance.now()`/`new Date()`, CSS `transition:` and `animation:`.

**Use instead:** values computed from `localTime` — `interpolate`, `Easing.*`, `spring`, `track` for motion, `seededRandom(seed)` for noise/scatter. Render mode (`?render=1`) also disables all CSS transitions/animations globally, so anything relying on them will look different in the MP4 than in preview.

## Rule 5 — Look before you render (self-critique loop)

The linters prove sync, not quality. Before any full render:

1. `node scripts/contact-sheet.js videos/<name>` → `videos/<name>/frames/contact-sheet.png` (hook frames at 0.3/1/2s + 3 per scene, each labelled with the words being spoken).
2. **Read the PNG** and score each 1–10, one line of evidence per score:
   - **Hook** — do the first 2s show something specific and surprising, not just a title?
   - **Phone readability** — thumbnails are phone-sized; can every word be read here?
   - **Breathing room** — does every text line keep ≥48 px from both edges and stay ≤520 px wide? The contact sheet prints a "⚠ edge-to-edge" list; it must be empty (only `data-bleed` decoration is exempt). Full-width text was the creator's top complaint after devotion-tts.
   - **Motion quality** — varied entries, springs where things move physically, nothing static >2–4s?
   - **Variety** — does each scene look different from the last? Any banned default from `config/design.md`?
   - **Style accuracy** — matches the style file? Reflective: Fraunces + Manrope, `BG`/`GOLD`/`GOLD2`/`CREAM`, every photo graded and moving, clean subtitles. Tech-news: Barlow faces, `#c8102e` accent, dark background. No stray colors?
   - **Sync** — does what's on screen match the bracketed spoken word in each caption?
3. Fix the **3 worst** problems, re-run both linters, regenerate the sheet.
4. Repeat until every score is **8+** (cap at 5 rounds, then report the remaining scores to the user). Only then move to the preview gate.

Report the final scores to the user at the preview gate (Rule 6).

## Rule 6 — Human preview gate before any render

The user signs off before the final render. Never start a full `renderer/render.js` without it — not even when the user said "make the video" earlier.

1. `node scripts/contact-sheet.js videos/<name> --stills` → contact sheet plus full-size `frames/stills/*.jpg` (hook frames + every scene, subtitles included).
2. `node renderer/render.js videos/<name>/index.html --draft --audio=videos/<name>/voiceover-mix.mp3` (use `voiceover.mp3` when there is no mix) → `videos/<name>/draft.mp4` in about 30 s: half resolution, 15 fps, with the voice. This is the thing the user actually watches.
3. Send the user `draft.mp4` (send the file, don't just name it), the contact sheet and a selection of stills (the hook frames and at least one per scene), with your Rule 5 scores, and ask for permission to render.
4. If they give feedback, change `index.html`, re-run the linters, check the fix with a range render (`--from=S --to=S` → `clip-Ss-Ss.mp4`, seconds), then redo steps 1–3 and ask again.
5. Only on an explicit approval: `node scripts/approve-preview.js videos/<name> --by="<who>"`, then the final render (`videos/<name>/output.mp4`, about 1.5 min for a 98 s video).

Draft and range renders never need an approval. The final render exits with code 3 when there is no approval or the video changed since it was given (fingerprint of index.html, scenes.json, runtime and images, including `images/**`). `--no-preview-gate` exists only for fixtures/tests. How the renderer works (shards, JPEG frames piped into ffmpeg, segment cache for crash resume) is in `docs/fast-render.md`.

## Permitted exceptions (may use raw small delays ≤ 0.6s)

These are visual intro flourishes that fire at scene start, not tied to specific words:

- Scene opening `DateBadge`, `BreakingTag`, `Divider`, initial `SectionLabel`
- The very first headline of a scene (fine to appear as scene opens)
- CTA card (last scene) — pure visual, no narration map
- Stagger offsets between adjacent elements after a cue (e.g., `cue + 0.15`)

Any raw delay **> 0.6s is a bug** unless accompanied by a `useWordCue` call on the same line.

## No early exits

Text overlays MUST NOT fade out before the scene ends. Use `slideUp` (enter-only), NOT `fade()` (which bakes in an exit), for content overlays. `fade()` is fine for full-scene backgrounds/CTA only.

## Workflow when writing index.html

0. Pick the style (Rule 0): `reflective` unless the creator asked for tech-news or `script.md` frontmatter has `style: tech-news`. Read `config/styles/<style>.md`. For reflective, open `videos/devotion-tts/index.html` as the reference implementation.
1. Read `config/design.md` for the shared rules (canvas, CDN scripts, banned defaults, animation principles). For tech-news it is also the whole design system.
2. Read `videos/<name>/script.md` (`## Scene Hints` section) for scene hints, and `scenes.json` for the exact recorded words — note the design primitive for each scene.
3. Open `videos/<name>/scenes.json` and look at each scene's `words` array.
4. For each scene, build the visual per the style. Reflective: a layout from the style file's table over a `PhotoSeq` of graded, credited photos, with an `Enter` transition that differs from the previous scene's. Tech-news: an HTML/CSS composition, no stock photos.
5. For every scene, identify the key narration phrases your overlays visualize.
6. For each overlay, write `const cue<Name> = useWordCue(sceneIdx, "phrase")` at the top of that scene's Sprite render function.
7. Bind every `delay` / `slideUp` to that cue.
8. Add `<SubtitleRail sceneIdx={N} />` as the last child of every narrated scene's root div (reflective: `bottom={170} fontSize={26} variant="clean" accentColor={GOLD2}`).
9. Run both linters — both MUST exit 0 before rendering:
   ```bash
   node scripts/check-sync.js videos/<name>/index.html
   node scripts/validate-sync.js videos/<name>/index.html
   ```
10. Run the self-critique loop (Rule 5) until every score is 8+:
   ```bash
   node scripts/contact-sheet.js videos/<name>
   ```
11. Preview gate (Rule 6): `--stills` + `--draft`, send the user the draft and stills, wait for "approved", then `approve-preview.js`.
12. Optionally live preview in a browser (plays with the voice; `--lan` prints a `/qr` link so the creator can watch it on the phone over Wi-Fi):
   ```bash
   node scripts/preview.js videos/<name> [--lan]
   ```

## Phrase matching rules (how `useWordCue` resolves)

- Case-insensitive, punctuation-stripped — `"$103B"` matches Whisper's `"103"`.
- Multi-word phrases match consecutive tokens: `"sound of one"` matches `["sound", "of", "one."]`.
- Numbers-as-digits: `"21 million"` matches `["21", "million"]`; `"twenty-one million"` does not unless Whisper spelled it that way. Check scenes.json first.
- If phrase is not found: warning printed, returns `Infinity` → overlay stays hidden. Fix by picking a phrase that actually appears in the words array.

## Checklist before handing off index.html

- [ ] Style loaded (Rule 0) and followed: palette, fonts and subtitle props from `config/styles/<style>.md`.
- [ ] Reflective: every photo in `images/` has a row in `images/CREDITS.md`, has Ken Burns motion and sits under a `Grade`. Cuts land on word cues every 2.5–3.5 s. No two consecutive scenes share an `Enter` type. No `cta-end` scene.
- [ ] Tech-news: no stock photos as the primary visual (Rule 3), no `<ImageCut>`/`<KenBurns>` (scenes use `background: '#080c14'`), every scene a designed composition (code blocks, diagrams, stat cards, typography, not photo + caption).
- [ ] No raw `delay={N}` or `localTime - N` with N > 0.6, except in the exceptions list above.
- [ ] Every content overlay pairs with a `useWordCue(...)` assignment.
- [ ] No `fade(...)` applied to text overlays — only `slideUp(...)` for enter.
- [ ] `<SubtitleRail sceneIdx={N} />` present in every narrated scene (not CTA). Reflective uses the clean props above.
- [ ] `node scripts/check-sync.js <file>` exits 0.
- [ ] `node scripts/validate-sync.js <file>` exits 0 (no errors, no missing-subtitle warnings).
- [ ] No `Math.random`, timers, rAF, wall clock or CSS transitions/animations (Rule 4).
- [ ] No banned defaults from `config/design.md`; something new on screen every 2–4s.
- [ ] Safe area: `contact-sheet.js` reports no edge-to-edge text (≥48 px margins, lines ≤520 px; see the style file's "Safe area").
- [ ] Contact sheet scored 8+ on all seven criteria (Rule 5); scores reported to the user.
- [ ] User approved `draft.mp4` + the stills and `approve-preview.js` was run (Rule 6) — the final `render.js` refuses otherwise.
