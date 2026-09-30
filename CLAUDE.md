# Tech Shorts v2 — Claude Code Context

Successor to `../video-gen` (v1). Same channel. The voice is either the creator's own recording (the path described here) or a TTS voice (the TTS branch below, the default from devotion-tts on). A local teleprompter web app (`app/`, Node + browser, no Electron) records one long take, Whisper transcribes it, the pipeline aligns the transcript to `script.md`, flags anything that would make the video look bad, lets the creator re-record flagged sentences, then cuts fillers/silence and emits the same `scenes.json` + `voiceover.mp3` contract v1's renderer already consumes. HTML animation, subtitles, and rendering are v1's code, reused unchanged. See `BIDS.MD` for pillar definitions and topic strategy, `docs/spec.md` for the full system contract.

**Foundation for new videos (creator's choice, 2026-09-29):** the `reflective` look (`config/styles/reflective.md`: warm near-black and gold, Fraunces + Manrope, graded Ken Burns photos, clean 26 px subtitles) and a TTS voice at 1.15× under a 6 dB music bed (`config/audio.md`). The reference video is **`videos/devotion-tts/`**. The red Barlow tech-news look (`config/styles/tech-news.md`) and the recorded-take path are still there, but only when asked.

## Skills

| Trigger | Skill |
|---|---|
| "pick a topic", "what should I make next" | Read `BIDS.MD` and follow its workflow exactly (no skill file — static doc + live research) |
| "score this script", "what gets views", "is this topic worth it" | `.claude/skills/market-research/SKILL.md` — optional, only when asked |
| "research this", "make a video about X", any topic/URL before scripting | `.claude/skills/research/SKILL.md` — produces `research.md` with `Status: DRAFT` and a `## Angle options` handoff (2–3 angles, one villain each; no pre-written hook, no compound thesis). Runs before script-writing; no script without an approved `research.md` (only the user approves — they say "approved", then the agent flips the line to `Status: APPROVED`) |
| "write me a script", "script this" | `.claude/skills/script-writing/SKILL.md` — simple linear explainer (Hook → What it is → How it works → Why it matters → What to do → Close) in plain, human words for a general viewer. Writes `script.md` (incl. a short `## Scene Hints`). Uses `research.md` if present |
| "prep this for the teleprompter", "get this ready to record" | `.claude/skills/teleprompter-prep/SKILL.md` — final delivery pass on an approved `script.md`: cues, breath marks, line splits, pace; writes `## Delivery notes` into `script.md` |
| "review my take", "how did the take go", "what should I re-record" | `.claude/skills/take-review/SKILL.md` — reads `take.json`, explains flags, runs the re-record loop, then finalize |
| Writing/editing `videos/<name>/index.html` | `.claude/skills/html-animation/SKILL.md` — step 0 loads `config/styles/<style>.md` (default `reflective`, `tech-news` only when asked or `style: tech-news` in script.md), then word-cue binding, `SubtitleRail`, sync linters, deterministic motion, contact-sheet self-critique loop (every score 8+ before render) |
| "write the publish notes", "get this ready to post" | `.claude/skills/publish/SKILL.md` — writes `publish.md`. YouTube upload: `scripts/upload-youtube.js` (only when asked; setup + limits in `docs/youtube.md`) |

## Pipeline

```
topic (BIDS.MD)
   │
   ▼
research skill ──────────────► research.md [approve]
                                    │
                                    ▼
script-writing skill ───────► script.md [approve]
                                    │
                                    ▼
teleprompter-prep skill ────► script.md (delivery pass) [approve]
                                    │
                                    ├─── OR TTS (no recording): ASK the creator which voice, then
                                    │    pipeline/cli.js tts --voice=<name> ───► scenes.json + voiceover.mp3
                                    │    → mix-music.js ───► voiceover-mix.mp3 ──► jump to html-animation
                                    ▼
RECORD in app (human) ───────► takes/take-NN.webm/.wav/.hq.wav
   http://localhost:4310            │
   (npm run app)                    ▼
                              pipeline analyze ───► take.json
                                    │
                                    ▼
                        take-review skill (loop)
                   re-record flagged sentences in app
                   (Review view, press R) ⟲ until clear
                                    │
                                    ▼
                              finalize (cut) ───► scenes.json + voiceover.mp3
                                    │
                                    ▼
                        html-animation skill ───► index.html
              (useSceneWindow, useWordCue, SubtitleRail;
               check-sync.js + validate-sync.js must exit 0)
                                    │
                                    ▼
                              contact-sheet.js ⟲ score 1–10, fix 3 worst,
                              (agent looks at   repeat until all 8+
                               its own frames)
                                    │
                                    ▼
                    contact-sheet.js --stills ───► contact sheet + full-size stills
                    render.js --draft ───► draft.mp4 (~30 s, low-res, with voice)
                   SHOW BOTH TO THE USER [approve] ⟲ apply feedback, re-shoot
                   (one scene changed? render.js --from=S --to=S → clip-Ss-Ss.mp4)
                   (optional: preview.js [--lan] — live playback with voice; phone via /qr)
                                    │
                                    ▼
                    approve-preview.js ───► preview-approved.json
                                    │
                                    ▼
                              renderer/render.js ───► output.mp4 (~1–2 min)
                              (refuses without a current approval)
                                    │
                                    ▼
                              publish skill ───► publish.md
```

**TTS branch** (instead of RECORD → analyze → take-review → cut): `node pipeline/cli.js tts videos/<name> --voice=<name>` turns the approved `script.md` into `voiceover/sN.mp3`, `voiceover.mp3` and `scenes.json` (same contract as `cut`). It makes one OpenRouter `/api/v1/audio/speech` call per sentence, caches clips by hash(model + voice + text) in `voiceover/tts/`, trims silence, joins the sentences with gaps and scene tails, sets the tempo to **1.15×** (ffmpeg atempo on cached clips, so a speed change never re-calls the API) and takes word timings from Whisper on the final voice (it falls back to an estimate if Whisper is missing and says so). Then run `node scripts/mix-music.js videos/<name> --track=music/clean-soul.mp3` and render with `--audio=videos/<name>/voiceover-mix.mp3`. There's no default voice. **Ask the creator which voice before generating**, and don't pick one yourself. Model, speed and gaps are in `config/tts.json`. The voice used is recorded in `voiceover/tts/meta.json`, so re-runs reuse it. A 401/403 means the `OPENROUTER_API_KEY` in `.env` is bad.

**Preview gate (before every final render):** never start a full `renderer/render.js` on your own judgment. First run `node scripts/contact-sheet.js videos/<name> --stills` and `node renderer/render.js videos/<name>/index.html --draft --audio=videos/<name>/voiceover-mix.mp3` (or `voiceover.mp3` when there is no mix), then send the user the contact sheet, a handful of full-size stills (`frames/stills/*.jpg` — hook frames plus at least one per scene, with subtitles visible) and `draft.mp4` (send the file so they can watch it), and ask for permission to render. Apply any feedback — re-render only the changed seconds with `--from=S --to=S` to check a fix — re-shoot, and ask again. Only after an explicit "approved" run `node scripts/approve-preview.js videos/<name> --by="<who>"`, then the final render. Draft and range renders skip the gate; the final render checks a fingerprint of index.html, scenes.json, the runtime and the images (video root + `images/**`), so any edit after approval needs a fresh preview and approval. The renderer is parallel (one headless browser per shard, auto-sized to the machine's cores and RAM) and pipes JPEG frames straight into ffmpeg, so a 98 s video takes about 1.5 min final and 30 s draft; design and numbers in `docs/fast-render.md`.

Each `[approve]` is a human gate. Do not skip it — proceed to the next skill only after the user has signed off on the previous artifact. For `research.md` the gate is literal: the research skill writes `Status: DRAFT`, and the agent flips it to `Status: APPROVED` only after the user says "approved" — never on its own judgment.

## Setup

```bash
# 1. Runtime: Node 22+, ffmpeg, Python 3.11 (Whisper)
brew install node ffmpeg python@3.11     # macOS; on Ubuntu: apt install ffmpeg python3.11
python3.11 -m pip install openai-whisper

# 2. Node deps + headless browser (renderer, contact sheet)
npm install
npx playwright install chromium          # Linux: sudo npx playwright install-deps chromium

# 3. Keys — OPENROUTER_API_KEY: required for TTS (pipeline/cli.js tts), optional for Jev AI filler classification
cp .env.example .env
```

**Effort** (Claude Code `/model`): `xhigh` when writing a new `index.html` or script, `medium` for small fixes and re-renders, `max` for a flagship video where the first 3 seconds have to carry it.

## Commands

```bash
npm run app                                                     # start the teleprompter/recording app → http://localhost:4310
node pipeline/cli.js analyze  videos/<name> [--take=takes/take-01] [--no-jev]
node pipeline/cli.js rerecord videos/<name> --sentence=s2.1 --clip=takes/rr-s2.1-1
node pipeline/cli.js cut      videos/<name>                     # = finalize: writes scenes.json + voiceover.mp3
node pipeline/cli.js status   videos/<name>                     # prints take.json summary table
node pipeline/cli.js tts      videos/<name> --voice=<name> [--model=…] [--speed=1.15] [--force]   # TTS instead of a take → scenes.json + voiceover.mp3 (ask the creator for the voice first)
node scripts/preview.js videos/<name> [--lan]                   # live browser playback WITH voice (voiceover-mix.mp3, else voiceover.mp3), no render; --lan = open on the phone over Wi-Fi via the printed /qr link
node scripts/check-sync.js videos/<name>/index.html             # must exit 0
node scripts/validate-sync.js videos/<name>/index.html          # must exit 0
node scripts/contact-sheet.js videos/<name>                     # frame grid → videos/<name>/frames/contact-sheet.png; LOOK at it before render
node scripts/contact-sheet.js videos/<name> --stills            # + full-size frames/stills/*.jpg to show the user at the preview gate
node scripts/approve-preview.js videos/<name> --by="<who>"      # ONLY after the user approves the stills; render.js requires it
node renderer/render.js videos/<name>/index.html --draft --audio=videos/<name>/voiceover-mix.mp3            # ~30 s low-res preview → videos/<name>/draft.mp4 (no gate); send it to the user
node renderer/render.js videos/<name>/index.html --from=12 --to=24 --audio=videos/<name>/voiceover-mix.mp3   # only that range → clip-12s-24s.mp4 (no gate); check one fixed scene
node renderer/render.js videos/<name>/index.html videos/<name>/output.mp4 --fps=30 --audio=videos/<name>/voiceover-mix.mp3   # final (~1.5 min for 98 s); [--shards=N] [--encoder=auto|videotoolbox|x264] [--gpu] [--keep-segments]
node scripts/mix-music.js videos/<name> --track=music/<file>.mp3  # music bed 6 dB under voice → voiceover-mix.mp3 (render with --audio=that); pick the track by mood (config/music.md): calm = clean-soul, energetic tech = voxel-revolution; --under=4 only when the creator asks
```

**Audio defaults:** `config/audio.md` has them all in one place (TTS 1.15×, voice −16 LUFS, bed 6 dB under). **Music:** any video with background music uses `config/music.md`. The bed sits **6 dB under the voice** (the creator's pick, LUFS-relative, gentle ducking) via `scripts/mix-music.js`. Don't ask the creator for a level, and never use a fixed dB offset.

If a bare `node ...` fails to run in a non-interactive shell, use the full path: `~/.nvm/versions/node/v22.17.0/bin/node`.

## `script.md` format (docs/spec.md §3)

```markdown
---
title: Claude prompt caching: the timestamp trap
topic: ai-ml        # aws | ai-ml | swe | devtools
date: 2026-09-27
wpm: 170            # optional, teleprompter auto-scroll speed
style: reflective   # optional: reflective (default) | tech-news
tts_voice: <name>   # TTS videos only: the voice the creator picked (no default)
---

## Script

### Scene 1
Prompt caching may make your Claude bill go up, not down.
It takes one line at the top of your prompt.

### Scene 2
Your agent resends that exact prompt on every turn.
> say: "one hundred", not "a hundred"
At 100 input tokens per output token, that prompt is most of your bill.
```

`### Scene N` blocks, one sentence per line (the re-record unit, id `s<scene>.<line>`). Blank lines ignored. Lines starting with `>` are teleprompter-only cues (pronunciation, `[pause]`, `[breath]`) — never spoken, never aligned. The parser attaches each `>` cue to the sentence BELOW it, so put a cue on the line above the sentence it describes. A `>` line right after the frontmatter (outside any scene) is a file-level note the parser ignores (e.g. `> NOTE: dogfood run, research not yet approved`). Sections after `## Script` — `## Scene Hints` (required, written by script-writing), `## Score`, `## Delivery notes` — are ignored by the parser. Never put a `### Scene N` heading in them: the parser treats any `Scene N` heading as spoken. Word counts anywhere mean spoken words (digits/acronyms as read aloud).

Frontmatter keys: `title`, `topic`, `date`, optional `wpm`, and:
- `style:` picks the look. Omit it for `reflective` (the default, `config/styles/reflective.md`). Set `style: tech-news` for the red Barlow news look (`config/styles/tech-news.md`), only when the creator asks for it.
- `tts_voice:` is the TTS voice for `pipeline/cli.js tts`. There's no default: ask the creator, then write it here or pass `--voice=`. Optional `tts_model:` / `tts_speed:` override `config/tts.json` for this video only.

## HTML rules

- React + Babel in-browser, no build step
- Runtime: `../../runtime/animations.jsx`
- Image paths: relative to the video folder. Photo-led (reflective) videos keep photos in `images/` with `images/CREDITS.md` (see `videos/devotion-tts/images/`). Older videos use bare filenames in the folder root. Renderer, contact sheet and preview serve both, and the approval fingerprint hashes both
- `<Stage scenesSrc="scenes.json">` — no `duration` prop, no `TOTAL`. Use `useSceneWindow(N)` per scene.
- Ending: **reflective essays end on the narrated closing card, with no `cta-end`** (the creator's choice on devotion-tts; the music tail holds the last frame). **Tech-news** videos end with a `cta-end` scene: a silent on-screen card, never narrated (the script's last spoken beat is the takeaway, not a "follow/subscribe" line)
- `persistKey` must be unique per video
- **Every narrated scene MUST include `<SubtitleRail sceneIdx={N} />` as the last child of its root div.** Reflective: `<SubtitleRail sceneIdx={N} bottom={170} fontSize={26} variant="clean" accentColor={GOLD2} />`. CTA scene is exempt. This is non-negotiable — it gives every video karaoke-style word-synced subtitles automatically.
- Use `<WordReveal sceneIdx={N} />` for additional word-synced narration text (optional, supplementary to SubtitleRail)
- SubtitleRail spacing (row-gap, line-height, letter-spacing) is managed by the runtime — no manual overrides needed
- **Every frame is a pure function of time.** No `Math.random` (use `seededRandom`), timers, rAF, wall clock, or CSS transitions/animations — compute from `localTime` (`spring`, `track`, `interpolate`). `check-sync.js` enforces it
- **Safe area:** text never runs edge to edge. Keep every line ≥48 px from both sides and ≤520 px wide. `contact-sheet.js` flags violations, and the list must be empty before the preview gate (`config/styles/reflective.md` → "Safe area")
- **No banned defaults** (`config/design.md`): no everything-fades-in, no empty middle band, something new every 2–4s. Checked by eye on the contact sheet, not by a linter

## Technical reference

| | |
|---|---|
| Canvas | 720×1280, 9:16 |
| Style | `reflective` (default, `config/styles/reflective.md`, reference `videos/devotion-tts/`) · `tech-news` only when asked |
| Fonts | Reflective: **Fraunces** 500/700 + italic (display), **Manrope** 600–800 (labels, subtitles). Tech-news: Barlow Condensed 800 + Barlow 400. Google Fonts |
| Accent | Reflective: `GOLD` `#e0a458` / `GOLD2` `#f2c46d` on `#0b0906`, text `#f5efe6`. Tech-news: `#c8102e` |
| Duration | derived from `voiceover.mp3` — never hardcode. Target 45–65s (config/market.md) |
| Voice | The creator's own recording (`app/` → `cut`) **or** TTS (`pipeline/cli.js tts`, OpenRouter `google/gemini-3.8-flash-tts`, voice picked by the creator per video, 1.15×). See `config/audio.md` |
| Transcription | Whisper turbo via `python3.11` (never bare `python3`) |
| Cheap decisions | Jev AI (OpenRouter, `typesafe/jev-1.13`) — filler classification + borderline sentence review (docs/spec.md §8). Optional; falls back to deterministic rules if unavailable |
| Renderer | Playwright frame capture → FFmpeg H.264 |

## Critical gotchas

See `docs/learnings.md` for full details.

1. **Node binary path** — bare `node`/`npm` can be broken in non-interactive shells (nvm profile issue). Use `process.execPath` when spawning a child Node process from a script; use `~/.nvm/versions/node/v22.17.0/bin/node` from the shell.
2. **`python3.11`** — python3/pip3 point to a broken build on this machine. Always invoke `python3.11` explicitly.
3. **HTTP server from project root** — `../../runtime/animations.jsx` must resolve; serve from repo root, not the video dir.
4. **`waitUntil: 'load'`** — not `networkidle` (CDN/font loading keeps the network busy forever).
5. **Two rAF cycles** after `setTime(t)` before screenshotting a frame — one processes the React state update, the second lets the browser paint.
6. **Render mode kills CSS transitions/animations** (`?render=1`, used by the renderer and contact sheet). They run on the wall clock, so a frame would depend on screenshot speed. Anything that only moves via CSS will be static in the MP4.
