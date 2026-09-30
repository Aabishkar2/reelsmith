---
name: html-animation
description: Write or edit videos/<name>/index.html, the React/Babel scene animation the renderer captures. Use whenever an index.html is being written or changed, after scenes.json + voiceover.mp3 exist (after `reelsmith tts` or `reelsmith cut`). Starts by loading the video's style pack (styles/<style>/STYLE.md; the style comes from script.md frontmatter `style:`, else reelsmith.config.json `style`, default reflective). Enforces word-cue binding (useWordCue), SubtitleRail on every narrated scene, the style's visuals, deterministic time-driven motion, `reelsmith lint` exiting 0, a contact-sheet self-critique loop (every score 8+), and a human preview gate (the user approves the draft and stills) before the final render.
---

# HTML animation skill: voice-synced scenes

Use this skill whenever you write or edit `videos/<name>/index.html`.

The rules below fix the most common bugs (text that appears before it is said, wall-clock motion, missing subtitles) and the generic "AI video" look. They are not optional.

Every `reelsmith` command here wraps a script in `tools/` or `renderer/`. If the CLI is unavailable, the escape hatch is to run the script directly, for example `node tools/check-sync.js videos/<name>/index.html`. See `docs/cli.md` for the full mapping.

## Rule 0: load the style first

Every video has exactly one style. Its pack decides the palette, fonts, subtitle props, photo policy, transitions and scene layouts.

**Which style:** `script.md` frontmatter `style:` wins. Without it, use `style` in `reelsmith.config.json`. Without that, `reflective`. Only switch styles when the creator asks. `reelsmith styles` lists every pack the project can see.

| Style | Use for | Read | Reference |
|---|---|---|---|
| **`reflective`** (default) | Essays, calm "think it through" videos. Warm near-black and gold, Fraunces + Manrope, graded Ken Burns photos | `styles/reflective/STYLE.md`, and load `styles/reflective/kit.jsx` after the runtime | `styles/reflective/reference/index.html` |
| `tech-news` | Fast news breakdowns. Near-black, one red accent `#c8102e`, Barlow Condensed + Barlow, designed-from-code scenes | `styles/tech-news/STYLE.md` and the files next to it (components, templates) | none |
| `motion` | Developer and teaching content: terminals, code cards, file trees, diagrams. Bright motion graphics on ink `#0B0F19`, violet `#7C5CFF`, cyan `#22D3EE`, Sora + Inter + JetBrains Mono | `styles/motion/STYLE.md`, and load `styles/motion/kit.jsx` after the runtime | `videos/tut-01-what-is-reelsmith/index.html` |

Every style pack also points at `styles/design.md`, the shared base: canvas, CDN scripts, HTML skeleton, banned defaults, animation principles. Read it too.

How to start from each style:

- **reflective:** load the kit after the runtime (it defines the palette constants and `PhotoSeq`, `Grade`, `Glow`, `Enter`, `Label`, `Chip`, `StrikeLine` and the motion helpers). Paste its body into the page only when a video must tweak a helper. Pick scene layouts from the STYLE.md layouts table; read the reference as code (its photos are not shipped).
- **tech-news:** build every scene from HTML/CSS (Rule 3) with the primitives and templates in the pack.
- **motion:** load the kit after the runtime. Every scene's root is the kit's `SceneRoot`; use its components (`Terminal`, `CodeCard`, `FileTree`, `FlowDiagram`, `PluginDock`, `StatusRows`, `PhoneFrame` and the rest listed in STYLE.md) with their `at` props bound to word cues. Do not re-implement them inline.

```html
<script type="text/babel" src="../../runtime/animations.jsx"></script>
<script type="text/babel" src="../../styles/motion/kit.jsx"></script>   <!-- or styles/reflective/kit.jsx -->
```

A kit is part of what decides a frame. Changing `kit.jsx` after a preview approval needs a new preview and approval, and changes every video that loads it.

Rules 1, 2, 4, 5 and 6 apply to every style. Rule 3 applies to `tech-news` and `motion`.

## Rule 1: word-cue binding

Every text overlay that introduces a specific piece of narration (a name, number, stat, callout, bullet) must have its reveal time bound to a Whisper word cue with `useWordCue(sceneIdx, "phrase")`.

Do not use hand-picked second delays like `delay={0.4}` or `delay={7.5}` for content reveals. They are always wrong, because scene durations come from the real voice and Whisper is the source of truth for when each word is spoken.

### Banned

```jsx
// Wrong: hardcoded delay, no relation to the narrator
...slideUp(Math.max(0, localTime - 7.5), 0.5)
<Stat value="$103B" label="..." delay={0.6} />
{text: 'Rationed nationwide', delay: 0.5}
```

### Required

```jsx
// Right: the time comes from Whisper
const cueCallout = useWordCue(1, "sound of one");
const cueStat    = useWordCue(2, "103 billion");
const cueFuel    = useWordCue(3, "fuel rationed");

...slideUp(Math.max(0, localTime - cueCallout), 0.5)
<Stat value="$103B" label="..." delay={cueStat} />
{text: 'Rationed nationwide', delay: cueFuel}
```

## Rule 2: SubtitleRail on every narrated scene

Every narrated scene Sprite must include `<SubtitleRail sceneIdx={N} ... />` as the **last child** of the scene's root element (the root div, or `SceneRoot` in motion). Write it out literally in each scene; `reelsmith lint` looks for `<SubtitleRail sceneIdx={N}` in the file, so do not wrap it in a helper. It gives every video word-synced karaoke subtitles from the Whisper timestamps.

```jsx
<Sprite {...useSceneWindow(3)}>
  {({ localTime, duration }) => (
    <div style={{ position: 'absolute', inset: 0 }}>
      {/* background and overlays */}
      <SubtitleRail sceneIdx={3} bottom={150} fontSize={28} variant="clean" accentColor={CYAN} fontFamily="Inter" />
    </div>
  )}
</Sprite>
```

Props per style (the STYLE.md is authoritative if it differs):

| Style | SubtitleRail |
|---|---|
| reflective | `<SubtitleRail sceneIdx={N} bottom={170} fontSize={26} variant="clean" accentColor={GOLD2} />` |
| tech-news | `<SubtitleRail sceneIdx={N} />` (runtime defaults: `variant="caps"`, accent `#c8102e`, `bottom={300}`) |
| motion | `<SubtitleRail sceneIdx={N} bottom={150} fontSize={28} variant="clean" accentColor={CYAN} fontFamily="Inter" />` |

Tech-news `bottom` guidance: `380` for `timeline-events` with 3 to 4 rows, `340` for `context-stat` with a large stat, `200` for centered layouts.

**Exempt:** only a silent `cta-end` scene (tech-news). Reflective and motion videos end on a narrated closing scene, which keeps its rail.

**Spacing is managed by the runtime.** Row gap, line height and letter spacing are baked into `SubtitleRail`. Do not override them with CSS. Use only the documented props: `sceneIdx`, `chunkSize`, `bottom`, `fontSize`, `accentColor`, `variant` (`'caps'` or `'clean'`), `fontFamily`.

`reelsmith lint` warns when a narrated scene has no rail.

## Rule 3: design from code, not stock photos (tech-news and motion)

Reflective videos are photo-led: photos in `images/`, credited in `images/CREDITS.md`, Ken Burns on every shot, a cut every 2.5 to 3.5 s on word cues, always under a warm grade. See `styles/reflective/STYLE.md`.

For `tech-news` and `motion`, the HTML/CSS itself is the visual. A photo of a server rack explains nothing. Build every scene as a designed composition.

| Content | Build it as |
|---|---|
| Typography | Display face from the style, strike-throughs, colour shifts to the accent for emphasis |
| Diagrams | Styled `<div>` boxes, borders and connectors. Motion: `FlowDiagram`, `PluginDock` |
| Code | A dark card with monospace text and highlighted rows. Motion: `CodeCard` |
| Terminal output | Prompt, typed command, output rows revealed on cues. Motion: `Terminal`, `StatusRows` |
| Stat cards | Big numeral in the display face, label under it, spring punch-in. Motion: `Counter` |
| Comparisons | Flex or grid rows with thin dividers. Motion: `SplitCard` |
| Callouts | Tinted accent background with a 1 px accent border and an icon |
| Timelines and steps | Numbered circles with the active step in the accent colour |
| Files | Motion: `FileTree`, `Badge`, `Chip` |

Images are acceptable only for what CSS cannot draw: photos of real people (for attribution), real hardware when the topic needs it, maps. Scenes use the style's solid background, never `KenBurns` or `ImageCut` as the primary visual.

When you write `## Scene Hints`, name a design primitive per scene, not an image motion:

```markdown
- Scene 1 (hook): Big numeral "150" counts up, then "words" snaps in. Primitive: Counter + PhoneFrame
- Scene 3 (pipeline): Five nodes light up on their cues. Primitive: FlowDiagram
```

## Rule 4: every frame is a pure function of time

The renderer seeks to each frame with `setTime(t)` and captures it. Anything driven by the wall clock renders differently on every run and differently from the preview.

**Banned in index.html** (`reelsmith lint` fails on them): `Math.random()`, `setTimeout` / `setInterval`, `requestAnimationFrame`, `Date.now()` / `performance.now()` / `new Date()`, CSS `transition:` and `animation:`.

**Use instead:** values computed from `localTime` with `interpolate`, `Easing.*`, `spring`, `track`, and `seededRandom(seed)` for noise or scatter. Render mode (`?render=1`) disables all CSS transitions and animations globally, so anything that relies on them is static in the MP4.

## Rule 5: look before you render (self-critique loop)

The linters prove sync, not quality. Before the preview gate:

1. `reelsmith sheet videos/<name>` writes `videos/<name>/frames/contact-sheet.png`: hook frames at 0.3, 1 and 2 s plus 3 frames per scene, each labelled with the words being spoken.
2. **Read the PNG** and score each criterion 1 to 10 with one line of evidence:
   - **Hook:** do the first 2 s show something specific and surprising, not just a title?
   - **Phone readability:** thumbnails are phone-sized. Can every word be read?
   - **Breathing room:** does every text line keep 48 px or more from both edges and stay 520 px wide or less? The sheet prints an "edge-to-edge" list. It must be empty (only `data-bleed` decoration is exempt). Full-width text is the most common complaint on a phone.
   - **Motion quality:** varied entries, springs where things move physically, nothing static for more than 2 to 4 s?
   - **Variety:** does each scene look different from the last? Any banned default from `styles/design.md`?
   - **Style accuracy:** does it match the STYLE.md? Reflective: Fraunces + Manrope, the gold family, every photo graded and moving. Tech-news: Barlow faces, `#c8102e`, dark background. Motion: Sora + Inter + JetBrains Mono, ink, violet and cyan, kit components. No stray colours.
   - **Sync:** does what is on screen match the bracketed spoken word in each caption?
3. Fix the **3 worst** problems, run `reelsmith lint videos/<name>` again, regenerate the sheet.
4. Repeat until every score is **8 or higher**. Cap at 5 rounds, then report the remaining scores to the user.

Report the final scores at the preview gate (Rule 6).

## Rule 6: human preview gate before the final render

The user signs off before the final render. Never start `reelsmith render` without it, not even when the user said "make the video" earlier.

1. `reelsmith sheet videos/<name> --stills` writes the contact sheet plus full-size `frames/stills/*.jpg` (hook frames and every scene, subtitles included).
2. `reelsmith draft videos/<name>` writes `videos/<name>/draft.mp4` in about 30 s: 0.75x size, 15 fps, with the voice. It picks `voiceover-mix.mp3` when it exists, else `voiceover.mp3`. This is what the user actually watches.
3. Send the user `draft.mp4` (the file, not just its name), the contact sheet and a selection of stills (hook frames and at least one per scene), with your Rule 5 scores. Ask for permission to render.
4. On feedback: change `index.html`, run `reelsmith lint`, check the fix with a range render (`reelsmith clip videos/<name> --from=12 --to=24` writes `clip-12s-24s.mp4`), then redo steps 1 to 3 and ask again.
5. Only on an explicit approval: `reelsmith approve videos/<name> --by="<who>"`, then `reelsmith render videos/<name>` writes `videos/<name>/output.mp4`.

Draft and clip renders never need an approval. `reelsmith render` exits with code 3 when there is no approval or the video changed since it was given (a fingerprint of index.html, scenes.json, the runtime, the style kit and the images, including `images/**`). How the renderer works (shards, JPEG frames piped into ffmpeg, segment cache for crash resume) is in `docs/fast-render.md`.

Optional: `reelsmith preview videos/<name>` plays the page live in a browser with the voice. `--lan` prints a `/qr` link so the creator can watch it on a phone on the same Wi-Fi.

## Permitted exceptions (raw delays of 0.6 s or less)

Visual intro flourishes that fire at scene start, not tied to a word:

- A scene-opening badge, tag, divider or section label
- The very first headline of a scene
- A silent CTA card (tech-news)
- Stagger offsets between adjacent elements after a cue (`cue + 0.15`)

Any raw delay **over 0.6 s is a bug** unless the same line has a `useWordCue` call.

## No early exits

Text overlays must not fade out before the scene ends. Use enter-only helpers (`slideUp` and the kit's entries) for content, never `fade()`, which bakes in an exit. `fade()` is fine for full-scene backgrounds and a CTA card.

## Phrase matching rules (how `useWordCue` resolves)

- Case-insensitive and punctuation-stripped: `"$103B"` matches Whisper's `"103"`.
- Multi-word phrases match consecutive tokens: `"sound of one"` matches `["sound", "of", "one."]`.
- Digits must match digits: `"21 million"` matches `["21", "million"]`. `"twenty-one million"` does not, unless Whisper wrote it that way. Check `scenes.json` first.
- If the full phrase is missing, the first word of the phrase is tried, with a console warning.
- If nothing matches: a warning and `Infinity`, so the overlay stays hidden. `reelsmith lint` reports it. Pick a phrase that is in the words array.
- If you pass a custom `overlap` to `useSceneWindow(N, { overlap })`, pass the same one to `useWordCue(N, phrase, { overlap })`.

## Workflow

0. Pick the style (Rule 0) and read its `STYLE.md` and `styles/design.md`. Open the reference `index.html`.
1. Read `videos/<name>/script.md`, especially `## Scene Hints`, and note the primitive for each scene.
2. Open `videos/<name>/scenes.json` and read each scene's `words` array.
3. Build each scene per the style. Vary the entry and layout from the previous scene.
4. For every scene, list the narration phrases your overlays visualize.
5. For each overlay, write `const cue<Name> = useWordCue(sceneIdx, "phrase")` at the top of the scene's render function.
6. Bind every reveal to its cue.
7. Add `<SubtitleRail ... />` as the last child of every narrated scene's root div, with the style's props.
8. `reelsmith lint videos/<name>` must exit 0.
9. Run the self-critique loop (Rule 5) until every score is 8 or higher.
10. Preview gate (Rule 6): `sheet --stills` and `draft`, send them, wait for "approved", then `approve` and `render`.

## Checklist before handing off index.html

- [ ] Style loaded (Rule 0) and followed: palette, fonts and subtitle props from the STYLE.md.
- [ ] Reflective: every photo in `images/` has a row in `images/CREDITS.md`, moves (Ken Burns) and sits under a grade. Cuts land on word cues every 2.5 to 3.5 s. No two consecutive scenes share a transition. No `cta-end` scene.
- [ ] Tech-news and motion: no stock photo as the primary visual (Rule 3). Every scene is a designed composition.
- [ ] Motion: `styles/motion/kit.jsx` is loaded after the runtime, every scene root is `SceneRoot`, and the kit components are used, not re-implemented.
- [ ] Reflective: `styles/reflective/kit.jsx` is loaded after the runtime (or its body pasted in), not rewritten.
- [ ] No raw delay over 0.6 s outside the exceptions above.
- [ ] Every content overlay pairs with a `useWordCue(...)`.
- [ ] No `fade(...)` on text overlays.
- [ ] `<SubtitleRail sceneIdx={N} ... />` in every narrated scene.
- [ ] `reelsmith lint videos/<name>` exits 0 (no errors, no missing-subtitle warnings).
- [ ] No `Math.random`, timers, rAF, wall clock or CSS transitions/animations (Rule 4).
- [ ] No banned defaults from `styles/design.md`. Something new on screen every 2 to 4 s.
- [ ] Safe area: the contact sheet reports no edge-to-edge text.
- [ ] Contact sheet scored 8+ on all seven criteria (Rule 5), scores reported to the user.
- [ ] The user approved `draft.mp4` and the stills, and `reelsmith approve` was run (Rule 6). `reelsmith render` refuses otherwise.
