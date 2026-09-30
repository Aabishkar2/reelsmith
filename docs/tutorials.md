# Tutorials

Ten shorts that teach Reelsmith, made with Reelsmith itself: `motion` style, TTS performance mode, the voice Leda. Each folder under `videos/` has the `script.md`, the `index.html` and the `scenes.json`, so every episode is also a worked example of the files it explains.

The length is Σ `dur` of the episode's `scenes.json`, the spoken part. The rendered MP4 runs about 2.5 s longer: the music tail that `reelsmith mix` adds holds the closing frame.

| # | Episode | Length | Folder |
|---|---|---|---|
| 1 | [Reelsmith in 60 seconds](#1-reelsmith-in-60-seconds) | 51.0 s | [`videos/tut-01-what-is-reelsmith/`](../videos/tut-01-what-is-reelsmith/) |
| 2 | [Install Reelsmith in 3 minutes](#2-install-reelsmith-in-3-minutes) | 44.9 s | [`videos/tut-02-install/`](../videos/tut-02-install/) |
| 3 | [Your first video, start to finish](#3-your-first-video-start-to-finish) | 48.1 s | [`videos/tut-03-first-video/`](../videos/tut-03-first-video/) |
| 4 | [script.md, the one file that matters](#4-scriptmd-the-one-file-that-matters) | 50.7 s | [`videos/tut-04-script-format/`](../videos/tut-04-script-format/) |
| 5 | [Voice, TTS or your own take](#5-voice-tts-or-your-own-take) | 50.1 s | [`videos/tut-05-voice/`](../videos/tut-05-voice/) |
| 6 | [How the animation stays in sync](#6-how-the-animation-stays-in-sync) | 46.3 s | [`videos/tut-06-animation/`](../videos/tut-06-animation/) |
| 7 | [Styles and style packs](#7-styles-and-style-packs) | 40.2 s | [`videos/tut-07-styles/`](../videos/tut-07-styles/) |
| 8 | [Plugins, bring your own everything](#8-plugins-bring-your-own-everything) | 44.9 s | [`videos/tut-08-plugins/`](../videos/tut-08-plugins/) |
| 9 | [The quality gates that stop bad videos](#9-the-quality-gates-that-stop-bad-videos) | 50.1 s | [`videos/tut-09-quality-gates/`](../videos/tut-09-quality-gates/) |
| 10 | [Publish, without surprises](#10-publish-without-surprises) | 48.9 s | [`videos/tut-10-publish/`](../videos/tut-10-publish/) |

The commands below are the ones each episode shows on screen or speaks. They are written `reelsmith <command>` as in the videos: in a project that is `npx reelsmith <command>`, in a clone `node bin/reelsmith.js <command>`. Where the working form differs from what is on screen, the note under the block says so.

## 1. Reelsmith in 60 seconds

`videos/tut-01-what-is-reelsmith/` · 51.0 s · 7 scenes

What Reelsmith is. You write about 150 words and get a finished vertical video with a voice, live subtitles and motion graphics, made with a coding agent like Claude Code. The pipeline in one line: the script becomes a voice, the voice becomes word timings, the timings drive the animation, and the renderer turns it into an MP4. The voice is a TTS model or your own take from the teleprompter; either way every word on screen is synced to the moment it is spoken. Everything is a plain file (a markdown script, one HTML animation, markdown config) and everything is a plugin, so you can swap the voice provider or add a style or a publish target without touching the core.

```bash
npx reelsmith init my-channel
reelsmith tts
reelsmith record
```

Until the package is on npm, `init` runs from GitHub: `npx github:Aabishkar2/reelsmith init my-channel`.

## 2. Install Reelsmith in 3 minutes

`videos/tut-02-install/` · 44.9 s · 6 scenes

The install. You need Node (22 recommended, 20 minimum), ffmpeg and ffprobe, and Python 3.11 with Whisper; on a Mac one `brew install` covers them. `init` creates the project: the videos and config folders, `reelsmith.config.json`, `CLAUDE.md` and the Claude Code skills. The OpenRouter key goes in `.env`; it only powers text to speech, so you can skip it if you record your own voice. `reelsmith doctor` checks every tool, key and plugin and says exactly what is missing. When it is green, open the folder in Claude Code and say "make me a video".

```bash
brew install node ffmpeg python@3.11
npx reelsmith init my-channel
cp .env.example .env
npx reelsmith doctor
python3.11 -m pip install openai-whisper
```

Until the package is on npm: `npx github:Aabishkar2/reelsmith init my-channel`. See [Getting started](getting-started.md).

## 3. Your first video, start to finish

`videos/tut-03-first-video/` · 48.1 s · 7 scenes

From a blank folder to a rendered short in six commands. `new` makes the video folder with a `script.md` template. You write the script one sentence per line, grouped into scenes, or let the agent write it with the script-writing skill. `tts` with a voice name makes the voice, runs Whisper for the word timings and writes `scenes.json`. The agent writes `index.html` with every overlay bound to a spoken word. `sheet` shows a contact sheet of frames and `draft` a quick low-res preview; you watch, give feedback and iterate. When you are happy, `approve` and then `render` write `output.mp4`.

```bash
reelsmith new prompt-caching
reelsmith tts prompt-caching --voice=Leda
reelsmith sheet prompt-caching
reelsmith draft prompt-caching
reelsmith approve prompt-caching --by=you
reelsmith render prompt-caching
```

For the preview gate, `reelsmith sheet prompt-caching --stills` also writes the full-size stills the human reviews. `reelsmith lint prompt-caching` belongs before the sheet. See [Getting started](getting-started.md#5-make-your-first-video).

## 4. script.md, the one file that matters

`videos/tut-04-script-format/` · 50.7 s · 6 scenes

The `script.md` format. The frontmatter at the top (title, topic, style, voice, speed) beats the project defaults. Under `## Script`, each scene is a `### Scene N` heading and each line inside it is one sentence: the unit that TTS, re-recording and the word timings work with. Lines starting with `>` are notes such as a pronunciation or a pause; they are never spoken and never aligned. `## Scene Hints` below the script gives one line per scene saying what is on screen and which primitive builds it, and the agent reads them. About 150 spoken words make a 60-second short; write numbers the way they should be heard.

No commands: the episode shows a `script.md` (frontmatter `style: motion`, `tts_voice: Leda`, `tts_speed: 1.2`; `### Scene` blocks with the line ids `s1.1`, `s1.2`; `> say: "one hundred"` and `> [pause]` cues; a `## Scene Hints` block) and how frontmatter beats `reelsmith.config.json`. The full format is in [Script format](script-format.md).

## 5. Voice, TTS or your own take

`videos/tut-05-voice/` · 50.1 s · 6 scenes

The two voice paths, which end in the same `scenes.json` and `voiceover.mp3`. TTS sentence mode calls the model once per line, caches every clip and joins them with clean gaps, so changing one line regenerates only that line. Performance mode sends the whole script in one call with a direction prompt (style, pace, accent), which sounds like one person talking; it is the mode the episode itself uses. For your own voice, `record` opens a teleprompter in the browser that records one long take, `analyze` runs Whisper, aligns the take to the script and flags fillers, stutters, long pauses and skipped lines, and after you re-record the flagged lines `cut` trims the take and keeps the best attempt of each line.

```bash
reelsmith tts
reelsmith record
reelsmith analyze my-video
reelsmith cut my-video
```

The app analyzes each take by itself, and re-records happen in its review view (press R on a line); `reelsmith rerecord my-video --sentence=s2.1 --clip=takes/rr-s2.1-1` splices a clip from the terminal. See [Voice](voice.md).

## 6. How the animation stays in sync

`videos/tut-06-animation/` · 46.3 s · 6 scenes

Why the text never shows up before the voice says it. The animation is one HTML file with React and the runtime; each scene is a `Sprite` whose window comes from `scenes.json`. Inside a scene you never hard-code a delay: `useWordCue(scene, "phrase")` returns the second that phrase is spoken. Every frame is a pure function of time (no timers, no random numbers, no CSS transitions), so the renderer can seek to any time and capture it. `SubtitleRail` highlights the spoken word from the Whisper timestamps. The two linters, check-sync and validate-sync, guard all of it.

```bash
reelsmith lint tut-06-animation
reelsmith sheet
```

`lint` exits 1 when either linter fails, and `reelsmith run` stops there; the final render itself is gated by the approval, not by `lint`. See [Animation](animation.md).

## 7. Styles and style packs

`videos/tut-07-styles/` · 40.2 s · 5 scenes

The same script in three different looks. A style pack is a folder: a `STYLE.md` that describes the look, and optionally a `kit.jsx` with components and a `reference/` folder. Three ship with Reelsmith: `reflective` (warm, photo-led, serif headlines), `tech-news` (dark with a red accent, code-driven scenes) and `motion` (the style of the series, built for teaching). You pick one with `style:` in the frontmatter or set a project default in `reelsmith.config.json`, and the agent reads the pack before it writes any HTML. For your own brand, copy a pack and change its palette, fonts, layouts and components.

```bash
cp -r styles/motion styles/acme
reelsmith render
```

In a project made by `init`, `styles/motion` is a symlink into `node_modules`; copy it with `cp -RL styles/motion styles/acme` so you get the files, not the link. `reelsmith styles` lists the packs. See [Styles](styles.md).

## 8. Plugins, bring your own everything

`videos/tut-08-plugins/` · 44.9 s · 6 scenes

Everything that talks to the outside world is a plugin, in four kinds: `tts` (text to audio), `stt` (audio to word timings), `style` (a look) and `publish` (sends a finished video somewhere). A plugin is a folder with a `plugin.js` that exports a `name`, a `kind`, a `version` and a few functions. Drop it in the project's `plugins/` folder, or list it in `reelsmith.config.json` `"plugins"`, and `reelsmith plugins` shows what is loaded. Built in: OpenRouter TTS, local Whisper, the three styles, and publish targets for YouTube, Meta (Instagram and Facebook Reels) and Discord. An ElevenLabs provider is one `synthesize()` that returns `{ audio, format }`; the rest of the pipeline never knows the difference.

```bash
reelsmith plugins
```

The contract, with a complete ElevenLabs provider: [Plugins](plugins.md).

## 9. The quality gates that stop bad videos

`videos/tut-09-quality-gates/` · 50.1 s · 6 scenes

The four gates in front of the final render. Gate 1, the linters, fail on anything that could drift. Gate 2, the contact sheet, samples the hook and three frames per scene, labelled with the words being spoken; the agent scores hook, readability, motion, variety and sync and fixes the three worst. Gate 3, the draft, is a low-res render with the voice in about 30 seconds that you watch before a full render. Gate 4, the approval, records a fingerprint of the animation, the timings, the runtime and style kit, and the images; changing any of them expires it. Only then does the render run, with up to four browser shards piping frames into ffmpeg.

```bash
reelsmith lint my-video
reelsmith sheet my-video
reelsmith draft my-video
reelsmith approve my-video --by=you
reelsmith render my-video
```

`reelsmith render` refuses with exit code 3 without a current approval; `reelsmith approve my-video --check` tells whether it is still current. See [Concepts](concepts.md#gates).

## 10. Publish, without surprises

`videos/tut-10-publish/` · 48.9 s · 7 scenes

Getting a rendered video out without posting to the wrong place. The agent writes `publish.md`: a title under 60 characters, a description, tags and the music credit. Every target is a publish plugin: YouTube Shorts, Instagram and Facebook Reels, and Discord for team review. Every target supports a dry run that checks the credentials, the file size and the metadata and prints exactly what it would send. Drop the flag to post; the result (URL and id) lands in `videos/<name>/publish/<target>.json`, so a second upload is refused. Credentials live in `.env` and `~/.config/reelsmith/`, never in the repo, and `doctor` shows which target is ready.

```bash
reelsmith publish my-video --notes
reelsmith publish my-video --to=youtube --dry-run
reelsmith publish my-video --to=youtube
reelsmith doctor
```

The narration says "publish notes"; the command is the `--notes` flag. The one-time YouTube sign-in is `reelsmith publish my-video --to=youtube --auth`. See [Publishing](publishing.md).
