# Getting started

This page takes you from nothing to a rendered short. It takes about ten minutes, most of it installing tools.

## 1. Install the system tools

You need four things:

| Tool | Why | Check |
|---|---|---|
| Node.js 22 (18 is the minimum) | runs everything | `node --version` |
| ffmpeg and ffprobe | audio processing, mixing, encoding | `ffmpeg -version` |
| Python 3.11 with `openai-whisper` | word timings | `python3.11 -c "import whisper"` |
| Playwright Chromium | contact sheets, drafts, renders | installed in step 2 |

On macOS:

```bash
brew install node ffmpeg python@3.11
python3.11 -m pip install openai-whisper
```

On Ubuntu:

```bash
sudo apt install ffmpeg python3.11 python3.11-venv
python3.11 -m pip install openai-whisper
```

Whisper downloads its `turbo` model (about 1.5 GB) the first time it runs.

Any Python that has `openai-whisper` works. `reelsmith doctor` shows which one it found. To force one, set `REELSMITH_PYTHON`:

```bash
export REELSMITH_PYTHON=/path/to/python
```

## 2. Get Reelsmith

Pick one of two modes.

### Clone mode: the repo is your project

Good for trying it out, or for changing the framework itself.

```bash
git clone https://github.com/Aabishkar2/reelsmith.git
cd reelsmith
npm install
npx playwright install chromium
npm link
```

`npm link` puts the `reelsmith` command on your PATH. Without it, run `node bin/reelsmith.js <command>` from the repo.

The repo already contains a working project: `videos/fixture-e2e` and ten tutorial videos.

### Package mode: a fresh project

Good for a channel of your own. `init` creates the project folder and installs the framework into it.

```bash
npx reelsmith init my-channel
cd my-channel
```

Until the package is published on npm, run it from GitHub:

```bash
npx github:Aabishkar2/reelsmith init my-channel
```

`init` writes:

```
my-channel/
  reelsmith.config.json   project settings
  .env.example            keys to fill in
  .gitignore
  CLAUDE.md  README.md    instructions for your agent and for you
  config/                 audio.md, music.md, voice/performance.md, fillers.json
  videos/                 your videos
  music/CREDITS.md        background tracks and their credits
  plugins/                your own plugins
  .claude/skills/         the agent skills
  runtime  styles         symlinks into the installed framework
```

It also runs `npm init -y` if needed, adds the `reelsmith` dependency and installs Playwright Chromium.

| Flag | Effect |
|---|---|
| `--style=<name>` | default style pack for the project (default `reflective`) |
| `--link` | link a local checkout of the framework instead of installing it (for framework development) |
| `--no-install` | skip the dependency install and the Chromium download |

In package mode the CLI is a local dependency. Run it as `npx reelsmith <command>`. These docs write `reelsmith <command>` for short.

## 3. Add your keys

```bash
cp .env.example .env
```

Open `.env` and set:

| Key | Needed for |
|---|---|
| `OPENROUTER_API_KEY` | the built-in TTS voice. Skip it if you only record your own voice |

Publish tokens (YouTube, Meta, Discord) come later. See [Publishing](publishing.md).

## 4. Run the doctor

```bash
reelsmith doctor
```

It checks node, ffmpeg, the Python with Whisper, Playwright Chromium, each key and every plugin's own check, and prints what is missing and how to fix it. Optional items (for example publish tokens) are marked as optional. `reelsmith doctor --json` prints the same report as JSON.

## 5. Make your first video

Six commands, plus two files that you or your agent write.

```bash
reelsmith new prompt-caching
```

Creates `videos/prompt-caching/script.md` from the template. Add `--style=motion` to pick a style pack, or `--voice=<name>` to fill in the TTS voice.

Write the script: one sentence per line, grouped into `### Scene N` blocks. Or ask your agent, which uses the script-writing skill. The format is in [Script format](script-format.md).

```bash
reelsmith tts videos/prompt-caching --voice=Leda
```

Synthesizes the voice, runs Whisper for word timings and writes `voiceover.mp3` plus `scenes.json`. Voice names depend on the TTS provider; the built-in one uses the Gemini TTS voices. There is no default voice: you choose one per video.

Now `videos/prompt-caching/index.html`, the animation. Your agent writes it with the html-animation skill. Every overlay is bound to a spoken word. See [Animation](animation.md).

```bash
reelsmith sheet videos/prompt-caching
```

Writes `frames/contact-sheet.png`: hook frames and three frames per scene, each labelled with the words being spoken. Look at it.

```bash
reelsmith draft videos/prompt-caching
```

Renders `draft.mp4` in about 30 seconds: 15 fps, 0.75× size, with the voice. Watch it, give feedback, iterate.

```bash
reelsmith approve videos/prompt-caching --by="you"
reelsmith render videos/prompt-caching
```

`approve` records a fingerprint of the animation, the timings and the images. `render` writes `output.mp4` and refuses (exit code 3) without a current approval.

Optional steps you will want soon:

```bash
reelsmith mix videos/prompt-caching --track=music/clean-soul.mp3   # music bed 6 dB under the voice
reelsmith lint videos/prompt-caching                               # the sync linters
reelsmith preview videos/prompt-caching                            # live playback in the browser
```

## 6. Or let the agent drive

Open the project in Claude Code and say:

> make me a video about prompt caching

The agent follows `CLAUDE.md` and the `reelsmith-pipeline` skill. It stops for you at each gate: research approval, script approval, the voice choice, the preview, and publishing. See [Agent workflow](agent-workflow.md).

## Next

- [Concepts](concepts.md): the pipeline, the files, the gates.
- [Voice](voice.md): TTS modes and recording your own take.
- [CLI reference](cli.md): every command and flag.
