# Reelsmith: agent context

Reelsmith turns a markdown script into a finished vertical short: a voice, word-synced subtitles, motion graphics, an MP4. You (the coding agent) do the creative work through the skills in `skills/`. The `reelsmith` CLI does the mechanical work: TTS or take analysis, word timings, linting, contact sheets, drafts, the final render and publishing.

**This repo is itself a Reelsmith project.** `videos/` holds the end-to-end fixture (`fixture-e2e`) and the ten tutorial videos (`tut-01` to `tut-10`). `config/` is this repo's own project config. `reelsmith.config.json` at the root is its project config. Everything below applies here and in any project made with `reelsmith init`.

**Start with `skills/reelsmith-pipeline/SKILL.md`** whenever someone asks for a video. It has the order of commands and every gate.

## Skills

`.claude/skills` is a symlink to `skills/`, so Claude Code loads them automatically.

| Trigger | Skill |
|---|---|
| "make me a video", "make a video about X", "what's next", "render it" | `skills/reelsmith-pipeline/SKILL.md`: the end-to-end map, commands and gates |
| "pick a topic", "what should I make next" | Read `config/strategy.md` and follow its workflow (pillars, bids, 3 to 5 suggestions) |
| "research this", any topic or URL before scripting | `skills/research/SKILL.md`: writes `research.md` with `Status: DRAFT` and `## Angle options`. No script without an approved research.md |
| "write me a script", "script this" | `skills/script-writing/SKILL.md`: simple linear explainer, 130 to 170 spoken words, writes `script.md` with `## Scene Hints` |
| "prep this for the teleprompter", "get this ready to record" | `skills/teleprompter-prep/SKILL.md`: cues, breath marks, line splits, `## Delivery notes` |
| "review my take", "what should I re-record" | `skills/take-review/SKILL.md`: reads `take.json`, runs the re-record loop, then `reelsmith cut` |
| writing or editing `videos/<name>/index.html` | `skills/html-animation/SKILL.md`: Rule 0 loads the style pack, then word cues, `SubtitleRail`, determinism, lint, contact-sheet loop, preview gate |
| "write the publish notes", "post it", "upload this" | `skills/publish/SKILL.md`: `publish.md`, then `reelsmith publish` (dry run first, only when asked) |
| "score this script", "what gets views" | `skills/market-research/SKILL.md`: optional, only when asked; needs `config/market.md` |

## Pipeline

```
reelsmith new <name> ───────────► videos/<name>/script.md (template)
      │
research skill ─────────────────► research.md                 [approve]
      │
script-writing skill ───────────► script.md                   [approve]
      │
teleprompter-prep skill ────────► script.md (delivery pass)   [approve; optional for TTS]
      │
      ├── TTS: ASK the creator which voice, then
      │   reelsmith tts <name> --voice=<v> [--mode=performance]
      │
      └── Own voice: reelsmith record  (human records at http://localhost:4310)
          take-review skill ⟲ re-record flagged lines in the app
          reelsmith cut <name>
                        │
                        ▼
          voiceover/sN.mp3 + voiceover.mp3 + scenes.json
                        │
reelsmith mix <name> --track=music/<file>.mp3 ─► voiceover-mix.mp3 (optional)
      │
html-animation skill ───────────► index.html
reelsmith lint <name>             must exit 0
reelsmith sheet <name>            ⟲ score 1 to 10, fix the 3 worst, until every score is 8+
      │
reelsmith sheet <name> --stills + reelsmith draft <name> ─► stills + draft.mp4
SHOW BOTH TO THE USER                                           [approve] ⟲ feedback
(one scene changed? reelsmith clip <name> --from=S --to=S)
      │
reelsmith approve <name> --by="<who>" ─► preview-approved.json
reelsmith render <name> ────────► output.mp4 (refuses without a current approval)
      │
publish skill: reelsmith publish <name> --notes ─► publish.md  [approve]
reelsmith publish <name> --to=<target> --dry-run, then without the flag  [explicit go]
```

## Gates

Each `[approve]` is a human gate. Do not skip one, and do not move on until the user has signed off on the previous artifact.

- **Research:** the research skill writes `Status: DRAFT`. Flip it to `Status: APPROVED` only after the user says "approved", never on your own judgment.
- **Script:** the user approves `script.md` before anything is voiced.
- **Voice:** there is no default TTS voice. Ask the creator which voice, then write `tts_voice:` or pass `--voice=`. Never pick one yourself.
- **Linters:** `reelsmith lint` exits 0 before any preview.
- **Contact sheet:** every criterion scored 8 or higher (html-animation Rule 5).
- **Preview:** never start `reelsmith render` on your own judgment. Send the user `draft.mp4`, the contact sheet and stills, and ask. Only after an explicit "approved", run `reelsmith approve`, then `reelsmith render`. Any edit after approval invalidates it (the fingerprint covers index.html, scenes.json, the runtime, the style kit and the images). Draft and clip renders skip the gate.
- **Publish:** the user approves `publish.md`; posting happens only when the user explicitly says so, always after a `--dry-run`. YouTube privacy defaults to private.

## Setup

```bash
# 1. System tools: Node 22+ (18 minimum), ffmpeg, Python 3.11 with Whisper
brew install node ffmpeg python@3.11          # macOS; Ubuntu: apt install ffmpeg python3.11
python3.11 -m pip install openai-whisper

# 2. Node deps and the headless browser
npm install
npx playwright install chromium               # Linux: sudo npx playwright install-deps chromium
npm link                                      # optional: puts `reelsmith` on your PATH (clone mode)

# 3. Keys
cp .env.example .env                          # OPENROUTER_API_KEY for TTS; publish tokens later

# 4. Check
reelsmith doctor
```

Without `npm link`, run the CLI as `node bin/reelsmith.js <command>`. In a project made by `reelsmith init`, run it as `npx reelsmith <command>`.

**Effort** (Claude Code `/model`): high or max when writing a new `index.html` or script, medium for small fixes and re-renders.

## Commands

`<video>` accepts `videos/<name>`, `<name>` or an absolute path. Commands work from any folder inside the project. Every command takes `--help`; structured ones take `--json`. Exit codes: 0 ok, 1 error, 2 usage, 3 gate refused.

| Command | Does |
|---|---|
| `reelsmith init [dir] [--link] [--style=reflective] [--no-install]` | scaffold a new project |
| `reelsmith doctor [--json]` | check node, ffmpeg, python + whisper, Playwright Chromium, keys, every plugin |
| `reelsmith new <name> [--style=…] [--voice=…]` | create `videos/<name>/script.md` from the template |
| `reelsmith tts <video> --voice=<v> [--mode=sentence\|performance] [--model=…] [--speed=…] [--force]` | script → voice + word timings → `scenes.json` |
| `reelsmith record [--port=…]` | start the teleprompter app (default port 4310) |
| `reelsmith analyze <video> [--take=takes/take-01] [--no-jev]` | recorded take → `take.json` |
| `reelsmith rerecord <video> --sentence=s2.1 --clip=takes/rr-s2.1-1` | splice a re-recorded line into the take |
| `reelsmith cut <video>` | finalize the take → `scenes.json` + `voiceover.mp3` |
| `reelsmith status <video>` | print the `take.json` summary |
| `reelsmith mix <video> [--track=music/<file>.mp3] [--under=6]` | music bed → `voiceover-mix.mp3` |
| `reelsmith lint <video>` | check-sync + validate-sync; non-zero exit on failure |
| `reelsmith sheet <video> [--stills]` | contact sheet → `frames/contact-sheet.png` (+ `frames/stills/*.jpg`) |
| `reelsmith preview <video> [--lan]` | live browser playback with the voice; `--lan` prints a `/qr` link for a phone |
| `reelsmith draft <video> [--audio=…]` | fast low-res render → `draft.mp4` (no gate) |
| `reelsmith clip <video> --from=S --to=S` | render one range → `clip-<S>s-<S>s.mp4` (no gate) |
| `reelsmith approve <video> --by=<who>` | record the preview approval fingerprint |
| `reelsmith render <video> [--fps=30] [--shards=N] [--encoder=auto\|videotoolbox\|x264] [--audio=…]` | final render → `output.mp4` (gate enforced, exit 3) |
| `reelsmith publish <video> --to=<target>[,<target>] [--dry-run] [--notes]` | run publish plugins; `--notes` only writes the `publish.md` skeleton |
| `reelsmith plugins [--json]` | list loaded plugins with kind, version, source, status |
| `reelsmith styles` | list style packs |
| `reelsmith run <video> [--voice=…] [--until=…]` | tts → mix → lint → sheet → draft; never approves or renders |

Escape hatch: each command wraps a script (`pipeline/cli.js`, `tools/*.js`, `renderer/render.js`, `app/server.js`). `docs/cli.md` has the mapping and every flag.

**Audio defaults** are in `config/audio.md` (TTS 1.15x, voice −16 LUFS, bed 6 dB under). **Music:** `config/music.md`. The bed sits 6 dB under the voice, measured per track. Do not ask the creator for a level and never use a fixed dB offset. `--under=4` only when the creator asks. Pick the track by mood.

## `script.md` format

Full reference: `docs/script-format.md`.

```markdown
---
title: Reelsmith in 60 seconds
topic: devtools          # pillar slug from config/strategy.md
date: 2026-09-30
wpm: 170                 # optional: teleprompter scroll speed
style: motion            # optional: style pack; else reelsmith.config.json "style"
tts_voice: Leda          # TTS only: the voice the creator picked (no default)
tts_mode: performance    # optional: sentence (default) | performance
series: my-series        # optional free metadata
episode: 1               # optional free metadata
---

## Script

### Scene 1
You write one hundred and fifty words.
You get a finished vertical video.

### Scene 2
> say: "one hundred", not "a hundred"
At 100 input tokens per output token, that prompt is most of your bill.

## Voice direction
Who is talking to whom, the tone, which lines to land (performance mode only).

## Scene Hints
- Scene 1 (hook): big numeral counts up. Primitive: Counter
```

- `### Scene N` blocks, numbered from 1 with no gaps, one sentence per line. A line is the re-record unit, id `s<scene>.<line>`. Blank lines are ignored.
- Lines starting with `>` are notes for a human reader (pronunciation, `[pause]`, `[breath]`). Never spoken, never aligned, never sent to TTS. A cue attaches to the sentence **below** it. A `>` line outside any scene is a file-level note.
- Any heading other than `Scene N` ends the scene. Sections after `## Script` (`## Voice direction`, `## Scene Hints`, `## Score`, `## Delivery notes`, `## Blueprint`) are ignored by the parser. Never put a `Scene N` heading in them: the parser treats any `Scene N` heading as spoken.
- Frontmatter: `title`, `topic`, `date`, optional `wpm`, `style`, `tts_voice`, `tts_mode`, `tts_model`, `tts_speed`, `tts_performance` (path to a PERFORMANCE file). `series` and `episode` are free metadata. Flat `key: value` lines only; a trailing `# comment` is stripped.
- Precedence per setting: CLI flag > script.md frontmatter > the voice the video last used (`voiceover/tts/meta.json`) > env (`TTS_VOICE`, …) > `reelsmith.config.json` > built-in defaults.
- Word counts mean spoken words (digits and acronyms as read aloud). For TTS, write numbers and symbols the way they should be heard.

## HTML rules

- React 18 + Babel in the browser, no build step. The runtime is `../../runtime/animations.jsx`; the style's kit loads right after it (`../../styles/motion/kit.jsx`, `../../styles/reflective/kit.jsx`). Use the kit's components and helpers; do not rewrite them. Motion scenes use the kit's `SceneRoot` as their root.
- `<Stage width={720} height={1280} scenesSrc="scenes.json" persistKey="…">`. No `duration` prop, no `TOTAL`. `persistKey` is unique per video.
- One `<Sprite {...useSceneWindow(N)}>` per scene. Timing comes from `scenes.json`.
- **Every narrated scene has `<SubtitleRail sceneIdx={N} … />` as the last child of its root element**, with the style's props, written out literally (the linter searches for it). Only a silent tech-news `cta-end` card is exempt.
- **Every overlay that shows a spoken thing binds to `useWordCue(N, "phrase")`.** No hand-picked delays over 0.6 s.
- **Every frame is a pure function of time.** No `Math.random` (use `seededRandom`), timers, rAF, wall clock, CSS transitions or animations. Compute from `localTime` with `spring`, `track`, `interpolate`. `reelsmith lint` enforces it.
- **Safe area:** every text line keeps 48 px or more from both sides and stays 520 px wide or less. The contact sheet lists violations; the list must be empty before the preview gate.
- **No banned defaults** (`styles/design.md`): no everything-fades-in, no empty middle band, something new every 2 to 4 s.
- Images: relative to the video folder. Photo-led (reflective) videos keep photos in `images/` with `images/CREDITS.md`. The approval fingerprint hashes the video root and `images/**`.
- Endings: reflective and motion end on a narrated closing scene. Tech-news ends with a silent `cta-end` card (never narrated).

## Technical reference

| | |
|---|---|
| Canvas | 720×1280, 9:16, 30 fps |
| Styles | `reflective` (default), `tech-news`, `motion`. Packs in `styles/<name>/` (`STYLE.md`, optional `kit.jsx`, `reference/`); shared base rules in `styles/design.md` |
| Style choice | `script.md` `style:`, else `reelsmith.config.json` `style` |
| Duration | from `scenes.json` (Σ `dur`); never hardcode. Target 45 to 65 s |
| Voice | TTS via a `tts` plugin (built in: OpenRouter, `google/gemini-3.8-flash-tts`, 1.15x) or the creator's own take (`reelsmith record` → `cut`) |
| Word timings | Whisper (`stt` plugin, built in: local `openai-whisper`, model `turbo`) |
| Cheap decisions | Jev AI via OpenRouter (`typesafe/jev-1.13`) for filler classification in take analysis; optional, falls back to rules |
| Renderer | Playwright headless Chromium, sharded, JPEG frames piped into ffmpeg (H.264); `docs/fast-render.md` |
| Plugins | kinds `tts`, `stt`, `style`, `publish`; `reelsmith plugins`; contract in `docs/plugins.md` |
| Config | `reelsmith.config.json` (project), `.env` (keys), `config/*.md` (agent-facing defaults), `~/.config/reelsmith/` (publish credentials; `REELSMITH_CONFIG_DIR` overrides) |

## Working on the framework itself

- Tests: `node pipeline/test/run-tests.js` (or `npm test`). About 60 s; needs Whisper, Chromium, ffmpeg and network.
- The contracts every part must keep are in `docs/framework-spec.md`. Take analysis, alignment and the cut are in `docs/spec.md`. The renderer design is `docs/fast-render.md`. Bugs fixed and lessons learned: `docs/learnings.md`.
- Built-in plugins live in `plugins/`, style packs in `styles/`, the scaffold for new projects in `templates/project/`.
- The docs site is built from `docs/*.md` by `node tools/build-site.js` into `site/docs/`.

## Critical gotchas

Details in `docs/learnings.md`.

1. **If a bare `node` fails** in a non-interactive shell (an nvm profile that doesn't load), call node by its full path (for example `~/.nvm/versions/node/<version>/bin/node`). Scripts that spawn node use `process.execPath`, never `node` from PATH.
2. **Python:** use the Python that has `openai-whisper` installed. `reelsmith doctor` shows which one it found; set `REELSMITH_PYTHON` to force one. Never assume bare `python3` is the right one.
3. **Serve from the project root.** `index.html` loads `../../runtime/animations.jsx`, so every tool serves the project root over HTTP, not the video folder. `file://` blocks the script loads.
4. **`waitUntil: 'load'`**, not `networkidle`. Fonts and CDN scripts keep the network busy forever.
5. **Two rAF cycles** after `setTime(t)` before a `page.screenshot`: the first processes the React update, the second paints. The contact sheet does this. The renderer's CDP `Page.captureScreenshot` path needs only one (measured pixel-identical, `docs/fast-render.md`).
6. **Render mode kills CSS transitions and animations** (`?render=1`, used by the renderer and the contact sheet). They run on the wall clock, so anything that only moves via CSS is static in the MP4.
