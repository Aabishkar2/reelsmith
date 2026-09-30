# Reelsmith

**Script in, short out. A plugin-based framework for agent-made short videos.**

You write a 150-word script in markdown. A coding agent like Claude Code turns it into a finished vertical video: a voice, karaoke subtitles synced to every word, motion graphics, and an MP4 ready to post. Reelsmith is the pipeline, the rules and the skills that make the agent's output good and repeatable.

Every step is a plain file you can read and diff. Every provider is a plugin you can swap. Every render is deterministic, and nothing is rendered or posted until a human says so.

## What you get

| Step | Result |
|---|---|
| Voice | A TTS voice (one call per line, or one "performance" call for the whole script) or your own recording from the built-in teleprompter |
| Words | Word-level timings from Whisper, aligned to your script |
| Subtitles | Karaoke-style subtitles that highlight each word as it is spoken |
| Motion graphics | One React/Babel `index.html` per video, every overlay bound to the spoken word that introduces it |
| MP4 | A 720×1280 H.264 video, rendered in parallel headless browsers in about 90 s for a 90 s short |
| Publish | YouTube, Instagram/Facebook Reels and Discord, dry run first |

## How it works

```
script.md ──► voice ──────────► words[] ──────────► index.html ──────► output.mp4
  markdown    TTS plugin or      Whisper word        React scenes,      Playwright frames
  you or the  your own take      timings, aligned    useWordCue +       piped into ffmpeg
  agent write (reelsmith tts /   to the script       SubtitleRail       (reelsmith render)
              record + cut)      (scenes.json)       (agent writes)
```

Between the animation and the render sit four quality gates: the sync linters, a contact sheet the agent scores, a low-res draft you watch, and an approval fingerprint the renderer checks.

## Quick start

### Option A: clone the repo (the repo is the project)

```bash
git clone https://github.com/Aabishkar2/reelsmith.git
cd reelsmith
npm install
npx playwright install chromium
cp .env.example .env          # add OPENROUTER_API_KEY for TTS
node bin/reelsmith.js doctor
```

In a clone, the CLI is `node bin/reelsmith.js <command>` (run `npm link` once if you want a `reelsmith` command on your PATH).

### Option B: a new project with `init`

```bash
npx github:Aabishkar2/reelsmith init my-channel
cd my-channel
cp .env.example .env          # add OPENROUTER_API_KEY for TTS
npx reelsmith doctor
```

The package is not on npm yet, so `init` runs straight from GitHub; `npx reelsmith init my-channel` works once it is published. `init` adds `reelsmith` as a local dependency, so inside the project every command runs as `npx reelsmith <command>`.

`reelsmith doctor` checks node, ffmpeg, the Python that has Whisper, Playwright Chromium, the project, your keys and every plugin, and says exactly what is missing.

## Your first video in six commands

These docs write `reelsmith <command>`: in a project that is `npx reelsmith <command>`, in a clone `node bin/reelsmith.js <command>`.

```bash
reelsmith new prompt-caching                         # videos/prompt-caching/script.md
# write the script, or ask your agent to (script-writing skill)
reelsmith tts prompt-caching --voice=Leda            # voice + word timings
# the agent writes index.html (html-animation skill)
reelsmith sheet prompt-caching --stills              # contact sheet + full-size stills
reelsmith draft prompt-caching                       # low-res preview
reelsmith approve prompt-caching --by="you"          # after you watch the draft
reelsmith render prompt-caching                      # output.mp4
```

`reelsmith render` refuses to run (exit code 3) until the preview is approved, and the approval expires when the animation, the timings, the runtime, the style kit or the images change. `reelsmith run prompt-caching --voice=Leda` chains tts, mix, lint, sheet and draft for the iterations in between.

## How the agent drives it

Reelsmith is built for coding agents. The repo (and every project made by `init`) contains:

- **`CLAUDE.md`**: what the project is, the pipeline, the commands and the gates.
- **Skills** in `skills/` (loaded by Claude Code through `.claude/skills`): `reelsmith-pipeline`, `research`, `script-writing`, `teleprompter-prep`, `take-review`, `html-animation`, `publish`, `market-research`.
- **Markdown config** the agent reads: `config/audio.md`, `config/music.md`, `config/voice/performance.md`, `config/strategy.md`, and one `STYLE.md` per style pack.

Open the folder in Claude Code and say "make me a video about prompt caching". The agent researches, writes the script, voices it, builds the animation, checks its own frames, and stops for your approval at every gate: research, script, voice choice, preview, publish.

See [docs/agent-workflow.md](docs/agent-workflow.md).

## Tutorial series

Ten shorts made with Reelsmith itself, in the `motion` style. Each folder has the `script.md`, the `index.html` and the `scenes.json`. [docs/tutorials.md](docs/tutorials.md) has the length, a summary and the commands of each episode.

| # | Episode | What it covers | Folder |
|---|---|---|---|
| 1 | Reelsmith in 60 seconds | What Reelsmith is: script, voice, timings, animation, MP4 | [`videos/tut-01-what-is-reelsmith/`](videos/tut-01-what-is-reelsmith/) |
| 2 | Install Reelsmith in 3 minutes | Node, ffmpeg, Python, `init`, the `.env` key, `doctor` | [`videos/tut-02-install/`](videos/tut-02-install/) |
| 3 | Your first video, start to finish | Six commands from a blank folder to `output.mp4` | [`videos/tut-03-first-video/`](videos/tut-03-first-video/) |
| 4 | script.md, the one file that matters | Frontmatter, scenes, `>` cues, scene hints | [`videos/tut-04-script-format/`](videos/tut-04-script-format/) |
| 5 | Voice, TTS or your own take | Sentence mode, performance mode, recording and the cut | [`videos/tut-05-voice/`](videos/tut-05-voice/) |
| 6 | How the animation stays in sync | `useWordCue`, pure-function frames, `SubtitleRail`, the linters | [`videos/tut-06-animation/`](videos/tut-06-animation/) |
| 7 | Styles and style packs | Reflective, tech-news, motion, and your own pack | [`videos/tut-07-styles/`](videos/tut-07-styles/) |
| 8 | Plugins, bring your own everything | The four plugin kinds and the contract | [`videos/tut-08-plugins/`](videos/tut-08-plugins/) |
| 9 | The quality gates that stop bad videos | Lint, contact sheet, draft, approval | [`videos/tut-09-quality-gates/`](videos/tut-09-quality-gates/) |
| 10 | Publish, without surprises | `publish.md`, dry runs, YouTube, Meta, Discord | [`videos/tut-10-publish/`](videos/tut-10-publish/) |

## Plugins

Everything that talks to the outside world is a plugin: a folder with a `plugin.js` that exports a `name`, a `kind` and a few functions. The built-ins load through the same registry as yours.

| Kind | Does | Built in | You implement |
|---|---|---|---|
| `tts` | text → audio | `tts-openrouter` | `synthesize()`, optional `synthesizePerformance()` |
| `stt` | audio → word timings | `stt-whisper` (local) | `transcribe()` |
| `style` | a visual look | `reflective`, `tech-news`, `motion` | a `STYLE.md` (+ optional `kit.jsx`) |
| `publish` | sends a finished video somewhere | `publish-youtube`, `publish-meta`, `publish-discord` | `publish()`, `check()` |

Drop a plugin in `plugins/` or list it in `reelsmith.config.json` `"plugins"`, then run `reelsmith plugins`. See [docs/plugins.md](docs/plugins.md) for the contract and a complete ElevenLabs example.

## Styles

| Style | Look | Good for |
|---|---|---|
| `reflective` (default) | Warm near-black and gold, Fraunces + Manrope, graded photos with Ken Burns | Essays, calm explainers |
| `tech-news` | Near-black, one red accent, Barlow Condensed, designed-from-code scenes | Fast news breakdowns |
| `motion` | Ink, violet and cyan, Sora + Inter + JetBrains Mono, terminals, code cards and diagrams | Developer tutorials and teaching |

Pick one per video with `style:` in `script.md`, or set a project default in `reelsmith.config.json`. See [docs/styles.md](docs/styles.md).

## Requirements

| Tool | Version | Needed for |
|---|---|---|
| Node.js | 22 recommended, 20 minimum | everything |
| ffmpeg + ffprobe | any recent | audio, mixing, rendering |
| Playwright Chromium | installed with `npx playwright install chromium` | contact sheets, drafts, renders |
| Python + `openai-whisper` | Python 3.11 recommended | word timings (TTS performance mode, recorded takes, exact TTS cues) |
| OpenRouter API key | | the built-in TTS provider (not needed for your own voice) |

macOS and Linux are supported. Windows should mostly work but is not tested.

## Project layout

```
bin/reelsmith.js         the CLI
core/                    config, plugin registry, project discovery, env resolution
pipeline/                TTS, performance mode, take analysis, alignment, the cut
renderer/render.js       the sharded renderer
runtime/animations.jsx   the browser animation runtime
tools/                   linters, contact sheet, preview, approval, music mix
app/                     the teleprompter recording app
plugins/                 built-in plugins (tts, stt, publish)
styles/                  style packs + shared design rules
skills/                  agent skills (.claude/skills links here)
templates/project/       what `reelsmith init` copies
config/                  this repo's own agent-facing config
videos/                  the fixture and the ten tutorials
docs/  site/             documentation and the docs site
```

## Docs

| Page | |
|---|---|
| [Getting started](docs/getting-started.md) | install, first video |
| [Concepts](docs/concepts.md) | the pipeline, the data contracts, the gates |
| [Script format](docs/script-format.md) | everything `script.md` can hold |
| [Voice](docs/voice.md) | TTS sentence and performance modes, recording your own take |
| [Animation](docs/animation.md) | the runtime API, `useWordCue`, `SubtitleRail`, determinism |
| [Styles](docs/styles.md) | the three packs and how to make your own |
| [Plugins](docs/plugins.md) | the plugin contract with worked examples |
| [CLI reference](docs/cli.md) | every command and flag |
| [Publishing](docs/publishing.md) | YouTube, Meta and Discord setup |
| [Agent workflow](docs/agent-workflow.md) | how Claude Code drives the pipeline |
| [Architecture](docs/architecture.md) | directory map and data contracts |
| [Fast render](docs/fast-render.md) | the sharded renderer's design and numbers |
| [Tutorials](docs/tutorials.md) | the ten tutorial episodes: what each teaches and the commands it shows |
| [FAQ](docs/faq.md) | cost, privacy, troubleshooting |

The same pages are published as a site from `site/` (built by `node tools/build-site.js`).

## FAQ

**What does a video cost?** With the built-in TTS provider (Gemini TTS through OpenRouter), about $0.01 per minute of voice. Your own voice is free. Whisper, the renderer and everything else run locally.

**What leaves my machine?** Only the TTS request (your script text), the optional Jev AI filler check on a recorded take (short word snippets, off with `--no-jev`), and, when you publish, the video and its metadata to the targets you name. Recording, transcription, analysis and rendering are local.

**Do I need Claude Code?** No. Every step is a CLI command and a plain file. The agent makes the creative steps (script, animation) fast; you can write them by hand.

**Can I use my own voice?** Yes. `reelsmith record` opens a teleprompter in your browser, records one take, flags fillers and mistakes, and lets you re-record single lines.

More in [docs/faq.md](docs/faq.md).

## Credits

- Background music in the examples: "Clean Soul", "Voxel Revolution" and "Digital Lemonade" by Kevin MacLeod ([incompetech.com](https://incompetech.com)), licensed under [Creative Commons: By Attribution 4.0](https://creativecommons.org/licenses/by/4.0/). "Intergalactic" by Alex Jones / Xander Jones is from the YouTube Audio Library. The mp3 files are not in the repo; `music/CREDITS.md` lists the sources and the credit line each video must carry.
- Built on [React](https://react.dev), [Babel](https://babeljs.io), [Playwright](https://playwright.dev), [OpenAI Whisper](https://github.com/openai/whisper) and [FFmpeg](https://ffmpeg.org).

## License

[MIT](LICENSE) © 2026 Aabishkar Wagle
