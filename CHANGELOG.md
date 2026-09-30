# Changelog

All notable changes to Reelsmith are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [semantic versioning](https://semver.org/).

## [0.1.0] - 2026-09-30

Initial framework release.

### Added

- **`reelsmith` CLI** (`bin/reelsmith.js` → `core/cli.js`) with zero-dependency argument parsing and exit codes 0 ok, 1 error, 2 usage, 3 gate refused. Commands: `init`, `doctor`, `new`, `tts`, `record`, `analyze`, `rerecord` (alias `splice`), `cut` (alias `finalize`), `status`, `mix`, `lint`, `sheet`, `preview`, `draft`, `clip`, `approve`, `render`, `publish`, `plugins`, `styles`, `run`. Every command has `--help` (and `reelsmith help <command>`), structured ones `--json`; `reelsmith --version` prints the version. Unknown flags are usage errors.
- **Two ways to start:** clone mode (the repo is the project; `node bin/reelsmith.js`) and package mode: `npx github:Aabishkar2/reelsmith init <dir>` scaffolds a project from `templates/project/` with the `github:Aabishkar2/reelsmith` dependency, a `runtime` symlink into `node_modules/reelsmith`, and a real `styles/` folder holding one symlink per built-in pack plus `design.md`. `init --link` uses a local checkout (`"reelsmith": "file:<path>"`, and it links `node_modules/reelsmith` and `node_modules/.bin/reelsmith` itself, offline); `init --force` scaffolds into a non-empty folder and keeps existing files; `new --force` overwrites a `script.md`.
- **Project config** `reelsmith.config.json` with per-setting precedence: CLI flag, `script.md` frontmatter, per-video meta, env, config, built-in defaults.
- **Plugin registry** (`core/plugins.js`) with four kinds: `tts`, `stt`, `style`, `publish`. Built-ins load through the same registry. Invalid plugins are listed with their error instead of crashing the CLI.
- **Built-in plugins:** `tts-openrouter`, `stt-whisper`, `publish-youtube`, `publish-meta` (Facebook and Instagram Reels), `publish-discord` (with transcoding under the 10 MB bot limit).
- **TTS performance mode** (`reelsmith tts --mode=performance`): one synthesis call with a PERFORMANCE / CONTEXT / TRANSCRIPT prompt, split into scenes by aligning the script to Whisper words. The audio is cached by prompt hash and also reused when only the PERFORMANCE direction text changed; `--offline` never calls the API. `tts` also takes `--provider`, `--timings`, `--whisper-model` and `--cta`.
- **Music bed** (`reelsmith mix`): the bed is set relative to the measured voice, `music.defaultTrack` is used without `--track` (no track at all is exit 2 with the list of tracks), and `voiceover-mix.json` records `durationSec`, `voiceSec`, `tailSec`, `track`, `underDb`, `voiceLufs`, `musicLufs`, `bedGainDb` and `at`. `draft`, `clip` and `render` pick `voiceover-mix.mp3` unless it was mixed over a different voice, and hold the closing frame through a 0.1 to 6 s music tail.
- **`reelsmith run`:** tts → mix → lint → sheet (with stills) → draft, with `--until=tts|mix|lint|sheet|draft`; skips tts for an own-voice video and the mix when there is no track. It never approves or renders.
- **Style packs** in `styles/`: `reflective` (default), `tech-news`, and the new `motion` pack with `kit.jsx` components (terminal, code card, file tree, flow diagram, plugin dock and more). Shared base rules in `styles/design.md`.
- **Agent skills** in `skills/` (symlinked from `.claude/skills`): `reelsmith-pipeline` (new, end to end), `research`, `script-writing`, `teleprompter-prep`, `take-review`, `html-animation`, `publish`, `market-research`.
- **`config/strategy.md`:** a generic pillar and bid framework for choosing topics.
- **`reelsmith doctor`:** checks node, ffmpeg, the Python with Whisper, Playwright Chromium, the project, API keys and every plugin's `check()`.
- **Preview approval:** `reelsmith approve <video> --by=<who>` (`--by` is required) writes a version 3 fingerprint that covers every local `<script src>` the page loads (the style kits); `approve --check` reports whether it is still current.
- **Publishing:** `reelsmith publish <video> --notes` writes a `publish.md` skeleton; every target supports `--dry-run`; results are saved in `videos/<name>/publish/<target>.json` and a second upload is refused without `--force`. `--auth [--check]` runs or verifies the YouTube sign-in. YouTube privacy: `--privacy`, else `privacy:` in `publish.md`, else `publish.targets.youtube.privacy`, else private.
- **Docs** in `docs/` and a static docs site plus landing page in `site/`, built by `tools/build-site.js` and deployed with GitHub Pages.
- **Ten tutorial videos** (`videos/tut-01` to `tut-10`) made with the framework itself, in the `motion` style.

### Kept from the predecessor pipeline

- Teleprompter recording app, take analysis (alignment, flags, attempt selection, denoise) and the cut.
- The React/Babel animation runtime with `useWordCue`, `SubtitleRail` and deterministic motion helpers.
- The sharded fast renderer (JPEG frames piped into ffmpeg, segment cache, draft and range renders) and the preview approval gate.

### Changed

- The helper scripts (linters, contact sheet, preview, approval, music mix, image search) live in `tools/`. The CLI is the public surface; `node tools/<script>.js` still works.
- `config/styles/*.md` and `config/design.md` moved into `styles/`.
- `config/tts.json` retired; defaults live in `core/config.js` and `reelsmith.config.json`.
- Publish credentials moved to `~/.config/reelsmith/` (`REELSMITH_CONFIG_DIR` overrides).
- Machine-specific paths (ffmpeg, python) are resolved at runtime by `core/env.js`, including in the Discord transcode.
- Node 22 is recommended and 20 is the minimum (Playwright's floor).
