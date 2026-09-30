# FAQ

## Cost and privacy

### What does a video cost?

With the built-in TTS provider (Gemini TTS through OpenRouter), about $0.01 per minute of voice. Sentence mode caches every clip, so re-runs only pay for changed lines; performance mode caches by prompt, so a re-run with the same script is free. Your own voice costs nothing. Whisper, the renderer and all the tools run locally.

### What leaves my machine?

Only the TTS request (the script text, sent to the TTS provider) and, when you publish, the video and its metadata to the targets you name. Jev AI filler classification sends short word snippets to OpenRouter when a key is set; `reelsmith analyze --no-jev` turns it off. Recording, transcription, analysis and rendering are local.

### Where are my keys stored?

In `.env` in the project root (gitignored) and, for YouTube, in `~/.config/reelsmith/`. Never in the repo.

## Setup

### `reelsmith: command not found`

In clone mode, run `npm link` in the repo, or use `node bin/reelsmith.js`. In a project made by `init`, use `npx reelsmith`.

### A bare `node` fails in a script or a non-interactive shell

Some nvm setups only load in interactive shells. Call node by its full path (for example `~/.nvm/versions/node/<version>/bin/node`).

### Whisper is not found, or the wrong Python is used

Reelsmith looks for `REELSMITH_PYTHON`, then `python3.11`, `python3.12`, `python3`. `reelsmith doctor` shows which one it picked and whether it can import `whisper`. Set `REELSMITH_PYTHON` to the Python where you ran `pip install openai-whisper`.

### ffmpeg is not found

Install it (`brew install ffmpeg`, `apt install ffmpeg`) or set `FFMPEG_PATH`.

### The renderer or contact sheet cannot start a browser

Run `npx playwright install chromium` (on Linux also `sudo npx playwright install-deps chromium`).

## Voice

### Why is there no default TTS voice?

The voice is the most personal choice in a video. The creator names it per video (`--voice` or `tts_voice:`), and the agent is told never to pick one.

### `401` or `403` from TTS

The key in `.env` is wrong or has no credit. For the built-in provider, check `OPENROUTER_API_KEY`.

### Performance mode fails with "sentences not found"

The voice skipped or rephrased more than 20 % of the lines. Simplify the lines it missed, or run again with `--force` for a new take.

### Can I change the speed without paying again?

Yes. `--speed` (or `tts_speed:`) is applied with ffmpeg to the cached audio.

### Do `>` cues affect the TTS voice?

No. They are notes for a human reader. For TTS, write numbers and symbols the way they should be spoken.

## Animation and rendering

### Text appears before it is said

An overlay is using a hand-picked delay. Bind it to `useWordCue(scene, "phrase")`. `reelsmith lint` flags delays over 0.6 s.

### An overlay never appears

Its `useWordCue` phrase is not in the scene's words, so it returned `Infinity`. `reelsmith lint` lists it. Pick a phrase that is in `scenes.json` (digits stay digits).

### Something moves in the preview but not in the MP4

It uses a CSS transition or animation. Render mode turns them off. Compute the motion from `localTime`.

### `reelsmith render` exits with code 3

There is no approval, or something changed after it. Make a new draft, get it approved, run `reelsmith approve`, then render.

### How long does a render take?

About 90 seconds for a 90 second short on a recent laptop (4 parallel browsers). A draft takes about 30 seconds. A crashed render resumes from its cached segments.

### Can I render on Linux or in CI?

Yes, with ffmpeg and Playwright Chromium installed. The encoder falls back to x264 when VideoToolbox is not available.

## Publishing

### Does publishing post publicly?

YouTube uploads are private unless you ask for public. Every target supports `--dry-run`, and the agent only posts when you tell it to.

### My YouTube upload says "refresh token expired"

Google projects in Testing mode issue tokens that expire after 7 days. Sign in again, or publish the consent screen. See [Publishing](publishing.md#limits).

### My Short is blocked in some or all countries

Probably a Content ID music claim. See [Publishing](publishing.md#music-claims-can-block-a-short).

## Extending

### Can I use another TTS provider?

Yes. Write a `tts` plugin with a `synthesize()` function. [Plugins](plugins.md) has a complete ElevenLabs example.

### Can I use my brand's look?

Yes. Copy a style pack, edit its `STYLE.md` and `kit.jsx`, and set `style:`. See [Styles](styles.md).

### Do I have to use Claude Code?

No. Every step is a CLI command and a plain file. The skills are markdown any agent (or person) can follow.
