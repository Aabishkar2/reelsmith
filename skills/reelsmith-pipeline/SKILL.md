---
name: reelsmith-pipeline
description: Make a short video end to end with the Reelsmith CLI. Use first whenever the user says "make me a video", "make a video about X", "what's next for this video", "render it", or asks where a video stands. Gives the order of `reelsmith` commands for the TTS path and the recorded-take path, what each command produces, which skill owns each step, and the human gates (research, script, voice choice, preview, publish) that must never be skipped.
---

# Reelsmith pipeline: script in, short out

This is the map. Each step names the command or the skill that does it, the files it writes, and whether a human has to approve before you continue. The other skills hold the detailed rules for their step.

Run everything from the project root (any folder inside the project works). `<name>` is the folder under `videos/`; every command also accepts `videos/<name>` or a path. The commands are written `reelsmith <command>`: in a project made by `init` run `npx reelsmith <command>`, in a clone of the framework repo `node bin/reelsmith.js <command>`. `reelsmith <command> --help` lists every flag.

## Before the first video

```bash
reelsmith doctor
```

It checks node, ffmpeg, the Python that has Whisper, Playwright Chromium, API keys and every plugin. Fix red items before starting. Items marked optional only matter for the path that uses them (no OpenRouter key is needed for your own voice; no publish tokens until you publish).

## Where a video stands

Look at the files in `videos/<name>/`:

| File | Means |
|---|---|
| `research.md` with `Status: DRAFT` | research done, waiting for the user's approval |
| `research.md` with `Status: APPROVED` | ready for script writing |
| `script.md` with lines under `### Scene N` | a script exists (ask whether it is approved if unclear) |
| `take.json` | a recorded take was analyzed (`reelsmith status <name>`) |
| `scenes.json` + `voiceover.mp3` | the voice is done |
| `voiceover-mix.mp3` | music bed mixed |
| `index.html` | the animation exists |
| `frames/contact-sheet.png`, `draft.mp4` | preview artifacts |
| `preview-approved.json` | the user approved the preview |
| `output.mp4` | final render |
| `publish.md` | publish notes written |
| `publish/<target>.json` | posted to that target |

## The two paths

```
reelsmith new <name>
      │
research skill ─────────► research.md          [GATE: user says "approved"]
      │
script-writing skill ───► script.md            [GATE: user approves the script]
      │
teleprompter-prep skill ► script.md (delivery) [optional for TTS]
      │
      ├── TTS path ──────────────────────────────┐
      │   ask the creator for the voice          │  [GATE: the creator names a voice]
      │   reelsmith tts <name> --voice=<v>       │
      │                                          │
      └── Recorded path ─────────────────────────┤
          reelsmith record   (the human records) │
          take-review skill ⟲ re-record in app   │
          reelsmith cut <name>                   │
                                                 ▼
                          scenes.json + voiceover.mp3
                                                 │
reelsmith mix <name> [--track=music/<file>.mp3] ─► voiceover-mix.mp3   (optional bed)
      │
html-animation skill ───► index.html
reelsmith lint <name>     must exit 0
reelsmith sheet <name>    ⟲ score every criterion 8+
      │
reelsmith sheet <name> --stills
reelsmith draft <name> ─► draft.mp4           [GATE: user watches draft + stills, says "approved"]
      │
reelsmith approve <name> --by="<who>"
reelsmith render <name> ► output.mp4
      │
publish skill: reelsmith publish <name> --notes ► publish.md     [GATE: user approves the notes]
reelsmith publish <name> --to=<t> --dry-run                      [GATE: user says post]
reelsmith publish <name> --to=<t> ► publish/<t>.json
```

## Step by step

### 1. Create the video folder

```bash
reelsmith new <name>
reelsmith new <name> --style=motion      # pick the style pack now
```

Writes `videos/<name>/script.md` from the template. Pick a short kebab-case name.

If the user has no topic, follow `config/strategy.md` (pillars, bids, 3 to 5 suggestions).

### 2. Research (research skill)

Writes `videos/<name>/research.md` with `Status: DRAFT`.

**Gate:** only the user approves. When they say "approved", change the line to `Status: APPROVED`. Never on your own judgment. Skip research only when the user supplies the full content themselves and says so.

### 3. Script (script-writing skill)

Writes `script.md`: frontmatter, `## Script` with `### Scene N` blocks, `## Scene Hints`, and `## Voice direction` when the video uses TTS performance mode.

**Gate:** the user approves the script. Nothing is voiced before that.

### 4. Delivery pass (teleprompter-prep skill)

Cues, breath marks, line splits, an easy first line. Required for a recorded take. For TTS it is optional: make sure numbers and symbols are spelled the way they should be heard.

### 5a. Voice, TTS path

**Gate:** ask the creator which voice. There is no default voice and you never pick one. Write it as `tts_voice:` in the frontmatter or pass `--voice=`.

```bash
reelsmith tts videos/<name> --voice=<v>                       # sentence mode (default)
reelsmith tts videos/<name> --voice=<v> --mode=performance    # one call with a direction prompt
reelsmith tts videos/<name> --voice=<v> --speed=1.15          # tempo (default from config)
reelsmith tts videos/<name> --voice=<v> --force               # regenerate every clip
```

- **Sentence mode:** one TTS call per line, each clip cached by a hash of provider, model, voice and text, so changing one line re-generates only that line. Clips are trimmed, joined with short gaps and sped up with ffmpeg (a speed change never re-calls the API). Word timings come from Whisper on the final voice.
- **Performance mode** (`--mode=performance` or `tts_mode: performance`): one call for the whole script. The prompt is PERFORMANCE (from `config/voice/performance.md`, or the file in `tts_performance:`), CONTEXT (the script's `## Voice direction`) and TRANSCRIPT (the spoken lines). Natural pauses are kept. Whisper transcribes the result and the script is aligned to it to split scenes. The cached audio is reused (no API call) while the prompt is unchanged, and also when only the PERFORMANCE direction text changed: the run then says `cached (direction text changed …; --force re-voices)`. A changed line, title or `## Voice direction` calls the provider again. Use `--force` to re-voice on purpose; `--offline` refuses any API call.

Writes `voiceover/sN.mp3`, `voiceover.mp3`, `scenes.json` and `voiceover/tts/meta.json` (provider, model, voice, speed, mode). Re-runs reuse the recorded voice. Other flags: `--provider`, `--model`, `--timings=auto|whisper|estimate`, `--whisper-model`, `--cta=<S>` (a silent end card).

A 401 or 403 means the TTS key in `.env` is wrong (for the built-in provider, `OPENROUTER_API_KEY`).

### 5b. Voice, recorded path

```bash
reelsmith record                     # the human opens http://localhost:4310 and records one take
reelsmith status videos/<name>       # summary of the analyzed take
reelsmith cut videos/<name>          # after the take is clear
```

The app analyzes the take itself (`reelsmith analyze videos/<name>` does it from the terminal). The take-review skill explains the flags and runs the re-record loop (the human presses R in the review view; `reelsmith rerecord` splices a clip from the terminal and exits 1 when it rejects it). `reelsmith cut` writes `voiceover/sN.mp3`, `voiceover.mp3` and `scenes.json`, the same contract as TTS.

### 6. Music bed (optional)

```bash
reelsmith mix videos/<name> --track=music/<file>.mp3
```

Writes `voiceover-mix.mp3` and `voiceover-mix.json`: voice at −16 LUFS, bed 6 dB under it, gentle ducking, a 2.5 s music tail. Pick the track by mood from `config/music.md`. Without `--track` it uses `music.defaultTrack` from `reelsmith.config.json`; with neither it exits 2 and lists the tracks in `music/`. Use `--under=4` only when the creator asks for a louder bed. Never ask the creator for a level.

`draft` and `render` pick `voiceover-mix.mp3` by themselves. If the voice was redone after the mix, they fall back to `voiceover.mp3` and print why: run `mix` again.

### 7. Animation (html-animation skill)

Writes `videos/<name>/index.html`. Rule 0 loads the style pack; every overlay binds to a word cue; every narrated scene has a `SubtitleRail`; every frame is a pure function of time.

```bash
reelsmith lint videos/<name>         # check-sync + validate-sync; must exit 0
reelsmith sheet videos/<name>        # contact sheet; read it, score, fix the 3 worst, repeat to 8+
reelsmith preview videos/<name>      # optional live playback with the voice (--lan for a phone)
```

### 8. Preview gate

```bash
reelsmith sheet videos/<name> --stills
reelsmith draft videos/<name>        # draft.mp4, about 30 s, with voiceover-mix.mp3 (if current) else voiceover.mp3
reelsmith clip videos/<name> --from=12 --to=24   # check one fixed range after feedback
```

Send the user `draft.mp4`, the contact sheet, a few stills and your scores.

**Gate:** wait for an explicit "approved". Apply feedback and ask again as often as needed.

### 9. Approve and render

```bash
reelsmith approve videos/<name> --by="<who>"
reelsmith render videos/<name>
```

`approve` fingerprints index.html, scenes.json, the runtime, every local script index.html loads (the style kit) and the images into `preview-approved.json`; it refuses (exit 2) without `--by`. `render` refuses with exit code 3 without a current approval, so any edit after approval needs a new draft and a new approval. `reelsmith approve videos/<name> --check` tells you whether the approval is still current (exit 0) or not (exit 1). Writes `output.mp4`.

### 10. Publish (publish skill)

```bash
reelsmith publish videos/<name> --notes                        # publish.md skeleton
reelsmith publish videos/<name> --to=youtube --dry-run         # prints what would be sent
reelsmith publish videos/<name> --to=youtube                   # only when the user says post
```

**Gates:** the user approves publish.md, and the user explicitly says to post. YouTube privacy defaults to private. Results land in `videos/<name>/publish/<target>.json`; a second run refuses without `--force`. The one-time YouTube sign-in is the human's: `reelsmith publish videos/<name> --to=youtube --auth`.

## Shortcut for iterations

```bash
reelsmith run videos/<name> --voice=<v>
reelsmith run videos/<name> --until=lint      # stop after a step: tts, mix, lint, sheet or draft
```

Chains tts, mix, lint, sheet (with `--stills`) and draft for a video that already has an approved script and an index.html (for example after a script edit). tts is skipped for an own-voice video (a `take.json`); mix uses `music.defaultTrack`, else the track the video was mixed with before, else it is skipped. It stops at the first failing step (a lint failure exits 1) and after the draft: it never approves and never runs the final render.

## The gates, in one list

| Gate | Who | Signal |
|---|---|---|
| Research | user | says "approved"; you flip `Status: APPROVED` |
| Script | user | approves the script in chat |
| Voice | creator | names the TTS voice |
| Linters | tool | `reelsmith lint` exits 0 |
| Contact sheet | agent | every criterion scored 8+ |
| Preview | user | says "approved" after draft.mp4 + stills; then `reelsmith approve` |
| Final render | tool | `reelsmith render` checks the approval fingerprint |
| Publish notes | user | approves publish.md |
| Posting | user | explicitly says post, after the dry run |

## Escape hatch

Every command wraps a module or a script: `pipeline/*.js` (tts, analyze, rerecord, cut, status; `node pipeline/cli.js <command> videos/<name>` is the old entry point with the same flags), `tools/*.js` (mix, lint, sheet, preview, approve), `renderer/render.js` (draft, clip, render), `app/server.js` (record). If the CLI itself fails, run the script with `node`; `docs/cli.md` has the mapping. If a bare `node` fails in a non-interactive shell (an nvm profile issue), call node by its full path.
