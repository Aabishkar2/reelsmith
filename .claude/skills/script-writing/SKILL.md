---
name: script-writing
description: Write a simple, linear YouTube Shorts explainer script that the creator reads aloud from the teleprompter. Use when the user says "write me a script", "script this", or wants a topic turned into a script. Explains the topic to a curious general person, start to finish, in plain words that sound like a human talking. Writes videos/<name>/script.md.
---

# Script writing (simple)

Write a short explainer the creator reads aloud, live, from a teleprompter. Picture explaining the topic to a smart friend who doesn't work in tech. It should sound like a person talking, not like an article or an ad.

## Input

Use `videos/<name>/research.md` if it exists. Otherwise use what the user gave you (a topic, a link, notes). Only state facts you got from those. If a fact is missing, leave it out or ask. Never make up numbers.

## Shape: one straight line

Go in order. One scene per step, usually 5–6 scenes.

1. **Hook.** What happened or what this is, in one plain sentence. Make them want the next line.
2. **What it is.** Explain the thing simply. Define any jargon the moment you use it.
3. **How it works.** The one or two ideas that make it make sense. Use an everyday comparison if it helps.
4. **Why it matters.** What changes for the viewer, their work, or their money.
5. **What to do.** One practical thing they can try or check.
6. **Close.** One line that sums it up, so they walk away with it.

No twists required, no tricks. Each line should follow naturally from the one before.

## Sounding human

- Talk like you'd say it out loud: short sentences, contractions, "you".
- Plain words over fancy ones. If a 15-year-old wouldn't get a word, explain it or swap it.
- One idea per line. Round, easy numbers ("20 cents", "a fifth").
- No hype ("game-changer", "insane", "revolutionary"), no filler ("in this video", "let's dive in"), no "like and subscribe".
- Read it out loud in your head. If you'd stumble or it sounds like a press release, rewrite it.

## Length

- 130–170 spoken words total (about 45–60 seconds).
- Each line one sentence, roughly 8–16 words, so the creator can say it in one breath.
- Count words as they're said aloud: "5.5" = "five point five" = 3 words.

## Format

Write `videos/<name>/script.md`. The app and pipeline parse this, so keep the shape exactly:

```markdown
---
title: Claude Opus 5.5, explained
topic: ai-ml         # aws | ai-ml | swe | devtools
date: 2026-09-28
wpm: 170
---

## Script

### Scene 1
First sentence the creator says.
Second sentence.

### Scene 2
...

## Scene Hints
- Scene 1: overlay "OPUS 5.5" · show the price tag
- Scene 2: ...
```

- `### Scene N` blocks, numbered 1, 2, 3… One sentence per line. Each line is a re-record unit.
- A line starting with `>` is a note for the reader only (e.g. `> say: "five point five"`). It's never spoken, and it applies to the line below it. Use it only where a word is easy to mispronounce.
- `## Scene Hints`: one short line per scene saying what should be on screen. The html-animation skill builds from it.
- Never put a `Scene N` heading anywhere after `## Script` — the parser would treat it as spoken.

## Finish

Show the user the script in chat with its word count and ask for changes. Don't move on to teleprompter prep or recording until they approve.
