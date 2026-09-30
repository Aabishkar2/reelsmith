---
title: Install Reelsmith in 3 minutes
topic: devtools
date: 2026-09-30
style: motion
tts_voice: Leda
tts_mode: performance
series: reelsmith-tutorials
episode: 2
---

## Script

### Scene 1
Three tools, one command, and Reelsmith is ready.
Let me show you the whole install.

### Scene 2
You need Node twenty two or newer, ffmpeg for audio and video, and Python three eleven for Whisper.
On a Mac, that is one brew install.

### Scene 3
Then run npx reelsmith init, and give it a folder name.
It creates the project, a videos folder, a config folder, and the agent skills for Claude Code.

### Scene 4
Open the dot env file and paste your OpenRouter key.
That key powers text to speech.
If you record your own voice, you can skip it.

### Scene 5
Now run reelsmith doctor.
It checks every tool, every key, and every plugin, and tells you exactly what is missing.

### Scene 6
Green across the board?
Then open the folder in Claude Code and say, make me a video.
The agent already knows the rest.

## Voice direction
The narrator walks a developer through installing a command line tool. Each command is read clearly, because the viewer will type it. Slow down slightly on the command names: "npx reelsmith init", "reelsmith doctor". The ending is relaxed and reassuring.

## Scene Hints
- Scene 1 (hook): Three tool icons (Node, ffmpeg, Python) drop in on "three tools", then a terminal with a single command on "one command". Primitive: IconRow + Terminal
- Scene 2 (prereqs): Checklist with version badges: node >= 22, ffmpeg, python3.11 + openai-whisper. A terminal types `brew install node ffmpeg python@3.11` on "brew install". Primitive: Checklist + Terminal
- Scene 3 (init): Terminal types `npx reelsmith init my-channel`, then a file tree grows: my-channel/ videos/ config/ .claude/skills/ reelsmith.config.json .env.example. Primitive: Terminal + FileTree
- Scene 4 (env): A .env file card with `OPENROUTER_API_KEY=sk-or-...` typed in, key masked. Badge "powers TTS". A small "optional if you record" chip on "skip it". Primitive: FileCard
- Scene 5 (doctor): Terminal runs `reelsmith doctor`, rows appear one by one with green checks: node, ffmpeg, python3.11, whisper, playwright chromium, OPENROUTER_API_KEY, plugins. One row shows a yellow warning to make the point. Primitive: Terminal + StatusRows
- Scene 6 (close): Claude Code prompt window with the typed message "make me a video about prompt caching". Reelsmith wordmark small in the corner. Primitive: ChatPrompt
