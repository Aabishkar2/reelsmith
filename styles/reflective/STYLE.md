---
name: reflective
description: Warm, photo-led and calm. Near-black and gold, Fraunces + Manrope, graded Ken Burns photos, clean 26 px subtitles. The default for essays.
---

# Style: reflective (DEFAULT)

Warm, photo-led and calm. It suits personal essays and "think it through" videos. The creator approved it on the `devotion-tts` video (2026-09-29) and wants it as the foundation for future essay videos. **Use it unless the creator asks for another pack, or `script.md` frontmatter says `style: motion` / `style: tech-news`** (see `styles/motion/STYLE.md`, `styles/tech-news/STYLE.md`). The shared base rules (canvas, CDN scripts, base HTML, banned defaults, animation principles) are in `styles/design.md`.

**The kit:** `styles/reflective/kit.jsx` holds every constant and helper named below (`BG`, `GOLD`, `GOLD2`, `CREAM`, `SERIF`, `COND`, `BODY`, `TS`, `GLOW_TS`, `img`, `e3`, `eio`, `after`, `slideUp`, `rise`, `pop`, `reveal`, `blurIn`, `drop`, `Shot`, `trStyle`, `PhotoSeq`, `Grade`, `Glow`, `Enter`, `Label`, `Chip`, `StrikeLine`). A video uses it one of two ways:

1. **Include it** right after the runtime (preferred, nothing to copy):
   ```html
   <script type="text/babel" src="../../runtime/animations.jsx"></script>
   <script type="text/babel" src="../../styles/reflective/kit.jsx"></script>
   ```
   Everything is on `window`, so scenes use `PhotoSeq`, `Grade`, `rise(lt, cue)` … directly.
2. **Paste it**: copy the body of `kit.jsx` (between the IIFE header and the `Object.assign(window, …)` export) into the top of the video's own `<script type="text/babel">` when a video needs to tweak a helper. Don't re-invent the helpers either way.

Kit helpers take the scene clock explicitly: `<Sprite {...win}>{({ localTime: lt, duration }) => …}</Sprite>`, then `rise(lt, cue)`, `<Glow lt={lt} …/>`, `<Enter type="wipe" lt={lt}>`. Photos load from the video's folder: `img('slug')` → `images/slug.jpg`.

**Reference implementation:** `styles/reflective/reference/index.html` (the approved `devotion-tts` video; the scenes named below — `Scene1` … `Scene9` — are in it). Its photos are not shipped (see `reference/README.md`), so read it as code, not as a runnable page.

> The kit is loaded by the page, so it is part of what decides a frame. If you change `kit.jsx` after a preview approval, re-run the preview and approval (the renderer's fingerprint must cover the kit; see the note in `styles/motion/STYLE.md`).

## Palette

| Token | Value | Use |
|---|---|---|
| `BG` | `#0b0906` | Warm near-black. Stage `background`, `html, body` background, and the base of every grade (`rgba(11,9,6,…)`) |
| `GOLD` | `#e0a458` | Structure: label text + rule, seams, dividers, card/chip borders, list numerals |
| `GOLD2` | `#f2c46d` | Emphasis: the key word, strike lines, active list row, path, "vs" medallion, **subtitle active word** |
| `CREAM` | `#f5efe6` | Headlines and body text |
| Cream, muted | `rgba(245,239,230,0.82)` inactive list rows · `0.85` older ticker lines · `0.6` struck word · `0.55` idle tile border | De-emphasis. Never pure grey |
| Light core | `#fff4d6`, `rgba(255,226,160,…)`, `rgba(255,240,205,…)` | Glow orb, path head, light-leak flash |
| Card fill | `rgba(11,9,6,0.62)` chips · `0.66` tiles · `0.93` verdict band | Text containers over photos |
| `TS` | `0 2px 22px rgba(0,0,0,0.65), 0 1px 3px rgba(0,0,0,0.5)` | Default text shadow on every overlay |
| `GLOW_TS` | `0 0 28px rgba(242,196,109,0.55), 0 2px 16px rgba(0,0,0,0.6)` | Gold words that should shine |

That's one warm family. No red, no blue, no pure white text.

## Fonts

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,500;1,9..144,600;1,9..144,700&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
```

| Constant | Family | Used for |
|---|---|---|
| `SERIF` = `'Fraunces', Georgia, serif` | **Fraunces** 500 / 700, roman and *italic* (optical size axis 9–144) | All display text. Italic 700 in `GOLD2` is the "this word matters" treatment. Italic 500 is for soft secondary lines |
| `COND` = `BODY` = `'Manrope', sans-serif` | **Manrope** 600–800 | Uppercase tracked labels, tiles, the "YOU STILL HAVE TO" header, subtitles (runtime default for `variant="clean"`) |

(`COND` is a leftover name from the Barlow Condensed draft. It points at Manrope now. Keep the name so copied scenes work.)

## Type scale (720×1280, from devotion-tts)

| Role | Spec | Example |
|---|---|---|
| Lone word | Fraunces italic 700, 190, `GOLD2` + `GLOW_TS` | "But" (Scene 4) |
| Hero word | Fraunces italic 700, 108–112, `GOLD2` + `GLOW_TS` | "guarantee", "How you walk." |
| Headline | Fraunces 700, 74–84, `CREAM` | "Does devotion / to God", "Devotion" |
| Emphasis line | Fraunces italic 700, 64–80, `GOLD2` | gifts (72), ticker lines (68), closing words (80) |
| Secondary line | Fraunces 500 or italic 500/700, 46–58 | "Not where you end up.", "while you do it." |
| Body / list | Fraunces 500, 40–46 (active row 700, 44) | belief lines (42), factor list |
| Label | Manrope 700, 22–24, uppercase, `letterSpacing: 0.24em`, `GOLD`, 44 px rule that grows in (`Label`) | "A QUESTION WORTH ASKING" |
| Chip | Fraunces italic 500, 42 (30 small), pill, 2 px `GOLD` border (`Chip`) | "success", "peace" |
| Tile | Manrope 800, 42, uppercase, `0.12em` | DISCIPLINE / AWARENESS |
| Numeral | Fraunces italic 700, 26, `GOLD`, `01`–`09` | factor list |
| Subtitle | Manrope 600, 26 (see below) | |

Text column: `left: 56` (52 for italic lines that need a little room for the swash). Top label at 128–150, first headline at ~178. Keep content above y ≈ 1000, because subtitles sit at `bottom={170}`. Add `padding: '0 6px 8px'` on italic text that uses `reveal` (clip-path) so descenders and swashes aren't clipped.

## Subtitles

```jsx
<SubtitleRail sceneIdx={N} bottom={170} fontSize={26} variant="clean" accentColor={GOLD2} />
```

The last child of every narrated scene. `variant="clean"` (in `runtime/animations.jsx`) means:
- sentence case, words exactly as spoken (no `textTransform: uppercase`)
- no pill or background, only a soft shadow (`0 2px 10px rgba(0,0,0,0.85), 0 0 2px rgba(0,0,0,0.9)`)
- wider word gap (`columnGap` = 0.42 × fontSize, vs 0.22 for caps), `maxWidth: 620`, line-height 1.3
- the spoken word turns `accentColor` (`GOLD2`) at the **same size** (no scale pop). Past words fade to cream 0.45, upcoming words sit at cream 0.82

**Why:** the old default (32 px Barlow Condensed CAPS on a dark pill, `bottom` 300) looked big and sat mid-screen, and it crowded the photo and headline. The clean 26 px line at `bottom={170}` is what the creator approved on devotion-tts.

## Photos

Photos ARE the backdrop in this style. This is the opposite of tech-news Rule 3.

- **Source:** Unsplash (preferred) or Wikimedia Commons, via `tools/search-images.js` / `tools/download-image.js`. Save to `videos/<name>/images/<slug>.jpg` at ~1080 px wide and reference them with `img('slug')` (→ `images/slug.jpg`).
- **Credits:** `videos/<name>/images/CREDITS.md`, one row per file (file, photographer + handle, source URL, description, license), plus a suggested description credit line. Format: `| file | photographer (@handle) | source URL | description | license |`. Wikimedia files need their exact license (CC BY / CC BY-SA …) and author.
- **Ken Burns on every shot:** `Shot` zooms `z0 → z1` (e.g. 1.04 → 1.14, or the reverse) and drifts `x0/x1`, `y0/y1` by ±1–2 % with `easeInOutSine` over the shot's lifetime. Alternate zoom in and out between shots.
- **Cut every 2.5–3.5 s, on word cues:** `PhotoSeq` takes `shots: [{ src, at: cue, tr, ...kenBurns }]`. Each shot starts on a `useWordCue` time, and the in-scene transition (`tr`) comes from `trStyle`: `dissolve`, `wipe`, `wipeUp`, `iris`, `zoom`, `slide`, `blur` (0.5 s). Vary it from shot to shot.
- **Always graded:** a `Grade` over every photo. `kind="topbottom"` (text at top), `"left"` (a list down the left), `"center"` (centered stack), optional `dim` to push the photo back (0.15–0.28, and up to ~0.78 for the closing fade to dark). Grade also adds the warm gold screen tint. Raw photos never touch text.
- **Mood by filter:** e.g. `filter="grayscale(0.55) …"` for the struggle half of a split screen, animated back to colour when the mood lifts.

## Safe area: text never runs edge to edge

The creator's feedback after posting devotion-tts: text that fills the full width looks cramped and cheap on a phone. From the next video on:

| Rule | Value |
|---|---|
| Side margins | Keep every text line **at least 48 px** from each edge. Lay out headlines at `left: 56` and cap them with `right: 104` so they clear the Shorts action buttons on the right |
| Line length | **No line wider than 520 px** (~72% of the 720 px frame). Centered lines sit well inside it, ~440–480 px |
| Big display words | Size to the line, not the frame. If a short phrase ("How you walk.", "You still have to") only fits by filling the width, drop the size (e.g. 96 → 72 px) or break it onto two lines. Don't stretch it |
| Wrapping | Set `textWrap: 'balance'` on multi-line headlines, or put in explicit `<br/>`, so you never get one long line over a short orphan |
| Letter-spaced labels | Wide tracking (`0.24em`) adds width fast. Keep labels short (≤ 28 characters) |
| Exempt | Subtitles (runtime-managed). Decorative bleeds (e.g. the giant "?" behind the hook) must carry `data-bleed` so it's clear they're deliberate |

`reelsmith sheet <video>` (the contact sheet) checks this on every captured frame. It prints each offending line with its margins and width, and marks the frame "⚠ edge-to-edge" on the sheet. **Get it to zero before the preview gate.** On devotion-tts it flags 8 lines: "a different purpose.", "confidence to risk", "You still have to", "learn how it works", "face your problems", "Not where you end up.", "How you walk." and "→ shape your success". Those are what to avoid; don't copy those sizes.

## Scene transitions (`Enter`)

Each runs over the 0.5 s scene overlap, on top of the outgoing scene. Never use the same one twice in a row. Scene 1 has none.

| Name | Code | Used in the reference |
|---|---|---|
| Gold-edge wipe | `<Enter type="wipe">`: left-to-right clip with a blurred gold light edge | Scene 2 |
| Push | `<Enter type="push">`: the new scene slides in from the right with a shadow | Scene 3 |
| Light-leak flash | `<Enter type="glow">`: a warm radial flash peaks mid-transition while the scene fades up | Scenes 4, 9 |
| Match-cut dissolve | `<Enter type="dissolve">` + an element held at the exact position the last scene left it (`MEANINGLESS_TOP`) | Scene 5 |
| Zoom-through | `<Enter type="zoom">`: scale 1.4 → 1 with fade | Scene 6 |
| Iris with gold ring | `<Enter type="iris">`: circle opens from the centre with a glowing gold ring | Scene 7 |
| Curtain wipe | `<Enter type="wipeUp">`: bottom-to-top clip with a gold light edge | Scene 8 |

## Motion helpers (all pure functions of `localTime`)

`e3`, `eio`, `after(lt, cue, d)` for easing. Entries, all enter-only: `rise` (slide up), `pop` (spring scale), `reveal` (left-to-right clip-path write-on), `blurIn` (focus pull), `drop` (spring down from above), `slideUp`. Motifs: `StrikeLine` (gold strike drawn through a word), `Glow` (breathing light orb, the "inner peace" motif), `Chip`, `Label`. Mix entry types inside a scene, and bind every one to a `useWordCue`.

## Scene layouts that worked

| Layout | When to use | Reference |
|---|---|---|
| Question hook + strike | Open on the question the video answers. Serif question, key word lands big in gold italic, chips for the two stakes, then a gold `StrikeLine` through the word you're about to challenge. A giant faint "?" drifts behind | `Scene1` |
| Split screen | Two groups or outcomes that contradict an assumption. Top half desaturated, bottom lights up warm on its cue, gold seam with a "vs" medallion, then a verdict band opens over the seam | `Scene2` |
| Numbered factor list, photo per item | 5–9 items said in one run. Rows `01…` build down the left on their words, a stretchy gold indicator (`track` lead/trail) springs to the active row, the photo re-cuts per item, then everything turns gold with a one-line summary | `Scene3` |
| Lone-word turn | The pivot ("But…"). One huge italic word over a single slow photo (candle), then 1–2 words under it. Nothing else | `Scene4` |
| Glow benefit stack | Listing what something gives you. A glow orb grows on the first benefit, each benefit lands big in the light and then shrinks up into a stack as the next arrives. Opens with a match-cut from the previous scene | `Scene5` |
| Tile stack on a beam | "X isn't a replacement for A, B, C, it's what holds them up." Tiles `drop` in on their words, a gold beam grows under them on the turn, then lifts the stack, and the tiles glow | `Scene6` |
| Ticker list | A repeated frame ("You still have to…"). Fixed header, each new line enters centre-screen and pushes the older ones up, smaller and cream | `Scene7` |
| Self-drawing path | Journey or direction metaphors. A gold bezier path draws itself up the frame toward a destination pin as the line is spoken, faint dotted guide first | `Scene8` (`PATH_PTS`, `bez`) |
| Closing card | The takeaway. A ledger ("What you do + how you think → shape your success"), a gold rule, the payoff words on their cues, then the photo sinks to dark and the glow returns under the final line. The music tail holds it | `Scene9` |

## Ending: no `cta-end`

Reflective essays **end on the closing card**. There's no silent `cta-end` "follow" card; the creator chose this on devotion-tts. The ~2.5 s music tail from `reelsmith mix` holds the last frame.

## Audio

TTS voice at 1.15×, the music bed (`music/clean-soul.mp3`) 6 dB under the voice. See `config/audio.md` and `config/music.md`.

## Rejected (don't bring back)

- **Playfair Display** for display text: it reads as the AI/Canva default. The first render used it (an early devotion-tts render) and the creator swapped it for Fraunces.
- **Barlow Condensed** (and Barlow) for reflective content: dropped on devotion-tts when the creator picked option B, Fraunces + Manrope. Barlow stays in tech-news.
- **32 px CAPS subtitles on a pill** (the old `SubtitleRail` default): too big, mid-screen and crowded. Use `variant="clean"` at 26 px, `bottom={170}`.
