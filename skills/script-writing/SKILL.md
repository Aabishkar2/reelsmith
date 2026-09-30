---
name: script-writing
description: Write a simple, linear short-video explainer script that is read aloud, by the creator from the teleprompter or by a TTS voice. Use when the user says "write me a script", "script this", or wants a topic turned into a script. Explains the topic to a curious person, start to finish, in plain words that sound like a human talking. Writes videos/<name>/script.md, including `## Scene Hints` (and `## Voice direction` for TTS performance mode). Needs an approved research.md when one exists; the user approves the script before anything else happens.
---

# Script writing

Write a short explainer that is read aloud: live by the creator from the teleprompter, or by a TTS voice. Picture explaining the topic to a smart friend who does not work in the field. It should sound like a person talking, not like an article or an ad.

## Input

- `videos/<name>/research.md` if it exists. It must say `Status: APPROVED`. If it says `DRAFT`, stop and ask the user to approve it first (research skill).
- If research.md has `## Angle options`, use one angle and keep the whole script on it. If the user has not picked one, pick the strongest and say which in chat.
- Otherwise, use what the user gave you (a topic, a link, notes).
- `config/strategy.md` for the audience, voice and lens.

Only state facts from those sources. If a fact is missing, leave it out or ask. Never make up numbers.

If `videos/<name>/` does not exist, run `reelsmith new <name>` first. It writes a `script.md` template with the frontmatter filled in.

## Shape: one straight line

Go in order. One scene per step, usually 5 to 7 scenes.

1. **Hook.** What happened or what this is, in one plain sentence. Make them want the next line.
2. **What it is.** Explain the thing simply. Define any jargon the moment you use it.
3. **How it works.** The one or two ideas that make it make sense. Use an everyday comparison if it helps.
4. **Why it matters.** What changes for the viewer, their work or their money.
5. **What to do.** One practical thing they can try or check.
6. **Close.** One line that sums it up, so they walk away with it.

No twists required, no tricks. Each line follows naturally from the one before.

## Sounding human

- Talk like you would say it out loud: short sentences, contractions, "you".
- Plain words over fancy ones. If a 15-year-old would not get a word, explain it or swap it.
- One idea per line. Round, easy numbers ("20 cents", "a fifth").
- No hype ("game-changer", "insane", "revolutionary"), no filler ("in this video", "let's dive in"), no "like and subscribe".
- Read it in your head. If you would stumble or it sounds like a press release, rewrite it.

## Length

- 130 to 170 spoken words in total (about 45 to 60 seconds).
- Each line one sentence, roughly 8 to 16 words, so it can be said in one breath.
- Count words as they are said aloud: "5.5" = "five point five" = 3 words.

## Numbers and names for a TTS voice

A TTS voice reads the line itself, not the `>` cues. If the video uses TTS (`tts_voice:` in the frontmatter), write numbers, versions and symbols the way they should be heard: "one hundred fifty", "script dot md", "Python three eleven". Cues still help a human reader; they do nothing for TTS.

## Format

Write `videos/<name>/script.md`. The pipeline parses it, so keep the shape exactly (full reference: `docs/script-format.md`):

```markdown
---
title: Prompt caching, explained
topic: devtools        # a pillar slug from config/strategy.md
date: 2026-09-28
wpm: 170               # teleprompter scroll speed
style: motion          # optional; else reelsmith.config.json "style"
tts_voice: Leda        # TTS only; the creator's pick, never your own
---

## Script

### Scene 1
First sentence.
Second sentence.

### Scene 2
...

## Voice direction
One short paragraph: who is talking to whom, the tone, and which lines to land. Used only by `reelsmith tts --mode=performance`.

## Scene Hints
- Scene 1 (hook): overlay "150" counts up, then a phone frame slides in. Primitive: Counter + PhoneFrame
- Scene 2: ...
```

- `### Scene N` blocks, numbered 1, 2, 3 with no gaps. One sentence per line. Each line is a re-record unit with the id `s<scene>.<line>`.
- A line starting with `>` is a note for the human reader only (`> say: "five point five"`). It is never spoken or aligned, and it applies to the line **below** it. Use it only where a word is easy to mispronounce.
- `## Scene Hints`: one line per scene saying what is on screen and which primitive builds it. The html-animation skill builds from it.
- `## Voice direction`: only for TTS performance mode (`tts_mode: performance`). Write it when the video will use that mode.
- Never put a `Scene N` heading anywhere after `## Script` ends. The parser treats any `Scene N` heading as spoken.
- Never set `tts_voice` yourself. Ask the creator which voice.

## Finish

Show the user the script in chat with its spoken word count and ask for changes.

**Gate:** do not move on to teleprompter prep, `reelsmith tts` or recording until the user approves the script.

Optional, only when the user asks: score it with the market-research skill.
