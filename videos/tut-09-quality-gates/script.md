---
title: The quality gates that stop bad videos
topic: devtools
date: 2026-09-30
style: motion
tts_voice: Leda
tts_mode: performance
series: reelsmith-tutorials
episode: 9
---

## Script

### Scene 1
The fastest way to ship a bad video is to render it too early.
Reelsmith puts four gates in front of the render button.

### Scene 2
Gate one, the linters.
Check sync and validate sync fail on anything that could drift.

### Scene 3
Gate two, the contact sheet.
Reelsmith sheet grabs hook frames and three frames per scene, labelled with the words being spoken.
Your agent scores each frame on hook, readability, motion, variety, and sync, then fixes the three worst.

### Scene 4
Gate three, the draft.
Reelsmith draft renders a low res preview with the voice in about thirty seconds.
You watch it on your phone before committing a full render.

### Scene 5
Gate four, approval.
Reelsmith approve records a fingerprint of the animation, the timings, and the images.
Change any of them, and the approval expires.

### Scene 6
Only then does reelsmith render run.
Four browser shards, frames piped straight into ffmpeg, a ninety second short in about ninety seconds.

## Voice direction
The narrator is laying out a review process for developers who care about quality. Number the gates clearly: gate one, gate two, and so on, with a beat before each. The final line is a payoff with a bit of speed pride.

## Scene Hints
- Scene 1 (hook): A big red "RENDER" button with a hand cursor about to press; four gate bars drop in front of it one by one. Primitive: GateBars
- Scene 2 (linters): Terminal `reelsmith lint`, two rows check-sync / validate-sync with green checks; one flash of a red failure example "setTimeout at line 212" then fixed. Primitive: Terminal
- Scene 3 (sheet): A 4x3 contact sheet grid animates in with word labels under frames; score chips 6, 9, 8, 7... appear; the three lowest get red rings on "three worst". Primitive: Grid + ScoreChips
- Scene 4 (draft): Terminal `reelsmith draft`, a phone frame plays a pixelated low-res draft with a "15 fps · 0.75×" tag; a "30 s" stopwatch. Primitive: Terminal + PhoneFrame
- Scene 5 (approve): Terminal `reelsmith approve --by=aabishkar`, a fingerprint card `sha256 ... index.html scenes.json images/**`; edit one file and a red "expired" stamp hits. Primitive: Terminal + FingerprintCard
- Scene 6 (render): Terminal `reelsmith render`; four shard bars fill in parallel and merge into one bar; timer reads "1:29"; output.mp4 badge lands. Primitive: ShardBars
