---
title: Your first video, start to finish
topic: devtools
date: 2026-09-30
style: motion
tts_voice: Leda
tts_mode: performance
series: reelsmith-tutorials
episode: 3
---

## Script

### Scene 1
From a blank folder to a rendered short, in six commands.
Here is your first Reelsmith video.

### Scene 2
Start with reelsmith new, and a name.
You get a videos folder with a script dot md template inside.

### Scene 3
Write your script, one sentence per line, grouped into scenes.
Or ask your agent to write it, using the script writing skill.

### Scene 4
Run reelsmith tts with a voice name.
It synthesizes the voice, runs Whisper for word timings, and writes scenes dot json.

### Scene 5
Now the agent writes index dot html, the animation.
Every overlay is bound to a spoken word, so nothing appears before it is said.

### Scene 6
Run reelsmith sheet to see a contact sheet of frames, then reelsmith draft for a quick low res preview.
Watch it, give feedback, and iterate.

### Scene 7
Happy?
Run reelsmith approve, then reelsmith render.
Ninety seconds later, output dot mp4 is on disk.

## Voice direction
The narrator is demonstrating a complete workflow for the first time. Momentum matters: each scene is one step and the commands land like a checklist. Give the last line, "output dot mp4 is on disk", a satisfied finish.

## Scene Hints
- Scene 1 (hook): Six numbered chips fly in "1 2 3 4 5 6" on "six commands", then a phone frame with a rendered video appears. Primitive: Chips + PhoneFrame
- Scene 2 (new): Terminal types `reelsmith new prompt-caching`, output shows created path `videos/prompt-caching/script.md`. A file card of the template slides up. Primitive: Terminal + FileCard
- Scene 3 (script): script.md card with `### Scene 1` heading and two lines, each line highlights on "one sentence per line". A Claude Code chip on "your agent". Primitive: FileCard + Chip
- Scene 4 (tts): Terminal runs `reelsmith tts videos/prompt-caching --voice=Leda`, progress rows: synthesizing, whisper timings, wrote scenes.json. A waveform animates. Primitive: Terminal + Waveform
- Scene 5 (animation): Split: index.html code snippet with `useWordCue(2, "bill")` on the left, on the right a stat card that pops exactly when the subtitle word "bill" highlights. Primitive: CodeCard + LiveDemo
- Scene 6 (preview): Terminal `reelsmith sheet` then `reelsmith draft`; a 3x3 contact sheet grid animates in, then a small draft player. Primitive: Terminal + Grid
- Scene 7 (render): Terminal `reelsmith approve --by=you` then `reelsmith render`; a progress bar fills with "4 shards", then a big "output.mp4" file badge punches in. Primitive: Terminal + ProgressBar
