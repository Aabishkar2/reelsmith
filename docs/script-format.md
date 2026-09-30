# Script format

`videos/<name>/script.md` controls the whole video. The voice is made from it, the word timings are aligned to it, and the agent builds the animation from its scene hints. `reelsmith new <name>` writes a template.

## A complete example

```markdown
---
title: Reelsmith in 60 seconds
topic: devtools
date: 2026-09-30
wpm: 170
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
> say: "Reelsmith" as one word
It is an open framework for making short videos with a coding agent like Claude Code.

## Voice direction
The narrator is introducing a new open source framework to developers who have never seen it. Confident, not a sales pitch.

## Scene Hints
- Scene 1 (hook): Big numeral "150" counts up, then "words" snaps in. Primitive: Counter + PhoneFrame
- Scene 2 (name reveal): Wordmark assembles letter by letter on "That is Reelsmith". Primitive: Wordmark
```

## Frontmatter

The block between the two `---` lines. Flat `key: value` lines only. A trailing `# comment` is stripped. Numbers are read as numbers.

| Key | Required | Meaning |
|---|---|---|
| `title` | yes | the video title (also the heading of the performance prompt) |
| `topic` | yes | a pillar slug from `config/strategy.md`, free text |
| `date` | yes | `YYYY-MM-DD` |
| `wpm` | no | teleprompter scroll speed in words per minute (the app falls back to 150; scripts usually set 170) |
| `style` | no | style pack name; else `style` in `reelsmith.config.json`, default `reflective` |
| `tts_voice` | TTS only | the voice the creator picked. There is no default |
| `tts_mode` | no | `sentence` (default) or `performance` |
| `tts_model` | no | provider model for this video only |
| `tts_speed` | no | tempo for this video only (default 1.15) |
| `tts_performance` | no | path to a PERFORMANCE file for this video, instead of `config/voice/performance.md` |
| `series`, `episode` | no | free metadata; tools ignore them, publish notes can use them |

Anything set here beats `reelsmith.config.json` and the environment. A CLI flag beats the frontmatter. The full order is in [Concepts](concepts.md#settings-and-precedence).

## `## Script`: scenes and sentences

- Each scene is a `### Scene N` heading. N starts at 1 and has no gaps.
- Inside a scene, **one sentence per line**. A line is the unit everything else works with: the TTS clip in sentence mode, the re-record unit for a recorded take, the alignment unit for word timings.
- Each line gets an id `s<scene>.<line>`: the second line of scene 3 is `s3.2`. Take analysis and re-records use these ids.
- Blank lines are ignored.
- Any heading other than `Scene N` ends the current scene.

## `>` cue lines

A line that starts with `>` is a note for a human reader, not narration:

```markdown
> say: "one hundred", not "a hundred"
At 100 input tokens per output token, that prompt is most of your bill.
> [breath]
Renaming a directory with a hundred thousand files can take minutes, because every file gets copied.
```

- Never spoken, never aligned, never sent to a TTS voice.
- A cue attaches to the sentence **below** it. Put it on the line above the sentence it describes.
- A `>` line outside any scene (for example right after the frontmatter) is a file-level note and is ignored.

A TTS voice reads the line itself, so for a TTS video write numbers and symbols the way they should be heard: "one hundred fifty", "script dot md", "Python three eleven". Cues only help a human reader.

## Sections after the script

The parser only reads `### Scene N` blocks. Other sections are for people and agents:

| Section | Written by | Used by |
|---|---|---|
| `## Voice direction` | script-writing skill | `reelsmith tts --mode=performance` (the CONTEXT block) |
| `## Scene Hints` | script-writing skill | html-animation skill: one line per scene, what is on screen and which primitive builds it |
| `## Delivery notes` | teleprompter-prep skill | the creator before recording |
| `## Score` | market-research skill | the creator |
| `## Blueprint` | optional working notes | market-research scoring |

**Never put a `Scene N` heading in these sections.** The parser treats any `Scene N` heading, at any level, as spoken.

## Length

- About 150 spoken words is a 60 second short at a normal pace. Aim for 130 to 170.
- Keep each line to about 8 to 16 spoken words, so it can be said in one breath.
- Word counts mean spoken words. "5.5" is "five point five", three words.
- The first line should be 12 spoken words or fewer and say something specific.

## Common mistakes

| Mistake | Effect | Fix |
|---|---|---|
| Two sentences on one line | one long TTS clip or re-record unit | split the line |
| A cue below the sentence it describes | the cue attaches to the next sentence | move it above |
| `### Scene 3` inside `## Scene Hints` | the hint is read as narration | write `- Scene 3:` as a bullet |
| Scene numbers 1, 2, 4 | a warning, and scene ids no longer match scene order | renumber |
| Digits in a TTS script ("v2.1") | the voice may read it wrong | write it as spoken ("version two point one") |
