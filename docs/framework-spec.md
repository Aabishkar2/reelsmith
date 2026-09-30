# Reelsmith — framework spec (contracts for all builders)

Reelsmith is the open, plugin-based successor of `video-gen-v2`. It turns a markdown script into a finished vertical short (voice, karaoke subtitles, motion graphics, MP4) with a coding agent (Claude Code) doing the creative work through shipped skills. This document is the contract every build agent works from. Agents only write the files they own (§9).

## 0. Goals and non-goals

Goals
1. **Any developer or creator can adopt it in minutes.** `npx reelsmith init my-channel` (package mode) or `git clone` + `npm install` (clone mode) yields a working project; `reelsmith doctor` says what is missing.
2. **Agent-native.** Config the agent needs is markdown (`config/*.md`, `styles/<name>/STYLE.md`), skills ship with the framework, and `CLAUDE.md` in a project tells any coding agent how to drive the pipeline.
3. **Plugins all the way down.** Four plugin kinds: `tts`, `stt`, `style`, `publish`. Every built-in is itself a plugin loaded through the same registry, so the contract is proven.
4. **Nothing personal in the repo.** No channel names, emails, `the.subtext`, `~/Documents/projects` assumptions, personal takes.
5. **No new runtime dependencies.** Node built-ins + `playwright` + `dotenv` only. Python 3.11 + `openai-whisper` for STT (optional at install; `doctor` reports).
6. **Existing behaviour is preserved.** `pipeline/test/run-tests.js` stays green (33/33 today) and all existing commands keep working through the new CLI.

Non-goals (now): npm publishing, Windows support beyond "should mostly work", webcam, live STT, multi-language.

## 1. Naming

- Package / CLI / repo: `reelsmith`. Bin: `reelsmith` (alias `rs` is **not** registered, keep it simple).
- GitHub: `Aabishkar2/reelsmith` (private for now).
- Tagline: "Script in, short out. A plugin-based framework for agent-made short videos."

## 2. Target repository layout

```
reelsmith/
  bin/reelsmith.js            CLI entry (package.json "bin")
  core/
    config.js                 loads reelsmith.config.json (+ .env via dotenv, + defaults); resolves project root
    plugins.js                plugin registry: discover, validate, list, get(kind, name)
    project.js                project root discovery (walk up for reelsmith.config.json or package.json name=reelsmith), resolve videos/<name>
    env.js                    node/ffmpeg/python resolution (process.execPath, PATH lookup with /opt/homebrew/bin fallback), never hardcoded machine paths
    log.js                    tiny logger (plain console, no deps)
  pipeline/                   existing take/TTS pipeline (script.js, align.js, analyze.js, cut.js, splice.js, tts.js, whisper.js, audio.js …)
    performance.js            NEW: single-call "performance" TTS mode (§5.2)
  renderer/render.js          existing sharded renderer
  runtime/animations.jsx      existing browser runtime
  tools/                      (renamed from scripts/) check-sync.js validate-sync.js contact-sheet.js preview.js approve-preview.js mix-music.js search-images.js download-image.js + lib/
  app/                        teleprompter recorder (existing)
  plugins/                    built-in plugins, one folder each, `plugin.js` + `README.md`
    tts-openrouter/
    stt-whisper/
    publish-youtube/
    publish-meta/
    publish-discord/
  styles/                     style packs (§6)
    reflective/  STYLE.md  kit.jsx(optional)  reference/
    tech-news/   STYLE.md  design.md components.md templates.md
    motion/      STYLE.md  kit.jsx  reference/
  skills/                     agent skills, source of truth (research, script-writing, teleprompter-prep, take-review, html-animation, publish, market-research)
  .claude/skills -> ../skills  (symlink so this repo is itself a valid Claude Code project)
  templates/project/          what `init` copies into a new project (§4)
  config/                     this repo's own project config (dogfood): audio.md music.md voice/performance.md tts.json fillers.json market.md …
  videos/                     examples: fixture-e2e, tut-01 … tut-10
  music/                      CC-BY tracks (mp3 gitignored, CREDITS.md + download script)
  docs/                       documentation (markdown) — §8
  site/                       landing page + docs site, static HTML, GitHub Pages — §8
  pipeline/test/              tests (existing) + new tests for core/plugins/performance
  reelsmith.config.json       this repo's own config
  CLAUDE.md  README.md  LICENSE (MIT)  CHANGELOG.md  .env.example  .gitignore  package.json
```

`scripts/` → `tools/` rename: keep a `scripts/` shim? **No.** Update every reference (skills, docs, CLAUDE.md, package.json, tests). The CLI is the public surface; direct `node tools/x.js` still works.

## 3. CLI (`bin/reelsmith.js`)

Zero-dependency argv parsing (`--flag=value`, `--flag value`, `--bool`). Every command accepts `--json` where output is structured and `--help`. Exit codes: 0 ok, 1 error, 2 usage, 3 gate refused (render without approval).

| Command | Does | Wraps |
|---|---|---|
| `reelsmith init [dir] [--link] [--style=reflective] [--no-install]` | scaffold a project (§4) | templates/project |
| `reelsmith doctor [--json]` | check node ≥18, ffmpeg, python3.11, openai-whisper, playwright chromium, keys (OPENROUTER_API_KEY …), each plugin's `check()` | core + plugins |
| `reelsmith new <name> [--style=…] [--voice=…]` | create `videos/<name>/script.md` from template | templates |
| `reelsmith tts <video> --voice=<name> [--mode=sentence\|performance] [--model] [--speed] [--force]` | script → voice + timings → scenes.json | pipeline/tts.js, pipeline/performance.js via `tts` + `stt` plugins |
| `reelsmith record [--port]` | start teleprompter app | app/server.js |
| `reelsmith analyze <video> [--take] [--no-jev]` | take → take.json | pipeline/cli.js analyze |
| `reelsmith rerecord <video> --sentence --clip` | splice re-record | pipeline |
| `reelsmith cut <video>` | finalize → scenes.json + voiceover.mp3 | pipeline |
| `reelsmith status <video>` | take.json summary | pipeline |
| `reelsmith mix <video> [--track=music/x.mp3] [--under=6]` | music bed → voiceover-mix.mp3 | tools/mix-music.js |
| `reelsmith lint <video>` | check-sync + validate-sync, exit non-zero on failure | tools |
| `reelsmith sheet <video> [--stills]` | contact sheet | tools/contact-sheet.js |
| `reelsmith preview <video> [--lan]` | live browser playback | tools/preview.js |
| `reelsmith draft <video> [--audio=…]` | render --draft (auto-picks voiceover-mix.mp3 else voiceover.mp3) | renderer |
| `reelsmith clip <video> --from=S --to=S` | range render | renderer |
| `reelsmith approve <video> --by=<who>` | preview approval fingerprint | tools/approve-preview.js |
| `reelsmith render <video> [--fps=30] [--shards] [--encoder] [--audio]` | final render (gate enforced) | renderer |
| `reelsmith publish <video> --to=<target>[,<target>] [--dry-run] [--notes]` | run publish plugin(s); `--notes` only writes publish.md skeleton | plugins/publish-* |
| `reelsmith plugins [--json]` | list loaded plugins with kind, version, source, ok/error | core/plugins |
| `reelsmith styles` | list style packs | styles/ |
| `reelsmith run <video> [--voice] [--until=render]` | convenience: tts → mix → lint → sheet → draft (never approve/render by itself) | all |

`<video>` accepts `videos/<name>`, `<name>`, or an absolute path. All commands work from any cwd inside a project (root discovery). In clone mode the repo root is the project. In package mode the project root holds `reelsmith.config.json`.

## 4. Project config, init, package mode

### `reelsmith.config.json` (project root)

```jsonc
{
  "$schema": "https://reelsmith.dev/schema/config.json",   // informational only
  "version": 1,
  "videosDir": "videos",
  "style": "reflective",                    // default style pack
  "plugins": ["./plugins/my-tts"],          // extra plugin dirs/modules; built-ins always load
  "tts":    { "provider": "openrouter", "model": "google/gemini-3.8-flash-tts", "voice": null, "speed": 1.15, "mode": "sentence" },
  "stt":    { "provider": "whisper", "model": "turbo" },
  "music":  { "dir": "music", "underDb": 6, "voiceLufs": -16 },
  "publish": { "targets": { "youtube": {}, "meta": {}, "discord": { "channelIdEnv": "DISCORD_CHANNEL_ID" } } },
  "render": { "fps": 30, "width": 720, "height": 1280 },
  "app":    { "port": 4310 }
}
```
Precedence per setting: CLI flag > script.md frontmatter > per-video meta (voice) > env (`TTS_VOICE` …) > `reelsmith.config.json` > built-in defaults. `config/tts.json` is retired; `core/config.js` owns defaults. Keep `config/*.md` (audio.md, music.md, voice/performance.md, fillers.json) as agent-facing docs/config that the CLI also reads where it already does.

### `reelsmith init`

Copies `templates/project/` into `<dir>`:
```
reelsmith.config.json  .env.example  .gitignore  CLAUDE.md  README.md
config/ (audio.md music.md voice/performance.md fillers.json)
videos/.gitkeep  music/CREDITS.md  plugins/.gitkeep
.claude/skills/  (copied from skills/)
```
Then runs `npm init -y` if no package.json, adds `reelsmith` dependency (`--link` uses `npm link`/file: path for local dev; otherwise `github:Aabishkar2/reelsmith` until it is on npm) and `npx playwright install chromium` unless `--no-install`. Finally prints next steps (edit .env, `reelsmith doctor`, `reelsmith new`).

### Runtime + styles in package mode

`index.html` today loads `../../runtime/animations.jsx` relative to `videos/<name>/`. Rule: **every tool that opens index.html (renderer, preview, contact-sheet) serves the video over a local HTTP server that maps `/__reelsmith/runtime/*` → framework `runtime/` and `/__reelsmith/styles/*` → framework `styles/`**, OR resolves them on disk. `init` writes `runtime` and `styles` **symlinks** in the project root pointing into `node_modules/reelsmith/…` so the existing relative paths (`../../runtime/animations.jsx`, `../../styles/motion/kit.jsx`) keep working in both modes. The renderer agent must confirm how index.html is loaded (file:// vs http) and make the symlink approach work; document the fallback.

## 5. Plugin contract (`core/plugins.js`)

A plugin is a directory with `plugin.js` (CommonJS) exporting:

```js
module.exports = {
  name: 'tts-openrouter',          // unique
  kind: 'tts' | 'stt' | 'style' | 'publish',
  version: '1.0.0',
  description: 'one line',
  // optional
  configSchema: { /* { key: { type, required, env, description } } — used by doctor and docs */ },
  async check(ctx) { return { ok: true|false, message } },   // doctor
  // kind-specific (below)
};
```
`ctx` = `{ root, config, env, log, paths: { ffmpeg, python, node }, video?: { name, dir, script, scenes } }`.

Discovery order: built-ins (`<framework>/plugins/*`), project `plugins/*`, entries of `config.plugins` (relative paths or module names). Later entries override same `name`. Invalid plugins are listed with their error, never crash the CLI (except when the requested provider is invalid).

### 5.1 `tts`
```js
async synthesize({ text, voice, model, format }) → { audio: Buffer, format: 'mp3'|'pcm'|'wav', sampleRate? }   // one sentence
async synthesizePerformance({ prompt, voice, model }) → same    // whole-script call; optional (throws NotSupported if absent)
voices?() → [{ name, note }]   // optional hint list for doctor/docs
```
`pipeline/tts.js` (sentence mode) and `pipeline/performance.js` call the resolved provider; caching, trimming, atempo, gaps, scenes.json stay in the pipeline (provider-agnostic). Cache key includes provider name.

### 5.2 `tts --mode=performance` (`pipeline/performance.js`)
Port of `video-gen-v2/videos/openai-devday/source/{tts-request,build-voice}.js` into a real command:
1. Prompt = `# <title>` + PERFORMANCE block (from `config/voice/performance.md` or frontmatter `tts_performance: <path>`; the block starts at the line `PERFORMANCE`) + `CONTEXT` (script.md `## Voice direction` section, may be empty) + `TRANSCRIPT` (spoken lines; scenes separated by a blank line; `>` cue lines excluded).
2. One `synthesizePerformance` call. Raw audio cached at `videos/<n>/voiceover/source/performance.{pcm|mp3}` + `performance.wav` (24 kHz mono s16le) + `performance.json` `{ model, voice, mode, hash: sha1(model|voice|prompt), format, sampleRate, seconds, at }`. **If `performance.json.hash` matches the current prompt, no API call** (the tutorial videos are already cached this way — do not regenerate them). `performance-prompt.md` is written next to it.
3. Speed: `voiceover/source/performance-x<speed>.wav` via ffmpeg `atempo` (44.1 kHz). Word timings: run `stt` provider on the **1× wav** (Whisper cache at `performance.json`-sibling `performance.json`? — no: whisper.js caches at `<wav>.json` = `voiceover/source/performance.json` **collides** with the meta file above. Resolve: name the meta file `performance.meta.json`; the tutorial dirs already contain `performance.json` = **whisper words** written by whisper.js and a meta file — the builder must rename the existing meta to `performance.meta.json` when it finds `mode: 'performance'` inside, and keep whisper's `performance.json`/`performance.whisper.json` cache intact), scale times by 1/speed.
4. Scene split: align script sentences to whisper words with `pipeline/align.js` (script tokens ↔ transcript tokens), take each scene's first/last matched word, cut at the **middle of the pause** between consecutive scenes (fallback: end of last word + 60 % of the gap). Glue whisper fragments like `-on`, `.5` back onto the previous word as build-voice.js did. If alignment finds < 80 % of sentences, fail with a clear message listing the missing sentence ids.
5. Emit the standard contract: `voiceover/sN.mp3`, `voiceover.mp3` (from concatenated scene wavs so Σdur matches), `scenes.json` (bare array `[{ idx, dur, file, words:[{word,start,end}] }]`, words scene-relative, clamped, monotonic), `voiceover/tts/meta.json` `{ provider, model, voice, speed, mode: 'performance', timings, sentences, totalSec, at }`.
6. Test: `pipeline/test/performance.test.js` with a stubbed provider (ffmpeg-generated tone/silence or the fixture voice) and a stubbed stt returning fixed words; assert scene count, Σdur, monotonic words, cache hit skips the provider.

### 5.3 `stt`
```js
async transcribe({ wavPath, mode: 'whole'|'chunked', prompt, model, config }) → words[{ word, start, end, conf? }]
```
`plugins/stt-whisper` wraps `pipeline/whisper.js` (which keeps its cache semantics). A second built-in is **not** required; document how to write one (e.g. Deepgram) in `docs/plugins.md`.

### 5.4 `style`
A style pack is a folder under `styles/` (framework) or `<project>/styles/`:
```
styles/<name>/
  STYLE.md        the look: palette, fonts (Google Fonts link), subtitle props, layouts table, safe area, banned defaults, how to use kit.jsx
  kit.jsx         optional; `<script type="text/babel" src="../../styles/<name>/kit.jsx">` after the runtime; defines window-level components
  reference/      optional reference index.html + still(s)
  plugin.js       optional: { name, kind:'style', version, description }  — if absent the registry synthesizes it from STYLE.md frontmatter (`name`, `description`)
```
`reelsmith styles` lists them; the html-animation skill's Rule 0 reads `styles/<name>/STYLE.md`. Migration: `config/styles/reflective.md` → `styles/reflective/STYLE.md`; `config/styles/tech-news.md` + `config/design.md` + `config/components.md` + `config/templates.md` → `styles/tech-news/` (design.md becomes the shared canvas/base rules doc referenced from every STYLE.md, keep it at `styles/design.md`). New **`styles/motion/`** per §6.

### 5.5 `publish`
```js
async publish({ video, dryRun, notes, config, env, log }) → { ok, dryRun, target, id?, url?, sent?: {...}, skipped?: reason }
async check(ctx) → { ok, message }          // credentials present, sizes/limits
```
Rules: `--dry-run` must exercise everything except the network write (credentials read, file checked, request body built and printed). Results are written to `videos/<n>/publish/<target>.json` and a re-run without `--force` refuses if an `id` already exists. Metadata comes from `videos/<n>/publish.md` (title/description/tags/hashtags; parser in `core/publishNotes.js`).
- `publish-youtube`: port `scripts/upload-youtube.js` + `youtube-auth.js`; client JSON at `~/.config/reelsmith/youtube-client.json` (env `REELSMITH_CONFIG_DIR` overrides), token beside it. `docs/publishing.md` keeps the setup steps from `docs/youtube.md`.
- `publish-meta`: Node port of `video-gen-v2/videos/openai-devday/source/post-reels.py` (Graph API: FB page video/reels + IG reels container → publish), env `META_SYSTEM_TOKEN`, `META_PAGE_ID`, `META_IG_USER_ID`. Requires the mp4 to be reachable by URL for IG (document: `--public-url=` flag or a `publicUrl` in publish.md; without it IG is `skipped` with reason, FB uploads via multipart).
- `publish-discord`: bot token `DISCORD_BOT_TOKEN`, channel `DISCORD_CHANNEL_ID` (config may name the env var). Uploads `output.mp4` with the publish.md title as message; checks Discord's 10 MB bot upload limit and, when larger, transcodes a `output-discord.mp4` (h264, 720×1280, target ≤ 9.5 MB via two-pass bitrate from duration) before sending. Dry-run prints sizes and the message.

## 6. Style pack `motion` (used by the tutorial videos)

Purpose: fast, bright, motion-graphic teaching videos with code, terminals and diagrams. Deterministic (Rule 4), phone-readable, no stock photos.

- Canvas 720×1280, background `#0B0F19` (ink) with a subtle radial vignette; accent **`#7C5CFF`** (violet), secondary **`#22D3EE`** (cyan), success `#34D399`, warn `#FBBF24`, danger `#F87171`, text `#F5F7FF`, muted `rgba(245,247,255,0.62)`.
- Fonts (Google Fonts): display **Sora** 700/800, body **Inter** 400/500/600, code **JetBrains Mono** 400/600.
- Subtitles: `<SubtitleRail sceneIdx={N} bottom={150} fontSize={28} variant="clean" accentColor={CYAN} fontFamily="Inter" />`.
- `kit.jsx` components (all pure functions of `t`/`localTime`, exported on `window`): `Terminal` (window chrome, typed command with per-character reveal from a start time, output rows revealed by cue, blinking cursor driven by `t`), `CodeCard` (title bar, monospace lines with optional highlight rows + line reveal), `FileTree` (rows with indent + reveal), `PhoneFrame` (9:16 device frame with children), `Chip`, `Badge`, `StatusRows` (icon + label + state, per-row reveal), `FlowDiagram` (nodes + animated connectors, node light-up by cue), `PluginDock` (core block + tiles snapping in), `Wordmark` (letter-by-letter REELSMITH), `Waveform` (seeded bars animated by t), `ProgressBar`, `Counter` (count-up numeral), `Stamp` (rotated stamp punch-in), `Grid` (contact-sheet like thumbnails), `Strike` (strike-through reveal), `SplitCard`, `Enter` helpers (`slideUp`, `pop`, `wipe`, `push`) built on runtime `interpolate`/`spring`/`Easing`. Each component takes `t` (seconds since its start) or `at` (cue time) + `localTime`. Text lines keep ≥48 px margins and ≤520 px width (safe area).
- STYLE.md documents every component with a snippet, a layouts table (hook, terminal-led, split, diagram, close), the motion rules (something new every 2–4 s, vary entries, springs `k=320,d=30` snappy / `k=200,d=14` punch), and the banned defaults.
- `reference/`: the finished `videos/tut-01-what-is-reelsmith/index.html` gets copied here once done (video agents produce it).

## 7. Skills

Move `.claude/skills/*` → `skills/*` (symlink back). Update every path (`scripts/` → `tools/`, `config/styles/<s>.md` → `styles/<s>/STYLE.md`, `node pipeline/cli.js …` → `reelsmith …`), strip personal references (channel, BIDS.MD becomes `config/strategy.md` template with the pillar framework but generic), keep the workflow rules (approval gates, Rule 0–6). Add `skills/reelsmith-pipeline/SKILL.md`: the single "how to make a video end to end with the CLI" skill that CLAUDE.md points to first. `templates/project/CLAUDE.md` is a shorter, generic version of the repo `CLAUDE.md`.

## 8. Docs and site

`docs/`: `getting-started.md`, `concepts.md` (pipeline, contracts, gates), `script-format.md`, `voice.md` (tts sentence/performance, recording path), `animation.md` (runtime API, useWordCue, SubtitleRail, Rule 4), `styles.md`, `plugins.md` (contract + writing each kind, with a full ElevenLabs-style example), `cli.md` (every command/flag), `publishing.md`, `agent-workflow.md` (how Claude Code drives it, skills, gates), `faq.md`, `architecture.md`, plus the existing `fast-render.md`, `learnings.md`. Everything technical must match the code — docs agents read the code, not this spec, for flag names.

`site/`: static, no build step, GitHub Pages from `/site` on `main` (workflow `.github/workflows/pages.yml` uses `actions/upload-pages-artifact` with `path: site`). `site/index.html` landing (hero, 30-second pitch, pipeline diagram as inline SVG, feature grid, "how the agent works", plugin kinds, tutorial series section with the 10 titles and local video embeds `../videos/tut-XX/output.mp4` are **not** available on Pages → embed poster stills from `site/assets/` and link to the repo), `site/docs/*.html` generated from `docs/*.md` by `tools/build-site.js` (tiny markdown→HTML in Node, no deps: headings, lists, code fences, tables, links, bold/italic, inline code; sidebar nav; light/dark via `prefers-color-scheme`). Fonts: Sora + Inter. Palette = motion style. Mobile first.

## 9. Ownership (parallel agents, no overlapping files)

| Agent | Owns (writes) | Must not touch |
|---|---|---|
| **A core** | `bin/`, `core/`, `pipeline/tts.js`, `pipeline/performance.js`, `pipeline/cli.js` (keep as thin alias), `plugins/tts-openrouter`, `plugins/stt-whisper`, `templates/project/*` (except CLAUDE.md text — A writes a first version, C may refine), `package.json`, `.env.example`, `.gitignore`, `scripts/`→`tools/` rename + all code references, `pipeline/test/*` new tests, `reelsmith.config.json`, `config/tts.json` removal | `styles/`, `skills/`, `docs/`, `site/`, `plugins/publish-*`, `videos/tut-*` |
| **B publish+styles** | `plugins/publish-youtube`, `plugins/publish-meta`, `plugins/publish-discord`, `core/publishNotes.js`, `styles/**` (migration + `motion` pack with `kit.jsx`), `config/design.md`→`styles/design.md` move, `music/download.sh` | `bin/`, `core/*` other than publishNotes.js, `pipeline/`, `skills/`, `docs/`, `site/` |
| **C docs+skills+site** | `README.md`, `CLAUDE.md`, `skills/**`, `.claude/skills` symlink, `docs/*.md` (except this file and learnings.md), `site/**`, `tools/build-site.js`, `.github/workflows/pages.yml`, `LICENSE`, `CHANGELOG.md`, `config/strategy.md` (from BIDS.MD, generic), `templates/project/CLAUDE.md` + `templates/project/README.md` | code outside `tools/build-site.js` |
| **V1..V10 video** | `videos/tut-XX/index.html` (+ `images/` if any) only | everything else |
| **Lead** | this spec, `videos/tut-*/script.md`, integration, renders, repo/push | |

Shared read-only inputs: `video-gen-v2` at `../video-gen-v2` for reference (never modify), the current repo state.

## 10. Acceptance (lead verifies)

1. `node pipeline/test/run-tests.js` green, plus new tests for `core/plugins`, `performance`, `publish --dry-run` (stubbed fetch).
2. `reelsmith doctor` on this machine: all green except optional items clearly marked optional.
3. `reelsmith init /tmp/x --link --no-install` then `cd /tmp/x && reelsmith doctor && reelsmith new demo && reelsmith plugins` work.
4. `reelsmith tts videos/tut-01-what-is-reelsmith --mode=performance --voice=Leda` uses the cached audio (no API call, log says "cached") and writes scenes.json with 7 scenes.
5. `reelsmith lint`, `sheet`, `draft`, `approve`, `render` on `videos/fixture-e2e` produce output.mp4.
6. `reelsmith publish videos/fixture-e2e --to=youtube,meta,discord --dry-run` prints what would be sent and sends nothing.
7. `grep -ri "subtext\|aabishkar\|Documents/projects" --exclude-dir=node_modules --exclude-dir=.git .` returns only LICENSE/README attribution lines and `docs/learnings.md` history.
8. `node tools/build-site.js` builds `site/docs/*.html`; `site/index.html` opens locally.

## 11. Addendum from the architecture map (read before building)

- **Renderer/preview/contact-sheet serve the PROJECT ROOT over HTTP** (`renderer/render.js:40,575-577`, `tools/preview.js:28`, `tools/contact-sheet.js:30`, `tools/approve-preview.js:29-30`, `pipeline/cli.js:31`, `pipeline/tts.js:45`, `pipeline/config.js:13-14`). Today ROOT = framework `__dirname/..`. Change: ROOT = **project root from `core/project.js`** (walk up from cwd / the video dir for `reelsmith.config.json`; fall back to the framework root). In package mode the project root holds `runtime` and `styles` symlinks (created by `init`) into `node_modules/reelsmith/`, so `../../runtime/animations.jsx` keeps resolving; the static server must follow symlinks (Node `fs` does) and must not block them.
- **Whisper cache naming:** `pipeline/whisper.js` caches at `<wav minus .wav>.json` + `.whisper.json`. So for `voiceover/source/performance.wav` the words live in `voiceover/source/performance.json`. The performance-mode meta file is therefore **`voiceover/source/performance.meta.json`** (`{ provider, model, voice, mode, hash, format, sampleRate, seconds, at }`). The tutorial videos already have `performance.wav`, `performance.pcm`, `performance-prompt.md`, whisper's `performance.json`/`performance.whisper.json`, and `performance.meta.json` — reuse them, never re-call the API for them.
- **Hard-coded machine paths to remove:** `/opt/homebrew/bin/ff*` at `tools/mix-music.js:19-20`, `app/server.js:28`; `python3.11` at `pipeline/tts.js:126`, `pipeline/whisper.js:121`, `pipeline/config.js:67` → `core/env.js` resolves `ffmpeg`/`ffprobe` (PATH, then `/opt/homebrew/bin`, `/usr/local/bin`; env `FFMPEG_PATH`) and python (`REELSMITH_PYTHON`, then `python3.11`, `python3.12`, `python3`), tests use the same resolver. `~/.config/video-gen-v2` → `~/.config/reelsmith` (env `REELSMITH_CONFIG_DIR`).
- **Music tail vs duration:** `tools/mix-music.js` adds a 2.5 s music tail but the renderer's default length is Σdur (`renderer/render.js:138`) and `apad -shortest` cuts it. Fix: `mix-music.js` writes `voiceover-mix.json { durationSec, tailSec, track, underDb }`; when `render`/`draft` gets `--audio=<file>` and no `--duration`, it uses the audio's ffprobe duration if it is longer than Σdur by at most 6 s, and the runtime keeps the last scene mounted (`keepMounted`/end = stage duration) so the tail shows the closing frame, not black. Agent A verifies with fixture-e2e + a mix.
- **Runtime brand defaults** (`runtime/animations.jsx:999-1001,1135,1240`: accent `#c8102e`, Barlow) stay as defaults; style packs pass props. Do not fork the runtime.
- **Publish:** `tools/upload-youtube.js` already has `--dry-run` and refuses a second upload without `--force`; reuse that logic in `plugins/publish-youtube`. `youtube.json` `file` key is currently ignored — the plugin must honour `file` (default `output.mp4`).
- **Tests** run with `node pipeline/test/run-tests.js` (≈60 s; needs python3.11 whisper + edge_tts, Chromium, ffmpeg, network). Keep them green; add `npm test`.
- **Stale skill/doc cross-references** to fix (Agent C): market-research "invoked automatically", teleprompter-prep "no synthesized voice" and "score ≥80", learnings.md `script-writing/references/*` pointer, `config/components.md` `useWordTimings` note, `music.md` missing `intergalactic.mp3`, a camoufox skill reference in research/BIDS.
