---
name: teleprompter-prep
description: Final delivery pass over an approved script.md before it is voiced. Adds pronunciation and breath cues, splits overlong lines, flags hard-to-say clusters, fixes the first line and checks pacing. Use whenever a script.md is approved and about to be recorded, or the user says "prep this for the teleprompter", "get this ready to record", "optimize for delivery". Written for a human reader in the teleprompter (`reelsmith record`); for a TTS video it is optional and reduced to the steps that change what the voice reads.
---

# Teleprompter prep

Takes an approved `videos/<name>/script.md` (format: `docs/script-format.md`) and does one more pass before it is voiced. The goal is a script that is easy to *say correctly on the first try*, and easy to *recover from cleanly* if a line goes wrong.

Every line in `script.md` is a re-record unit (sentence id `s<scene>.<line>`). This pass reduces how often the creator needs the re-record loop at all.

**Which voice path?**

- **Own recording** (`reelsmith record`): run every step below.
- **TTS** (`tts_voice:` in the frontmatter, `reelsmith tts`): optional. `>` cues are never sent to the TTS voice, so steps 1 and 2 do nothing for it. Instead, make sure every number, version and symbol is written in the line the way it should be heard ("Python three eleven", "script dot md"). Steps 3, 4 and 5 still help, because a TTS voice stumbles on the same lines a person does.

---

## What this skill does

### 1. Add `>` cues for hard names, acronyms and numbers

Walk every sentence. Put a `> say: ...` cue line directly ABOVE any line containing (the parser attaches every `>` line to the next sentence, so a cue below a line describes the wrong one):

- A number whose spoken form is not obvious from the digits (`900ms`, `$0.30/GB`, `NFSv4.1`).
- An acronym or name that is easy to fumble mid-sentence. Skip well-known ones.
- Any term where the written and spoken forms differ enough that a reader could say something else.

```
> say: nine hundred milliseconds
That rewrite can add 900ms to the request.
```

Do not over-cue. A cue on every line is noise the reader starts skipping.

### 2. Mark `> [breath]` before long sentences

A sentence of 16 or more spoken words (digits and acronyms counted as read aloud) gets a `> [breath]` cue on the line above it. Lines under 16 spoken words never get one.

```
> [breath]
Renaming a directory with a hundred thousand files can take minutes, because every file gets copied.
```

If a sentence needs a breath cue *and* runs over 18 words, split it instead (step 3).

### 3. Split any line over 18 words

One sentence per line stays absolute. If a sentence exceeds about 18 spoken words:

- Rewrite it as two sentences (two lines). Keep the named thing, the number and the meaning.
- Check that the second half reads as a continuation, not a new thought.

If you split more than one or two lines, the draft ran long. Flag that to the user instead of chopping everything.

### 4. Flag hard consonant clusters

Flag a sentence when 3 or more words in any window of 5 consecutive spoken words start with:

- **the same sibilant** (s, sh, z, or soft c as in "cell"), e.g. "the service sends six signals";
- **or the same plosive** (p, b, t, d, k including hard c, or g), e.g. "bad backups break builds".

Match by starting sound, not letter. Different sounds do not combine (an s-word and a sh-word are not a match).

For each flagged sentence (except s1.1, see step 5), **propose a rewrite** that keeps the same fact and let the user accept or keep the original. Do not auto-apply.

### 5. Make scene 1 line 1 easy to nail

The first line is the highest-stakes line: a bad first line means restarting the take. Check `s1.1`:

- Short (12 spoken words or fewer).
- No cue-worthy number or acronym right at the start.
- No sibilant or plosive cluster in the first 5 spoken words.

If `s1.1` fails any of these, rewrite it directly (the one line you fix instead of flagging), and confirm the fact still traces to research.md.

### 6. Check `wpm`

Recompute `words / (wpm / 60)` and compare it to a 45 to 65 s target. Cues and breath marks slow real delivery a little; do not inflate `wpm` to compensate. Leave `wpm` at 170 unless the user asks for another pace.

---

## Output

1. **The updated `script.md`:** same frontmatter and scene structure, with cues and breath marks added, long lines split and `s1.1` fixed if needed. Content (facts, numbers, names) stays unchanged: this pass edits delivery only.
2. **Delivery notes** under `## Delivery notes` at the end of script.md (replace the section if it exists; the parser ignores it), also printed in chat:
   - **Energy:** curious, not hype. Sound like you are explaining something interesting, not selling it.
   - **Pace:** about 170 wpm, or what the frontmatter says.
   - **Land the last line:** the Close is the line the viewer should remember. There is no spoken call to action, so deliver the takeaway like you mean it.
   - The lines you flagged for clusters but did not rewrite.
   - The lines with `> [breath]` marks.

---

## Workflow

1. Confirm `videos/<name>/script.md` exists and the user approved it (script-writing gate). If not, stop and ask.
2. Read every `### Scene N` block line by line.
3. Apply steps 1 to 5 in order.
4. Check `wpm` (step 6).
5. Write the updated `script.md` and the delivery notes, and print the notes in chat.
6. **Gate:** ask the user to approve the prepped script.
7. Then point at the next step:
   - Own recording: `reelsmith record`, open `http://localhost:4310`, pick the video, Teleprompter view. After the take, the take-review skill takes over.
   - TTS: ask the creator which voice, then `reelsmith tts videos/<name> --voice=<name>` (see the reelsmith-pipeline skill).

---

## Checklist

1. Every ambiguous number or acronym has a `> say:` cue on the line above it?
2. Every sentence of 16+ spoken words, and only those, has a `> [breath]` cue above it?
3. No line over 18 spoken words?
4. Every cluster flagged with a proposed rewrite, not silently applied?
5. `s1.1` short, clean and cue-free at the start?
6. `wpm` consistent with a 45 to 65 s runtime?
7. Facts, numbers and names unchanged from the approved script?
8. Delivery notes written under `## Delivery notes` and printed in chat?
9. TTS video: numbers and symbols written in their spoken form in the lines themselves?
