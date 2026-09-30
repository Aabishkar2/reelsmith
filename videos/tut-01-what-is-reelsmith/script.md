---
title: Reelsmith in 60 seconds
topic: devtools
date: 2026-09-30
style: motion
tts_voice: Leda
tts_mode: performance
series: reelsmith-tutorials
episode: 1
---

## Script

### Scene 1
You write one hundred and fifty words.
You get a finished vertical video, with a voice, live subtitles, and motion graphics.

### Scene 2
That is Reelsmith.
It is an open framework for making short videos with a coding agent like Claude Code.

### Scene 3
Here is the whole pipeline.
A script becomes a voice.
The voice becomes word timings.
The timings drive an animation.
And a renderer turns the animation into an MP4.

### Scene 4
The voice can be text to speech, or your own recording from the built in teleprompter.
Either way, every word on screen is synced to the exact moment it is spoken.

### Scene 5
Everything is a plain file.
The script is markdown.
The animation is one HTML file.
The config is markdown your agent reads.

### Scene 6
And everything is a plugin.
Swap the voice provider, add a style, or add a publish target, without touching the core.

### Scene 7
In this series, I will take you from install to a published short, one command at a time.
Let's build.

## Voice direction
The narrator is introducing a new open source framework called Reelsmith to developers and creators who have never seen it. The tone is a confident product walkthrough by an engineer who built it, not a sales pitch. Land the pipeline list in scene 3 as five quick beats. The last line, "Let's build", is an invitation.

## Scene Hints
- Scene 1 (hook): Big numeral "150" counts up, then the word "words" snaps in. Beat: a phone frame slides in showing a finished short playing with karaoke subtitles. Primitive: Typography + PhoneFrame
- Scene 2 (name reveal): Wordmark "REELSMITH" assembles letter by letter on "That is Reelsmith". Sub-line "an open framework for shorts, driven by your coding agent". Claude Code terminal chip appears on "Claude Code". Primitive: Wordmark + Chip
- Scene 3 (pipeline): Five nodes light up left to right on each word cue: script.md → voice.mp3 → words[] → index.html → output.mp4. Connecting line draws between nodes. Primitive: FlowDiagram
- Scene 4 (voice paths): Split card. Left: "TTS" with a waveform. Right: "Your take" with a mic and teleprompter lines scrolling. Bottom: a subtitle line highlights word by word on "exact moment". Primitive: SplitCard + Waveform
- Scene 5 (files): A file tree appears: videos/my-video/script.md, index.html, config/*.md. Each file badge pops on its cue. Primitive: FileTree
- Scene 6 (plugins): A core box in the middle, plugin tiles snap onto it: tts, style, publish. Primitive: PluginDock
- Scene 7 (close): Terminal window types `npx reelsmith init my-channel` on "one command". "Let's build." punches in. Primitive: Terminal
