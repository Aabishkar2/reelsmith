# Architecture

How the pieces fit, what each file holds, and the data contracts between steps. The binding contract for the framework is [framework-spec.md](framework-spec.md); the take pipeline's internals are in [spec.md](spec.md); the renderer's design is in [fast-render.md](fast-render.md).

## Directory map

```
reelsmith/
  bin/reelsmith.js          CLI entry (package.json "bin"): calls core/cli.js
  core/
    cli.js                  argument parsing, every command, help texts, exit codes
    config.js               loads reelsmith.config.json, .env and the built-in defaults
    plugins.js              plugin registry: discover, validate, list, get(kind, name)
    project.js              project root discovery, resolves videos/<name>
    env.js                  finds node, ffmpeg/ffprobe and the Python with Whisper
    serve.js                the local HTTP server tools load pages from (project root)
    publishNotes.js         parses publish.md, reads and writes publish/<target>.json
  pipeline/
    tts.js                  TTS sentence mode
    performance.js          TTS performance mode
    script.js               parses script.md
    whisper.js              Whisper words (whole or VAD-chunked), cached
    align.js                aligns script tokens to transcript words
    analyze.js              recorded take → take.json (flags, attempts, cuts)
    attempts.js             scores repeated attempts of a line
    splice.js               adds re-recorded clips
    cut.js                  take → voiceover/sN.mp3, voiceover.mp3, scenes.json
    denoise.js              background-noise removal for the cut
    audio.js                ffmpeg helpers
    jev.js                  optional Jev AI decisions via OpenRouter
    config.js               the take pipeline's settings (config/fillers.json over built-in defaults)
    cli.js                  old entry point: node pipeline/cli.js analyze|rerecord|cut|status|tts, an alias onto core/cli.js
    whisper_words.py        Whisper word timestamps (VAD-chunked windows)
    test/                   the test suite (node pipeline/test/run-tests.js)
  renderer/render.js        sharded renderer: Chromium frames → ffmpeg → MP4
  runtime/animations.jsx    the browser runtime every index.html loads
  tools/                    check-sync, validate-sync, contact-sheet, preview, approve-preview,
                            mix-music, search-images, download-image, build-site
  app/                      teleprompter recording and review app (server.js + public/)
  plugins/                  built-in plugins: tts-openrouter, stt-whisper,
                            publish-youtube, publish-meta, publish-discord
  styles/                   style packs (reflective, tech-news, motion) + design.md
  skills/                   agent skills (.claude/skills → skills)
  templates/project/        what `reelsmith init` copies
  config/                   agent-facing config (audio, music, voice, strategy, market, fillers)
  videos/                   the fixture and the tutorial videos
  music/                    CREDITS.md and the track download script (mp3s gitignored)
  docs/  site/              documentation and the static docs site
```

## A video folder

```
videos/<name>/
  script.md              the script (you or the agent)
  research.md            research notes (research skill)
  take.json              analysis of a recorded take (own-voice path)
  takes/                 recorded takes and re-record clips (own-voice path)
  settings.json          per-video switches, e.g. { "denoise": false }
  voiceover/sN.mp3       one clip per scene
  voiceover/tts/         TTS clip cache and meta.json (TTS path)
  voiceover/source/      performance-mode audio, prompt and Whisper cache
  voiceover.mp3          the scenes joined
  voiceover-mix.mp3      voice + music bed (reelsmith mix)
  voiceover-mix.json     what the mix used
  scenes.json            scene durations and word timings
  index.html             the animation
  images/                photos and CREDITS.md (photo-led styles)
  frames/                contact sheet, stills, render cache (gitignored)
  preview-approved.json  the preview approval (reelsmith approve)
  draft.mp4              preview render
  clip-<a>s-<b>s.mp4     range render (clip-<a>s-<b>s-draft.mp4 with --draft)
  output.mp4             final render
  publish.md             publish notes
  publish/<target>.json  publish results (gitignored)
```

## Data contracts

### `script.md`

Frontmatter, then `## Script` with `### Scene N` blocks of one sentence per line; `>` lines are reader cues. Parsed by `pipeline/script.js` into `{ meta, scenes: [{ idx, sentences: [{ id, scene, line, text, cues }] }], sentences, warnings }`. Full format: [Script format](script-format.md).

### `scenes.json`

A bare array. The runtime requires it to be an array.

```json
[
  { "idx": 1, "dur": 8.023, "file": "voiceover/s1.mp3",
    "words": [ { "word": "S3", "start": 0.04, "end": 0.492 } ] }
]
```

| Field | Meaning |
|---|---|
| `idx` | scene number, matches `### Scene N` |
| `dur` | exact length of `sN.mp3` in seconds; `voiceover.mp3` is encoded from the same audio, so Σ `dur` matches it |
| `file` | the scene's clip, relative to the video folder |
| `words` | `{ word, start, end }` in seconds from the start of the scene's clip, monotonic, clamped to the scene |

Written by `reelsmith tts` and `reelsmith cut`. Read by the runtime, the linters, the contact sheet and the renderer.

### `voiceover/tts/meta.json`

What produced the TTS voice, so re-runs reuse it:

```json
{ "provider": "openrouter", "model": "google/gemini-3.8-flash-tts", "voice": "Leda", "speed": 1.15,
  "mode": "sentence", "timings": "whisper", "sentences": 18, "totalSec": 58.6, "at": "2026-09-30T17:12:31.095Z" }
```

Sentence mode also records the gap settings and whether timings fell back to an estimate. Performance mode also keeps `voiceover/source/performance.meta.json` with the prompt hash that decides whether the provider is called again.

### `take.json` (own-voice path)

The single source of truth for a recorded take. The main fields:

| Field | Meaning |
|---|---|
| `status` | `analyzed`, `needs-rerecord`, `ready`, `cut`, or `silent` / `no-speech` with a `problem.message` |
| `audio` | duration, sample rate, mean and max volume, clipping |
| `words` | Whisper words for the take |
| `sentences[]` | per sentence: `id`, `text`, `status` (`ok`, `warn`, `bad`, `missing`, `rerecorded`), `range`, `wer`, `wpm`, `flags[]`, `attempts[]`, `source`, optional `pick` |
| `cuts[]` | ranges the cut removes, with a reason |
| `summary` | `{ ok, warn, bad, missing, fillers, estimatedCleanSec }` |
| `jev` | the Jev model and review notes, or `null` when rules decided alone |

The full schema and the flag rules are in [spec.md](spec.md) §4 and §6.

### `preview-approved.json`

```json
{ "v": 3, "fingerprint": "<sha256>", "by": "you", "at": "2026-09-30T18:02:11.000Z" }
```

The fingerprint (version 3) is a SHA-256 over `index.html`, `scenes.json`, the runtime, every local script `index.html` loads (each `<script src>` that is not http(s), `data:` or protocol-relative: the style kits), and every image in the video folder and `images/**`. Paths are named relative to the project root, so clone mode and package mode give the same fingerprint for the same files. `reelsmith render` recomputes it and refuses (exit 3) when it differs, the file is missing, or the approval is from an older fingerprint version. `reelsmith approve <video> --check` runs the same check (exit 0 or 1).

### `voiceover-mix.json`

```json
{ "durationSec": 53.417, "voiceSec": 50.957, "tailSec": 2.5, "track": "music/digital-lemonade.mp3", "underDb": 6,
  "voiceLufs": -16, "musicLufs": -14.1, "bedGainDb": -7.9, "at": "2026-09-30T22:16:03.804Z" }
```

Written by `reelsmith mix` next to `voiceover-mix.mp3`. `draft`, `clip` and `render` pick `voiceover-mix.mp3` unless its `voiceSec` differs from the current `voiceover.mp3` (the voice was redone after the mix); then they use `voiceover.mp3` and print why. When the audio is 0.1 to 6 s longer than Σ `dur`, the renderer runs to the end of the audio and holds the closing frame through the music tail; longer audio is cut at Σ `dur`. `reelsmith run` reuses `track` and `underDb` when `music.defaultTrack` is not set.

### `publish/<target>.json`

```json
{ "ok": true, "dryRun": false, "target": "youtube", "id": "…", "url": "https://youtu.be/…", "sent": { "title": "…" } }
```

The publish plugin's result, saved through `core/publishNotes.js`. Each target adds its own fields (YouTube: `studioUrl`, requested and actual `privacy`; Meta: `fb` and `ig`; Discord: `channelId`, `messageId`, `bytes`, `transcoded`). A second publish to the same target refuses while an `id` is present, unless `--force`.

## The render pipeline

Every frame is a pure function of time, so frames can be captured in any order by any number of browsers:

```
render.js
  ├─ plan: totalFrames = ceil(duration · fps), split into K contiguous shards
  ├─ shard k: its own headless Chromium, page and CDP session
  │     for frame i: __stage.setTime(i / fps) → one rAF → Page.captureScreenshot (JPEG)
  │     → bytes piped into this shard's ffmpeg (image2pipe), which encodes as it goes
  └─ concat the segments (-c copy) + mux the audio → output.mp4
```

- No frames touch the disk, and encoding overlaps capture.
- Shards default to `min(4, cores − 1, free memory / 400 MB)`; `--shards=N` is still capped at cores − 1.
- The encoder is VideoToolbox when ffmpeg has it, else x264.
- Segments are cached in `frames/render-cache/<key>/`, so a crashed render resumes.
- `--draft` renders at 15 fps and 0.75× size; `--from/--to` renders one range. Neither checks the approval.

A 98 s video renders in about 1.5 minutes, a draft in about 30 s. Measurements and the full contract: [fast-render.md](fast-render.md).

## How a page is served

`index.html` loads `../../runtime/animations.jsx` and style kits from `../../styles/<name>/`. Every tool that opens a page (preview, contact sheet, renderer) serves the **project root** over a local HTTP server (`core/serve.js`), because `file://` blocks those loads. In package mode `runtime` is a symlink into `node_modules/reelsmith`, and `styles/` is a real folder with one symlink per built-in pack (plus `design.md`) beside your own packs, so the same relative paths work; the server follows those links and nothing else outside the project. The page waits for `window.__stage`; tools use `waitUntil: 'load'` (never `networkidle`, because fonts and CDN scripts keep the network busy).

## Plugins and precedence

`core/plugins.js` loads built-ins, then the project's `plugins/`, then entries in `reelsmith.config.json` `"plugins"`; a later plugin with the same name wins. `core/config.js` resolves each setting as: CLI flag, `script.md` frontmatter, per-video meta, environment, `reelsmith.config.json`, built-in default. See [Plugins](plugins.md).
