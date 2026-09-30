---
title: How the animation stays in sync
topic: devtools
date: 2026-09-30
style: motion
tts_voice: Leda
tts_mode: performance
series: reelsmith-tutorials
episode: 6
---

## Script

### Scene 1
Most AI made videos drift.
The text shows up before the voice says it.
Reelsmith makes that impossible.

### Scene 2
The animation is one HTML file, using React and a small runtime.
Each scene is a sprite whose window comes from scenes dot json.

### Scene 3
Inside a scene, you never hard code a delay.
You call use word cue with a phrase, and you get the second that word is spoken.

### Scene 4
Every frame is a pure function of time.
No timers, no random numbers, no CSS transitions.
The renderer seeks to a time, takes a frame, and moves on.

### Scene 5
Subtitles are free.
Drop a subtitle rail into any scene and the spoken word highlights on Whisper's timestamps.

### Scene 6
Two linters guard all of this.
Check sync bans wall clock code.
Validate sync makes sure every scene has a rail and every cue resolves.
Both must pass before you render.

## Voice direction
The narrator is explaining the technical heart of the framework to developers. Confident and a little proud. Scene 1 is a contrast: the problem, then the promise. Read "use word cue" as three words. Keep scene 4's three bans crisp.

## Scene Hints
- Scene 1 (hook): A subtitle line and a stat card visibly out of sync: the card appears early with a red "drift 0.5 s" marker, then a clean synced version replaces it on "impossible". Primitive: SyncDemo
- Scene 2 (structure): A code card of index.html skeleton: `<Sprite {...useSceneWindow(2)}>` and a scenes.json card beside it with `{ idx: 2, dur: 6.4, words: [...] }`; a line links them. Primitive: CodeCard x2
- Scene 3 (cue): Code line `const cueBill = useWordCue(2, "bill")` highlights, then a live subtitle rail runs and the stat card pops exactly on "bill". Primitive: CodeCard + LiveDemo
- Scene 4 (pure): Three banned tokens with strike-through: setTimeout, Math.random, transition. Then a timeline scrubber moving frame by frame with "t = 3.40 s". Primitive: Strikes + Scrubber
- Scene 5 (rail): Code line `<SubtitleRail sceneIdx={2} />` then a subtitle rail demo highlighting each word. Primitive: CodeCard + Rail
- Scene 6 (linters): Terminal runs `reelsmith lint videos/my-video`, two rows: check-sync ✓ 0 errors, validate-sync ✓ 0 warnings. A green "ready to render" badge. Primitive: Terminal
