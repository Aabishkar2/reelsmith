# CLI reference

```bash
reelsmith <command> [arguments] [flags]
reelsmith --help                  # the command list
reelsmith <command> --help        # one command's flags (also: reelsmith help <command>)
reelsmith --version               # the framework version (also -v, version)
```

How to run it:

| Where | Command |
|---|---|
| a project made by `init` | `npx reelsmith <command>` (the CLI is a local dependency) |
| a clone of the repo | `node bin/reelsmith.js <command>` from the repo (`npm link` once puts `reelsmith` on your PATH) |
| no project yet | `npx github:Aabishkar2/reelsmith init my-channel` (`npx reelsmith init` works once the package is on npm) |

This page writes `reelsmith <command>` for short.

## Conventions

- Flags take `--flag=value`, or `--flag value` for flags that take a value. A switch is `--flag` (also `--flag=true|false`, `1|0`, `yes|no`). `--` ends the flags. `-h` is `--help`.
- Unknown commands, unknown flags, a missing argument and a malformed value (a word where a number belongs) are usage errors: exit code 2 and the command's usage line.
- `<video>` is `videos/<name>`, `<name>`, or a path to the video folder.
- Commands work from any folder inside the project: the root is the nearest folder above with `reelsmith.config.json` (in clone mode, the repo root). The project's `.env` is loaded automatically, and the resolved ffmpeg and ffprobe are put on `PATH` for every step.
- `--json` prints the result as JSON on stdout and sends the logs to stderr. It is available on `doctor`, `plugins`, `styles`, `new`, `tts`, `analyze`, `rerecord`, `cut`, `status`, `mix`, `lint`, `approve` and `publish`.
- `REELSMITH_DEBUG=1` prints the stack trace of an unexpected error.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | ok |
| `1` | error: the step failed (for example `lint` found a problem, `rerecord` rejected the clip, `approve --check` found no current approval, a publish target failed) |
| `2` | usage error: unknown command or flag, missing argument, bad value, `approve` without `--by`, `mix` without a track |
| `3` | gate refused: `render` without a current preview approval |

An interrupted render (Ctrl+C) exits 130 and keeps its finished segments.

## Commands at a glance

| Group | Command | Does |
|---|---|---|
| Project | `init [dir]` | scaffold a new project |
| | `doctor` | check node, ffmpeg, python + whisper, Chromium, keys, plugins |
| | `new <name>` | create `videos/<name>/script.md` from the template |
| | `plugins` | list loaded plugins with kind, version, source, status |
| | `styles` | list style packs |
| Voice | `tts <video>` | script → voice + word timings → `scenes.json` |
| | `record` | start the teleprompter app (own voice) |
| | `analyze <video>` | recorded take → `take.json` |
| | `rerecord <video>` | splice a re-recorded line into the take (alias `splice`) |
| | `cut <video>` | finalize the take → `scenes.json` + `voiceover.mp3` (alias `finalize`) |
| | `status <video>` | print the `take.json` summary |
| | `mix <video>` | music bed → `voiceover-mix.mp3` |
| Picture | `lint <video>` | check-sync + validate-sync; non-zero exit on failure |
| | `sheet <video>` | contact sheet → `frames/contact-sheet.png` |
| | `preview <video>` | live browser playback with the voice |
| | `draft <video>` | fast low-res render → `draft.mp4` (no gate) |
| | `clip <video>` | render one range → `clip-<S>s-<S>s.mp4` (no gate) |
| | `approve <video>` | record the preview approval fingerprint |
| | `render <video>` | final render → `output.mp4` (gate enforced, exit 3) |
| Ship | `publish <video>` | run publish plugins; `--notes` only writes the `publish.md` skeleton |
| | `run <video>` | tts → mix → lint → sheet → draft; never approves or renders |

## Project

### `reelsmith init [dir] [--link] [--style=<pack>] [--no-install] [--force]`

Scaffolds a project in `dir` (default: the current folder):

1. `package.json`: runs `npm init -y` when there is none, then adds the `reelsmith` dependency: `github:Aabishkar2/reelsmith`, or with `--link` `"reelsmith": "file:<absolute path of this checkout>"`.
2. Copies `templates/project/`: `reelsmith.config.json` (with the chosen style), `.env.example`, `.gitignore`, `CLAUDE.md`, `README.md`, `config/` (`audio.md`, `music.md`, `voice/performance.md`, `fillers.json`, `strategy.md`), `videos/`, `music/CREDITS.md` and `music/download.sh`, `plugins/`, and the skills into `.claude/skills/`.
3. Runs `npm install` and installs Playwright's Chromium, unless `--no-install`.
4. Links `runtime` → `node_modules/reelsmith/runtime`. `styles/` is a real folder: it gets one symlink per built-in pack (`styles/reflective`, `styles/tech-news`, `styles/motion` → `node_modules/reelsmith/styles/<pack>`) and one for `styles/design.md`, and your own packs live beside them. The links are relative; where symlinks are not available the files are copied. The links are added to `.gitignore`.

| Flag | Default | Effect |
|---|---|---|
| `--link` | off | use this framework checkout: writes `"reelsmith": "file:<path>"` and creates `node_modules/reelsmith` → the checkout and `node_modules/.bin/reelsmith` itself (offline; no `npm link`). For framework development |
| `--style=<pack>` | `reflective` | the project's default style: `reflective`, `tech-news` or `motion` (anything else is exit 2) |
| `--no-install` | off | skip `npm install` and the Chromium download |
| `--force` | off | scaffold into a non-empty folder; existing files are kept, never overwritten |

Without `--force`, a non-empty folder is refused (exit 1). Run inside the framework checkout itself (clone mode) it does nothing and says so; a folder inside the checkout is refused. It exits 1 when `npm install` or the Chromium download failed, after printing the next steps.

```bash
npx github:Aabishkar2/reelsmith init my-channel
npx github:Aabishkar2/reelsmith init my-channel --style=motion
node ~/reelsmith/bin/reelsmith.js init /tmp/demo --link --no-install
```

### `reelsmith doctor [--json]`

Checks node (✓ on 22 or newer; older versions are flagged), ffmpeg and ffprobe, a Python with `openai-whisper` (optional: word timings and own-voice takes), Playwright's Chromium, the project (root and mode, `reelsmith.config.json`, `runtime/animations.jsx`, the style packs under `styles/`, `videos/`), the keys in `.env` (`OPENROUTER_API_KEY`, the publish tokens) and every plugin's own `check()`. Each line is ✓ ok, ⚠ needs attention (optional items say so) or ✗ required and failing. Exits 1 only when a required item fails.

Reelsmith needs Node 20 or newer (Playwright's minimum); 22 is recommended.

### `reelsmith new <name> [--style=<pack>] [--voice=<name>] [--force]`

Writes `videos/<name>/script.md` from `templates/video/script.md` (a project can override it with its own `templates/video/script.md`): frontmatter (a title from the name, today's date, the style, `tts_voice:` when `--voice` is given, else a commented placeholder), three scene blocks, `## Voice direction` and `## Scene Hints`.

| Flag | Default | Effect |
|---|---|---|
| `--style=<pack>` | `reelsmith.config.json` `style` | the style pack; an unknown pack is exit 2 |
| `--voice=<name>` | none | the TTS voice the creator picked, written as `tts_voice:` |
| `--force` | off | overwrite an existing `script.md` (without it: exit 1) |

`<name>` is letters, digits, `-` and `_`. It must run inside a project.

### `reelsmith plugins [--json]`

Lists every plugin with its name, kind, version, source and status (ok, the load error, or which later plugin overrides it). Order: built-ins (`plugins/`, `styles/`), then the project's `plugins/` and `styles/`, then `reelsmith.config.json` `"plugins"`; a later plugin with the same name overrides an earlier one.

### `reelsmith styles [--json]`

Lists the style packs the project can see, with version, source, whether the pack has a `kit.jsx`, and its description. `*` marks the project default. Exits 1 when no pack is found.

## Voice

### `reelsmith tts <video> --voice=<name> [flags]`

Voices `script.md` with the `tts` plugin (default `tts-openrouter`), times every word with the `stt` plugin (default `stt-whisper`), and writes `voiceover/sN.mp3`, `voiceover.mp3`, `scenes.json` and `voiceover/tts/meta.json`.

| Flag | Default | Effect |
|---|---|---|
| `--voice=<name>` | none | the TTS voice. There is no default: ask the creator |
| `--mode=<sentence\|performance>` | `sentence` | one call per line, or the whole script in one call |
| `--provider=<id>` | `tts.provider` = `openrouter` | the tts plugin (`openrouter` is `tts-openrouter`) |
| `--model=<id>` | `google/gemini-3.8-flash-tts` | the provider's model |
| `--speed=<x>` | `1.15` | tempo, 0.5 to 2, applied locally with ffmpeg; never re-calls the API |
| `--timings=<auto\|whisper\|estimate>` | `auto` | sentence mode word timings: `auto` uses Whisper when it is available, else an estimate; `whisper` fails without it |
| `--whisper-model=<name>` | `turbo` | the Whisper model for the word timings |
| `--cta=<S>` | none | append a silent end-card scene of S seconds |
| `--force` | off | re-voice even when cached audio exists |
| `--offline` | off | performance mode only: never call the TTS API; fails when the audio is not cached (with sentence mode it is exit 2) |

Each setting resolves as: flag > `script.md` frontmatter (`tts_provider`, `tts_model`, `tts_voice`, `tts_speed`, `tts_mode`) > what this video used last time (`voiceover/tts/meta.json`: provider, mode, and model and voice while the provider is the same) > environment (`TTS_PROVIDER`, `TTS_MODEL`, `TTS_VOICE`, `TTS_SPEED`, `TTS_MODE`) > `reelsmith.config.json` `tts` > built-in defaults.

Caching:

- **Sentence mode** caches every clip by provider, model, voice and text, so a re-run only pays for the lines that changed.
- **Performance mode** reuses the cached audio (no API call) when the prompt hash matches, or when only the PERFORMANCE direction text changed and the title, CONTEXT and TRANSCRIPT are the same. That case is logged as `cached (direction text changed since this voice was made; --force re-voices)`. Any change to the spoken lines, the title or `## Voice direction` calls the provider again.

Details: [Voice](voice.md).

### `reelsmith record [--port=<N>]`

Starts the teleprompter, recorder and take-review app for the project around the current folder, at `http://localhost:4310` by default. Ctrl+C stops it.

| Flag | Default | Effect |
|---|---|---|
| `--port=<N>` | `APP_PORT`, else `reelsmith.config.json` `app.port`, else 4310 | the port (1 to 65535) |

### `reelsmith analyze <video> [flags]`

Transcribes a take with Whisper, aligns it to the script and writes `take.json` with a status and flags per sentence, then prints the summary table. The app runs it after each recording.

| Flag | Default | Effect |
|---|---|---|
| `--take=<takes/take-NN>` | the newest take | which take to analyze |
| `--no-jev` | off | rules only, no Jev AI filler decisions |
| `--whisper-model=<name>` | `WHISPER_MODEL`, else `turbo` | the Whisper model |
| `--force-whisper` | off | ignore the cached transcript |

### `reelsmith rerecord <video> --sentence=<id> --clip=<path> [flags]`

Alias: `splice`. Checks a re-recorded clip of one sentence against the script and splices it into `take.json` when it is better: `--sentence=s2.1 --clip=takes/rr-s2.1-1`. A rejected clip (bad, missing the sentence, or silent) leaves the take unchanged and exits 1. An accepted clip becomes another attempt of the line; when a take attempt still scores higher, the take is kept and the command exits 0.

| Flag | Default | Effect |
|---|---|---|
| `--sentence=<s<scene>.<line>>` | required | the sentence id |
| `--clip=<takes/rr-…>` | required | the clip's base path (without the extension) |
| `--no-jev` | off | rules only |
| `--whisper-model=<name>` | `turbo` | the Whisper model |
| `--force-whisper` | off | ignore cached transcripts |

A missing `--sentence` or `--clip` is exit 2.

### `reelsmith cut <video> [--json]`

Alias: `finalize`. Finalizes the take: cuts fillers, stutters and long pauses, denoises, keeps the best attempt of each line, and writes `voiceover/sN.mp3`, `voiceover.mp3` and `scenes.json`.

### `reelsmith status <video> [--json]`

Prints the `take.json` summary: status, WER and wpm per sentence, flags, and the ok / warn / bad / missing counts. Exits 1 when the video has no `take.json`.

### `reelsmith mix <video> [--track=music/<file>.mp3] [--under=<dB>] [--json]`

Lays a music bed under `voiceover.mp3`: the voice loudnormed to −16 LUFS, the track's loudness measured and the bed set `--under` dB below the voice, a gentle duck under speech, a 1.5 s fade in, a fade out over the last 3 s and a 2.5 s music tail after the last word. The voice is not shifted, so `scenes.json` stays valid. Writes `voiceover-mix.mp3` and `voiceover-mix.json`.

| Flag | Default | Effect |
|---|---|---|
| `--track=<file>` | `reelsmith.config.json` `music.defaultTrack` | the music track; looked up relative to the video folder, the project root, the music folder, then the framework checkout |
| `--under=<dB>` | `music.underDb` = 6 | how far the bed sits under the voice. 4 only when the creator asks |

With no `--track` and no `music.defaultTrack`, it exits 2 and lists the tracks in `music/` with a ready-to-copy command. It needs `voiceover.mp3` (run `tts` or `cut` first).

`voiceover-mix.json` records `durationSec`, `voiceSec`, `tailSec`, `track`, `underDb`, `voiceLufs`, `musicLufs`, `bedGainDb` and `at`. Pick the track by mood (`config/music.md`).

## Picture

### `reelsmith lint <video> [--json]`

Runs both linters on `index.html`: hand-picked delays and wall-clock nondeterminism (check-sync), `useWordCue` phrases against `scenes.json`, `fade()` on text and `SubtitleRail` presence (validate-sync). Exits 1 if either fails. See [Animation](animation.md#the-linters).

### `reelsmith sheet <video> [flags]`

Writes `frames/contact-sheet.png`: the hook at 0.3, 1 and 2 s plus frames per scene, each labelled with the scene, the time and the words being spoken, and a list of text lines that break the safe area.

| Flag | Default | Effect |
|---|---|---|
| `--stills` | off | also write every sampled frame full size to `frames/stills/*.jpg` (what the human reviews at the preview gate) |
| `--per-scene=<N>` | 3 | frames per scene |
| `--cols=<N>` | 4 | grid columns |
| `--times=<a,b,c>` | none | extra frame times in seconds |
| `--out=<file.png>` | `frames/contact-sheet.png` | output path |

### `reelsmith preview <video> [--lan] [--port=<N>] [--no-open]`

Serves the project and opens the video in the browser with a playback bar and the voice (`voiceover-mix.mp3`, else `voiceover.mp3`). Refresh to see edits.

| Flag | Default | Effect |
|---|---|---|
| `--lan` | off | listen on the local network and print a URL per interface plus a `/qr` page for opening it on a phone |
| `--port=<N>` | 3000, else a free port | the port |
| `--no-open` | off | do not open a browser |

### `reelsmith draft <video> [render flags]`

Renders `draft.mp4` for review: 15 fps, 0.75× size (540×960), fast encoder settings, with the voice. No approval needed.

### `reelsmith clip <video> --from=<S> --to=<S> [--draft] [render flags]`

Renders only the frames with a time in `[from, to)` to `clip-<from>s-<to>s.mp4` (`clip-<from>s-<to>s-draft.mp4` with `--draft`), with the audio trimmed to match. `--from` and `--to` are required and `--to` must be after `--from` (else exit 2). No approval needed.

### `reelsmith render <video> [render flags]`

The final render: 720×1280 at 30 fps to `output.mp4`. Refuses with exit code 3, and prints the three steps to an approval, when there is no approval, the approval is from an older fingerprint version, or the fingerprint changed.

Finished segments are cached in `frames/render-cache/`, so re-running after a crash resumes. The cache is removed after a successful render. Design and numbers: [Fast render](fast-render.md).

### Render flags (`draft`, `clip`, `render`)

| Flag | Default | Effect |
|---|---|---|
| `--audio=<file>` | see below | the audio to mux in |
| `--fps=<N>` | 30 (draft 15) | frames per second |
| `--shards=<N>` | auto: `min(4, cores − 1, free memory / 400 MB)` | parallel browsers, never more than cores − 1 |
| `--encoder=<auto\|videotoolbox\|x264>` | `auto` | H.264 encoder; `auto` is VideoToolbox when ffmpeg has it, else x264 |
| `--gpu` | off | full Chromium with GPU raster: faster, pixels differ slightly |
| `--keep-segments` | off | keep the segment cache after a successful render |
| `--duration=<S>` | Σ `scenes.json` `dur`, or the music tail | override the length |

All three need `index.html`, and `scenes.json` unless `--duration` is given.

**Audio.** Without `--audio`, the command picks `voiceover-mix.mp3` when it exists, unless its `voiceover-mix.json` `voiceSec` differs from the current `voiceover.mp3` (the voice changed after the mix). Then it uses `voiceover.mp3` and prints why (re-run `reelsmith mix`). With no mix it uses `voiceover.mp3`. The choice is printed as `Audio: <file> [<reason>]`.

**Music tail.** When the audio is 0.1 to 6 s longer than Σ `dur` (the tail `mix` adds), the video runs to the end of the audio and holds the closing frame through the tail. Audio more than 6 s longer is cut at Σ `dur`.

### `reelsmith approve <video> --by=<who> [--check] [--json]`

Run it only after a human explicitly approved the draft, the contact sheet and the stills. Writes `preview-approved.json` with who approved, when, and a fingerprint (version 3) of `index.html`, `scenes.json`, the runtime, every local script `index.html` loads (the style kits) and the images (the video folder and `images/**`). Any later edit to those invalidates it.

| Flag | Default | Effect |
|---|---|---|
| `--by=<who>` | required | who approved. Without it (and without `--check`): exit 2 |
| `--check` | off | only check: exit 0 when the approval is current, 1 when not (and why) |

## Ship

### `reelsmith publish <video> --to=<target>[,<target>] [flags]`

For each target, resolves the publish plugin (`publish-<target>`) and calls its `publish()`: the metadata comes from `publish.md`, the result goes to `videos/<name>/publish/<target>.json`, and a second upload is refused while that file has an `id`. Always dry-run first, and post only when the user says so. Exits 1 when any target fails.

```bash
reelsmith publish my-video --notes                          # write the publish.md skeleton
reelsmith publish my-video --to=youtube,discord --dry-run   # build and print, send nothing
reelsmith publish my-video --to=youtube --auth              # one-time YouTube sign-in
```

| Flag | Default | Effect |
|---|---|---|
| `--to=<targets>` | required | comma-separated targets: `youtube`, `meta`, `discord`, or your own. Without it (and without `--notes`): exit 2, listing the loaded publish plugins |
| `--dry-run` | off | check the credentials and the file, build and print the requests, send nothing |
| `--force` | off | publish again although `publish/<target>.json` has an `id`; with `--notes`, reset `publish.md` to the skeleton |
| `--privacy=<private\|unlisted\|public>` | see below | YouTube privacy; any other value is exit 2 |
| `--file=<file.mp4>` | `output.mp4` | the video file, relative to the video folder |
| `--public-url=<url>` | none | Meta: a public https URL of the mp4 (Instagram needs one) |
| `--channel=<id>` | `DISCORD_CHANNEL_ID` | Discord: the channel id |
| `--notes` | off | only write the `publish.md` skeleton (title from `script.md`, empty sections) and exit; no target needed |
| `--auth` | off | run the target's sign-in step instead of publishing (YouTube: the Google OAuth flow; Meta and Discord have none, their keys come from `.env`) |
| `--check` | off | with `--auth`: only verify the stored credentials |

YouTube privacy, first one set wins: `--privacy`, `privacy:` in the `publish.md` frontmatter, a legacy `youtube.json` in the video folder, `publish.targets.youtube.privacy` in `reelsmith.config.json`, then `private`.

`--auth` also takes the `<video>` argument; any video of the project works. See [Publishing](publishing.md).

### `reelsmith run <video> [--voice=<name>] [--until=<step>]`

The mechanical middle of the pipeline for a video with an approved script and an `index.html`, one step after the other:

1. **tts**, with `--voice` (the other TTS settings come from the frontmatter, the last run and the config). Skipped for an own-voice video: one with a `take.json` and no `voiceover/tts/meta.json` (`reelsmith cut` makes its voice).
2. **mix** with `music.defaultTrack`, else the track (and level) of the video's last `voiceover-mix.json`, else skipped.
3. **lint**. On a failure it stops with exit 1.
4. **sheet** with `--stills`.
5. **draft**.

| Flag | Default | Effect |
|---|---|---|
| `--voice=<name>` | as for `tts` | the TTS voice |
| `--until=<tts\|mix\|lint\|sheet\|draft>` | `draft` | the last step to run; anything else is exit 2 |

It stops at the first failing step. It never approves and never runs the final render; after the draft it prints what to show the user.

## What each command wraps

Every command is a thin layer over a module or a script. The scripts also run directly with `node`:

| Command | Runs |
|---|---|
| `init` | `templates/project/` (in `core/cli.js`) |
| `doctor`, `plugins`, `styles` | `core/env.js`, `core/plugins.js`, each plugin's `check()` |
| `new` | `templates/video/script.md` |
| `tts` | `pipeline/tts.js`, `pipeline/performance.js` through the `tts` and `stt` plugins |
| `analyze`, `rerecord`, `cut`, `status` | `pipeline/analyze.js`, `pipeline/splice.js`, `pipeline/cut.js`, `take.json` |
| `record` | `app/server.js` |
| `mix` | `tools/mix-music.js` |
| `lint` | `tools/check-sync.js` + `tools/validate-sync.js` |
| `sheet` | `tools/contact-sheet.js` |
| `preview` | `tools/preview.js` |
| `draft`, `clip`, `render` | `renderer/render.js` (`--draft`, `--from/--to`, full) |
| `approve` | `tools/approve-preview.js` |
| `publish` | `plugins/publish-*`, `core/publishNotes.js` |

For example:

```bash
node tools/check-sync.js videos/<name>/index.html
node renderer/render.js videos/<name>/index.html --draft --audio=videos/<name>/voiceover-mix.mp3
```

The renderer script also takes `--quality=<n>` (JPEG quality of the captured frames, default 95, draft 80) and `--width` / `--height`. `node pipeline/cli.js analyze|rerecord|cut|status|tts <video>` still works as an alias for the same commands (a rejected re-record clip exits 2 there).

## Environment variables

`.env` in the project root is loaded automatically and never overrides a variable that is already set.

| Variable | Used for |
|---|---|
| `OPENROUTER_API_KEY` | the built-in TTS provider and Jev AI |
| `TTS_PROVIDER`, `TTS_MODEL`, `TTS_VOICE`, `TTS_SPEED`, `TTS_MODE` | TTS settings below the frontmatter and above the config |
| `WHISPER_MODEL` | the Whisper model (default `turbo`) |
| `JEV_MODEL` | the Jev AI model slug on OpenRouter |
| `REELSMITH_PYTHON` | the Python that has `openai-whisper` |
| `FFMPEG_PATH`, `FFPROBE_PATH` | ffmpeg and ffprobe, when they are not on `PATH` |
| `APP_PORT` | the teleprompter app's port |
| `REELSMITH_CONFIG_DIR` | where publish credentials live (default `~/.config/reelsmith`) |
| `YOUTUBE_CLIENT_FILE` | the YouTube OAuth client JSON, if not `<config dir>/youtube-client.json` |
| `META_SYSTEM_TOKEN`, `META_PAGE_ID`, `META_IG_USER_ID`, `META_GRAPH_VERSION` | the Meta publish target (the IG user id is optional) |
| `DISCORD_BOT_TOKEN`, `DISCORD_CHANNEL_ID`, `DISCORD_MAX_BYTES` | the Discord publish target (the last raises the 10 MB upload limit) |
| `UNSPLASH_ACCESS_KEY`, `PEXELS_API_KEY` | image search (`tools/search-images.js`), optional |
| `REELSMITH_DEBUG` | print stack traces of unexpected errors |
