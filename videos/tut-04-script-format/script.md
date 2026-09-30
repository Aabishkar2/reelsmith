---
title: script.md, the one file that matters
topic: devtools
date: 2026-09-30
style: motion
tts_voice: Leda
tts_mode: performance
series: reelsmith-tutorials
episode: 4
---

## Script

### Scene 1
One markdown file controls the whole video.
Get script dot md right and everything downstream gets easier.

### Scene 2
At the top is frontmatter.
Title, topic, the style, the voice, and the speed.
Anything you set here beats the project defaults.

### Scene 3
Under the script heading, each scene is a heading, Scene one, Scene two, and so on.
Inside a scene, one sentence per line.
That line is the unit everything else works with.

### Scene 4
Lines starting with an angle bracket are notes, not narration.
Use them for pronunciation, like say one hundred, or a pause.
They are never spoken and never aligned.

### Scene 5
Below the script, add scene hints.
One line per scene, saying what should be on screen and which primitive to use.
Your agent reads these when it builds the animation.

### Scene 6
Keep it short.
About one hundred fifty spoken words is a sixty second short at normal pace.
Say the numbers the way you want them heard.

## Voice direction
The narrator is teaching a file format. Precise and friendly. Read "script dot md" naturally. When listing frontmatter fields in scene 2, give each a tiny beat. The final advice is a calm takeaway.

## Scene Hints
- Scene 1 (hook): A single file icon "script.md" grows in the center, then lines of a pipeline branch out of it: voice, timings, animation, mp4. Primitive: FileHub
- Scene 2 (frontmatter): A code card shows the YAML block, each key highlights on its cue: title, topic, style, tts_voice, tts_speed. A "beats defaults" badge on "beats". Primitive: CodeCard
- Scene 3 (scenes): The card scrolls to `### Scene 1` and `### Scene 2` headings; each sentence line gets a bracket "s1.1", "s1.2" id label on "one sentence per line". Primitive: CodeCard + Labels
- Scene 4 (cues): A line `> say: "one hundred", not "a hundred"` appears in muted color with a "not spoken" stamp. Primitive: CodeCard + Stamp
- Scene 5 (hints): The `## Scene Hints` section slides up with two example lines; a Claude Code chip reads them (a small eye icon). Primitive: CodeCard + Chip
- Scene 6 (length): A word counter dial sweeps to 150, with "≈ 60 s" beside it. A digits vs words example: "100 → one hundred". Primitive: Dial + Typography
