# Agent instructions for this Reelsmith project

This project makes vertical short videos with Reelsmith. You (the coding agent) do the creative work through the skills in `.claude/skills/`. The `reelsmith` CLI does the mechanical work.

**Start with `.claude/skills/reelsmith-pipeline/SKILL.md`** whenever someone asks for a video. It has the order of commands and every gate.

## Layout

| Path | What |
|---|---|
| `videos/<name>/` | one folder per video: `script.md`, `research.md`, `scenes.json`, `index.html`, `output.mp4`, `publish.md` |
| `config/` | agent-facing defaults: `audio.md`, `music.md`, `voice/performance.md`, `fillers.json`, and `strategy.md` for topic choice |
| `styles/` | style packs (`<name>/STYLE.md`, optional `kit.jsx`). A real folder: the built-in packs and `design.md` are symlinks into `node_modules/reelsmith/styles/`; your own packs are normal folders beside them |
| `runtime/` | the animation runtime `index.html` loads; a symlink into `node_modules/reelsmith/runtime` |
| `plugins/` | your own plugins (loaded automatically) |
| `music/` | background tracks, `CREDITS.md`, and `download.sh` to fetch the default tracks |
| `reelsmith.config.json` | project settings: default style, TTS provider and model, music level, publish targets |
| `.env` | API keys and tokens (never commit it) |

Framework docs: `node_modules/reelsmith/docs/` (`cli.md`, `script-format.md`, `animation.md`, `plugins.md`, `publishing.md`).

## Commands

Run them from anywhere in the project with `npx reelsmith <command>` (the CLI is a local dependency). `<video>` is `<name>`, `videos/<name>` or a path. `npx reelsmith <command> --help` lists every flag. Exit codes: 0 ok, 1 error, 2 usage, 3 gate refused.

```bash
npx reelsmith doctor                                # what is missing on this machine
npx reelsmith new <name> [--style=motion]           # videos/<name>/script.md from the template
npx reelsmith tts <video> --voice=<v>               # TTS voice + word timings → scenes.json
npx reelsmith tts <video> --voice=<v> --mode=performance
npx reelsmith record                                # teleprompter at http://localhost:4310 (own voice)
npx reelsmith status <video>                        # take summary
npx reelsmith rerecord <video> --sentence=s2.1 --clip=takes/rr-s2.1-1   # exits 1 when the clip is rejected
npx reelsmith cut <video>                           # finalize the take → scenes.json + voiceover.mp3
npx reelsmith mix <video> --track=music/<file>.mp3  # music bed → voiceover-mix.mp3 (no --track: music.defaultTrack)
npx reelsmith lint <video>                          # must exit 0
npx reelsmith sheet <video> --stills                # contact sheet + full-size stills
npx reelsmith preview <video> [--lan]               # live playback with the voice
npx reelsmith draft <video>                         # draft.mp4 for the preview gate
npx reelsmith clip <video> --from=S --to=S          # re-check one range
npx reelsmith approve <video> --by="<who>"          # only after the user approves the draft
npx reelsmith approve <video> --check               # is the approval still current? (exit 0 / 1)
npx reelsmith render <video>                        # output.mp4 (refuses without approval, exit 3)
npx reelsmith run <video> --voice=<v>               # tts → mix → lint → sheet → draft (--until=<step>)
npx reelsmith publish <video> --notes               # publish.md skeleton
npx reelsmith publish <video> --to=youtube --dry-run
npx reelsmith publish <video> --to=youtube --auth   # the human signs in to YouTube once
npx reelsmith plugins                               # loaded plugins
npx reelsmith styles                                # available style packs
```

`draft` and `render` use `voiceover-mix.mp3` when it matches the current voice, else `voiceover.mp3` (they print which). Any edit to `index.html`, `scenes.json`, the runtime, a style kit or the images after `approve` needs a new approval.

## Gates (never skip)

1. **Research:** `research.md` is written as `Status: DRAFT`. Flip it to `Status: APPROVED` only after the user says "approved".
2. **Script:** the user approves `script.md` before anything is voiced.
3. **Voice:** there is no default TTS voice. Ask the creator which voice.
4. **Lint:** `reelsmith lint` exits 0.
5. **Contact sheet:** every criterion scored 8 or higher.
6. **Preview:** send the user `draft.mp4`, the contact sheet and stills. Only after an explicit "approved": `reelsmith approve`, then `reelsmith render`.
7. **Publish:** the user approves `publish.md`, and posting happens only when the user says so, after a `--dry-run`. YouTube privacy defaults to private (`--privacy`, else `privacy:` in publish.md, else `publish.targets.youtube.privacy`, else private).

## Rules that always apply

- `script.md`: `### Scene N` blocks, one sentence per line, `>` lines are reader notes (never spoken, attach to the line below). Style comes from frontmatter `style:`, else `reelsmith.config.json` `style`.
- `index.html`: load `../../runtime/animations.jsx` (and the style's `kit.jsx` after it); every overlay binds to `useWordCue`; every narrated scene ends with a `SubtitleRail`; every frame is a pure function of time (no `Math.random`, timers, rAF, wall clock, CSS transitions).
- Audio: follow `config/audio.md` and `config/music.md` (bed 6 dB under the voice). Do not ask the creator for levels.
- Your own style pack: `cp -RL styles/motion styles/<name>`, then edit it. Never edit a linked built-in pack; that edits the installed framework.
- Never commit `.env` or anything from `~/.config/reelsmith/`.

## If something fails

- `npx reelsmith doctor` first.
- If a bare `node` fails in a non-interactive shell, call node by its full path. Reelsmith needs Node 20 or newer (22 recommended).
- Whisper needs the Python that has `openai-whisper`; `doctor` shows which one it found, `REELSMITH_PYTHON` forces one.
