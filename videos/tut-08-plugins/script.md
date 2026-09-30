---
title: Plugins, bring your own everything
topic: devtools
date: 2026-09-30
style: motion
tts_voice: Leda
tts_mode: performance
series: reelsmith-tutorials
episode: 8
---

## Script

### Scene 1
Don't like the voice provider?
Swap it.
Need to post somewhere new?
Add it.
Reelsmith is plugins all the way down.

### Scene 2
There are four plugin kinds.
TTS, which turns text into audio.
STT, which turns audio into word timings.
Style, which defines a look.
And publish, which sends a finished video somewhere.

### Scene 3
A plugin is a folder with a plugin dot js file that exports a name, a kind, and a couple of functions.
That is the whole contract.

### Scene 4
Register it in reelsmith dot config dot json, or drop it in the plugins folder.
Run reelsmith plugins to see what is loaded.

### Scene 5
Built in, you get OpenRouter TTS, local Whisper, three styles, and publish targets for YouTube, Instagram, and Discord.

### Scene 6
Want ElevenLabs?
Write synthesize, return a buffer, done.
The rest of the pipeline never knows the difference.

## Voice direction
The narrator is pitching extensibility to developers. Scene 1 is quick call and response. Scene 2 lists four kinds; pause a beat after each. Scene 6 is playful: "done" is a mic drop.

## Scene Hints
- Scene 1 (hook): Core block in the middle; a "tts" tile pops off and a new one snaps on ("swap it"), then a "publish" tile snaps on ("add it"). Primitive: PluginDock
- Scene 2 (kinds): Four labeled tiles appear in a 2x2 grid on their cues: TTS (waveform icon), STT (words icon), STYLE (palette), PUBLISH (send arrow), each with a one-line role. Primitive: TileGrid
- Scene 3 (contract): Code card `module.exports = { name: 'tts-elevenlabs', kind: 'tts', async synthesize({ text, voice }) { ... } }` with lines highlighting on cues. Primitive: CodeCard
- Scene 4 (register): Config card `"plugins": ["./plugins/tts-elevenlabs"]`, then terminal `reelsmith plugins` listing rows with kind badges. Primitive: CodeCard + Terminal
- Scene 5 (built in): Row of badges appearing: openrouter-tts, whisper-stt, reflective, tech-news, motion, youtube, meta, discord. Primitive: BadgeRow
- Scene 6 (close): The ElevenLabs tile snaps onto the dock, the pipeline flow diagram lights up unchanged, "done." punches in. Primitive: PluginDock + Flow
