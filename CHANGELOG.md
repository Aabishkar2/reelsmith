# Changelog

All notable changes to Reelsmith are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [semantic versioning](https://semver.org/).

## [0.1.0] - 2026-09-30

Initial framework release.

### Added

- **`reelsmith` CLI** (`bin/reelsmith.js`) with zero-dependency argument parsing and exit codes 0 ok, 1 error, 2 usage, 3 gate refused. Commands: `init`, `doctor`, `new`, `tts`, `record`, `analyze`, `rerecord`, `cut`, `status`, `mix`, `lint`, `sheet`, `preview`, `draft`, `clip`, `approve`, `render`, `publish`, `plugins`, `styles`, `run`.
- **Two ways to start:** clone mode (the repo is the project) and package mode (`reelsmith init` scaffolds a project from `templates/project/`, with `runtime` and `styles` symlinks into the installed framework).
- **Project config** `reelsmith.config.json` with per-setting precedence: CLI flag, `script.md` frontmatter, per-video meta, env, config, built-in defaults.
- **Plugin registry** (`core/plugins.js`) with four kinds: `tts`, `stt`, `style`, `publish`. Built-ins load through the same registry. Invalid plugins are listed with their error instead of crashing the CLI.
- **Built-in plugins:** `tts-openrouter`, `stt-whisper`, `publish-youtube`, `publish-meta` (Facebook and Instagram Reels), `publish-discord` (with transcoding under the 10 MB bot limit).
- **TTS performance mode** (`reelsmith tts --mode=performance`): one synthesis call with a PERFORMANCE / CONTEXT / TRANSCRIPT prompt, cached by prompt hash, split into scenes by aligning the script to Whisper words.
- **Style packs** in `styles/`: `reflective` (default), `tech-news`, and the new `motion` pack with `kit.jsx` components (terminal, code card, file tree, flow diagram, plugin dock and more). Shared base rules in `styles/design.md`.
- **Agent skills** in `skills/` (symlinked from `.claude/skills`): `reelsmith-pipeline` (new, end to end), `research`, `script-writing`, `teleprompter-prep`, `take-review`, `html-animation`, `publish`, `market-research`.
- **`config/strategy.md`:** a generic pillar and bid framework for choosing topics.
- **`reelsmith doctor`:** checks node, ffmpeg, the Python with Whisper, Playwright Chromium, API keys and every plugin's `check()`.
- **Publishing:** `reelsmith publish --notes` writes a `publish.md` skeleton; every target supports `--dry-run`; results are saved in `videos/<name>/publish/<target>.json` and a second upload is refused without `--force`.
- **Docs** in `docs/` and a static docs site plus landing page in `site/`, built by `tools/build-site.js` and deployed with GitHub Pages.
- **Ten tutorial videos** (`videos/tut-01` to `tut-10`) made with the framework itself, in the `motion` style.

### Kept from the predecessor pipeline

- Teleprompter recording app, take analysis (alignment, flags, attempt selection, denoise) and the cut.
- The React/Babel animation runtime with `useWordCue`, `SubtitleRail` and deterministic motion helpers.
- The sharded fast renderer (JPEG frames piped into ffmpeg, segment cache, draft and range renders) and the preview approval gate.

### Changed

- `scripts/` renamed to `tools/`. The CLI is the public surface; `node tools/<script>.js` still works.
- `config/styles/*.md` and `config/design.md` moved into `styles/`.
- `config/tts.json` retired; defaults live in `core/config.js` and `reelsmith.config.json`.
- Publish credentials moved to `~/.config/reelsmith/` (`REELSMITH_CONFIG_DIR` overrides).
- Machine-specific paths (ffmpeg, python) are resolved at runtime by `core/env.js`.
