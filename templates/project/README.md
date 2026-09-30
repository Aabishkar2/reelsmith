# My Reelsmith project

Short videos made with [Reelsmith](https://github.com/Aabishkar2/reelsmith): script in, short out.

## Setup

```bash
cp .env.example .env        # add OPENROUTER_API_KEY for TTS (not needed for your own voice)
npx reelsmith doctor        # checks node, ffmpeg, Python + Whisper, Chromium, keys, plugins
```

`doctor` tells you what is missing. Typical fixes on macOS:

```bash
brew install node ffmpeg python@3.11
python3.11 -m pip install openai-whisper
npx playwright install chromium
```

## Make a video

Open this folder in Claude Code and say "make me a video about <topic>". The agent follows `CLAUDE.md` and the skills in `.claude/skills/`, and stops for your approval at each gate.

By hand, the shortest path is six commands:

```bash
npx reelsmith new my-first-video
# write videos/my-first-video/script.md (or ask the agent to)
npx reelsmith tts videos/my-first-video --voice=<voice>
# the agent writes videos/my-first-video/index.html
npx reelsmith sheet videos/my-first-video
npx reelsmith draft videos/my-first-video
npx reelsmith approve videos/my-first-video --by="<you>"
npx reelsmith render videos/my-first-video
```

The result is `videos/my-first-video/output.mp4`.

## Layout

```
videos/<name>/         one folder per video
config/                agent-facing defaults (audio, music, voice direction)
styles/  runtime/      symlinks into the installed framework
plugins/               your own plugins
music/                 background tracks + CREDITS.md
reelsmith.config.json  project settings
.env                   keys (never commit)
```

## Docs

Full docs: `node_modules/reelsmith/docs/`, or the Reelsmith docs site.
