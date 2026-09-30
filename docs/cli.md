# CLI reference

```bash
reelsmith <command> [arguments] [flags]
```

In clone mode, `npm link` puts `reelsmith` on your PATH; without it, run `node bin/reelsmith.js <command>`. In a project made by `reelsmith init`, run `npx reelsmith <command>`.

## Conventions

- Flags accept `--flag=value`, `--flag value`, and `--flag` for booleans.
- Every command accepts `--help`. Commands with structured output accept `--json`.
- `<video>` is `videos/<name>`, `<name>`, or an absolute path.
- Commands work from any folder inside the project: the project root is found by walking up to the folder with `reelsmith.config.json` (in clone mode, the repo root).

### Exit codes

| Code | Meaning |
|---|---|
| `0` | ok |
| `1` | error |
| `2` | usage error (unknown command, missing argument) |
| `3` | gate refused: `render` without a current preview approval |

## Project

### `reelsmith init [dir] [--link] [--style=reflective] [--no-install]`

Scaffolds a new project in `dir` from `templates/project/`: `reelsmith.config.json`, `.env.example`, `.gitignore`, `CLAUDE.md`, `README.md`, `config/`, `videos/`, `music/CREDITS.md`, `plugins/`, `.claude/skills/`, and `runtime` and `styles` symlinks into the installed framework. Runs `npm init -y` if there is no `package.json`, adds the `reelsmith` dependency, installs Playwright Chromium, and prints the next steps.

| Flag | Effect |
|---|---|
| `--style=<name>` | the project's default style pack (default `reflective`) |
| `--link` | link a local framework checkout instead of installing it (framework development) |
| `--no-install` | skip the dependency install and the Chromium download |

### `reelsmith doctor [--json]`

Checks node (18 or newer), ffmpeg, Python 3.11 with `openai-whisper`, Playwright Chromium, the API keys (`OPENROUTER_API_KEY`, …) and every plugin's own `check()`. Prints what is missing and how to fix it; optional items are marked optional.

### `reelsmith plugins [--json]`

Lists every loaded plugin with its kind, version, source (built-in, project, config) and status (ok, or the load error).

### `reelsmith styles`

Lists the style packs the project can see.

## Script

### `reelsmith new <name> [--style=…] [--voice=…]`

Creates `videos/<name>/script.md` from the template. `--style` and `--voice` fill in the `style:` and `tts_voice:` frontmatter.

## Voice: TTS

### `reelsmith tts <video> --voice=<name> [--mode=sentence|performance] [--model=…] [--speed=…] [--force]`

Turns the script into `voiceover/sN.mp3`, `voiceover.mp3`, `scenes.json` and `voiceover/tts/meta.json`, through the configured `tts` and `stt` plugins.

| Flag | Effect |
|---|---|
| `--voice=<name>` | the TTS voice. Required unless `tts_voice` is set in the frontmatter or the video already has one in `meta.json`. There is no default |
| `--mode=sentence` | one call per line, each clip cached (default) |
| `--mode=performance` | one call for the whole script with a direction prompt; cached by prompt hash |
| `--model=<id>` | the provider model (default `google/gemini-3.8-flash-tts`) |
| `--speed=<x>` | tempo via ffmpeg atempo (default `1.15`); never re-calls the API |
| `--force` | regenerate every clip, ignoring the cache |

Details: [Voice](voice.md).

## Voice: your own take

### `reelsmith record [--port=…]`

Starts the teleprompter and recording app (default `http://localhost:4310`, or `app.port` in the config).

### `reelsmith analyze <video> [--take=takes/take-01] [--no-jev]`

Transcribes a take with Whisper, aligns it to the script and writes `take.json` with a status and flags per sentence. Without `--take`, the latest `takes/take-NN` is used. `--no-jev` skips the Jev AI filler classification (rules only).

### `reelsmith rerecord <video> --sentence=<id> --clip=<path>`

Splices a re-recorded clip into the take: `--sentence=s2.1 --clip=takes/rr-s2.1-1`. The clip is transcribed, checked against the sentence and added as an attempt.

### `reelsmith cut <video>`

Finalizes the take: cuts fillers, stutters and long pauses, denoises, keeps the best attempt of each line, and writes `voiceover/sN.mp3`, `voiceover.mp3` and `scenes.json`.

### `reelsmith status <video>`

Prints the `take.json` summary: status, WER and wpm per sentence, flags, and the ok / warn / bad / missing counts.

## Audio

### `reelsmith mix <video> [--track=music/<file>.mp3] [--under=6]`

Lays a music bed under the voice and writes `voiceover-mix.mp3`: voice loudnormed to −16 LUFS, the track measured and set `--under` dB below it (default 6), gentle ducking, fades, a short music tail. See `config/music.md` for tracks.

## Quality gates

### `reelsmith lint <video>`

Runs check-sync and validate-sync on `index.html` and exits non-zero if either fails. See [Animation](animation.md#the-linters).

### `reelsmith sheet <video> [--stills]`

Writes `frames/contact-sheet.png`: frames at 0.3, 1 and 2 s plus three per scene, each labelled with the words being spoken, and a list of text lines that break the safe area. `--stills` also writes every frame full size to `frames/stills/*.jpg`.

### `reelsmith preview <video> [--lan]`

Serves the project and opens the video in the browser with live playback and the voice. `--lan` listens on the local network and prints a URL per interface plus a `/qr` page for opening it on a phone.

### `reelsmith draft <video> [--audio=…]`

Renders `draft.mp4`: 15 fps, 0.75× size, fast encoder settings, with the voice (`voiceover-mix.mp3` if it exists, else `voiceover.mp3`; `--audio` overrides). No approval needed.

### `reelsmith clip <video> --from=S --to=S`

Renders only the range `[from, to)` in seconds to `clip-<from>s-<to>s.mp4`, with the audio trimmed to match. No approval needed.

### `reelsmith approve <video> --by=<who>`

Records the preview approval in `preview-approved.json`: who approved, when, and a fingerprint of `index.html`, `scenes.json`, the runtime, the style kit the page loads, and the images (the video root and `images/**`). Run it only after a human approved the draft.

### `reelsmith render <video> [--fps=30] [--shards=N] [--encoder=auto|videotoolbox|x264] [--audio=…]`

The final render to `output.mp4`. Refuses with exit code 3 when there is no approval or the fingerprint changed.

| Flag | Effect |
|---|---|
| `--fps=<n>` | frames per second (default 30) |
| `--shards=<n>` | parallel browsers (default: up to 4, limited by cores and free memory) |
| `--encoder=<e>` | `auto` (VideoToolbox when ffmpeg has it, else x264), `videotoolbox`, `x264` |
| `--audio=<file>` | the audio track to mux in |

Finished segments are cached in `frames/render-cache/`, so re-running after a crash resumes. Design and numbers: [Fast render](fast-render.md).

## Publish

### `reelsmith publish <video> --to=<target>[,<target>] [--dry-run] [--notes]`

Runs the publish plugin for each target (`youtube`, `meta`, `discord`, or your own).

| Flag | Effect |
|---|---|
| `--to=<targets>` | comma-separated target names |
| `--dry-run` | check credentials and the file, build and print the requests, send nothing |
| `--notes` | only write the `publish.md` skeleton; no target needed, nothing sent |
| `--force` | publish again even though `publish/<target>.json` already has an `id` |
| `--public-url=<url>` | (meta) a public https URL of the mp4, needed for Instagram |
| `--auth` | (youtube) run the one-time Google sign-in instead of publishing: `reelsmith publish --to=youtube --auth` |

Results are written to `videos/<name>/publish/<target>.json`. See [Publishing](publishing.md).

## Convenience

### `reelsmith run <video> [--voice=…] [--until=…]`

Chains `tts` → `mix` → `lint` → `sheet` → `draft` for a video with an approved script and an `index.html`. `--until` names the step to stop at. It never approves and never runs the final render.

## What each command wraps

Every command is a thin layer over a script you can also run directly with `node`:

| Command | Script |
|---|---|
| `init` | `templates/project/` |
| `doctor`, `plugins`, `styles` | `core/`, each plugin's `check()` |
| `tts` | `pipeline/tts.js`, `pipeline/performance.js` through the `tts` and `stt` plugins |
| `record` | `app/server.js` |
| `analyze`, `rerecord`, `cut`, `status` | `pipeline/cli.js analyze \| rerecord \| cut \| status` |
| `mix` | `tools/mix-music.js` |
| `lint` | `tools/check-sync.js` + `tools/validate-sync.js` |
| `sheet` | `tools/contact-sheet.js` |
| `preview` | `tools/preview.js` |
| `draft`, `clip`, `render` | `renderer/render.js` (`--draft`, `--from/--to`, full) |
| `approve` | `tools/approve-preview.js` |
| `publish` | `plugins/publish-*` |

For example:

```bash
node tools/check-sync.js videos/<name>/index.html
node renderer/render.js videos/<name>/index.html --draft --audio=videos/<name>/voiceover-mix.mp3
```

The renderer script also takes `--quality=<n>` (JPEG quality of captured frames), `--gpu` (full Chromium with GPU raster, slightly different pixels) and `--keep-segments` (keep the segment cache after a render).

## Environment variables

| Variable | Used for |
|---|---|
| `OPENROUTER_API_KEY` | the built-in TTS provider and Jev AI |
| `TTS_VOICE`, `TTS_MODEL`, `TTS_SPEED` | TTS defaults below the frontmatter and above the config |
| `REELSMITH_PYTHON` | the Python that has `openai-whisper` |
| `FFMPEG_PATH` | the ffmpeg binary, when it is not on PATH |
| `REELSMITH_CONFIG_DIR` | where publish credentials live (default `~/.config/reelsmith`) |
| `YOUTUBE_CLIENT_FILE` | the YouTube OAuth client JSON, if not `<config dir>/youtube-client.json` |
| `META_SYSTEM_TOKEN`, `META_PAGE_ID`, `META_IG_USER_ID` | the Meta publish target (the IG user id is optional) |
| `DISCORD_BOT_TOKEN`, `DISCORD_CHANNEL_ID`, `DISCORD_MAX_BYTES` | the Discord publish target (the last raises the 10 MB upload limit) |

`.env` in the project root is loaded automatically.
