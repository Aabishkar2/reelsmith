---
name: teleprompter-prep
description: Final delivery pass over an approved script.md before the creator records it — adds pronunciation/pause cues, splits overlong lines, flags hard-to-say clusters, and sets pacing. Use whenever a script.md is approved and about to be recorded, or the user says "prep this for the teleprompter", "get this ready to record", "optimize for delivery". Replaces v1's tts skill — there is no synthesized voice in v2, so this pass optimizes for a human reader, not an engine.
---

# Teleprompter Prep Skill

Takes an approved `videos/<name>/script.md` (docs/spec.md §3) and does one more pass over it before the creator opens the teleprompter app and records. v1's `tts` skill formatted text for a speech engine (punctuation-as-pause-hints, voice selection). v2 has no synthesized voice — the creator reads their own script live — so this skill instead makes the script easy to *say correctly on the first try*, and easy to *recover from cleanly* if a line goes wrong.

Every line in `script.md` is a re-record unit (spec §3: sentence id `s<scene>.<line>`). The goal of this pass is to reduce how often the creator needs to use that re-record loop at all.

---

## What this skill does

### 1. Add `>` cues for hard names, acronyms, and numbers

Walk every sentence. Add a `> say: ...` cue line directly ABOVE any line containing (the parser attaches every `>` line to the next sentence, so a cue below a line would describe the wrong one):
- A number whose spoken form isn't obvious from the digits (`900ms`, `$0.30/GB`, version strings like `NFSv4.1`).
- An acronym or service name that could be mispronounced or is easy to fumble mid-sentence (rare for well-known ones like S3/EC2/IAM — reserve cues for the genuinely tricky ones).
- Any term where the written and spoken forms diverge enough that a live reader could plausibly say something different than intended.

```
> say: nine hundred milliseconds
That rewrite can add 900ms to the request.
```

Don't over-cue. A cue on every line is noise the reader will start skipping. Reserve them for genuine ambiguity.

### 2. Mark `> [breath]` before long sentences

Any sentence of ≥16 spoken words (digits and acronyms counted as read aloud) gets a `> [breath]` cue on the line immediately above it — a visual signal in the teleprompter to breathe before starting, not mid-sentence. Lines under 16 spoken words never get one.

```
> [breath]
Renaming a directory with a hundred thousand files can take minutes, because every file gets copied.
```

If you find yourself adding a breath cue *and* the sentence is over 18 words, split it instead (rule 3) — a breath cue is for pacing, not for rescuing an overlong line.

### 3. Split any line over 18 words

Spec §3's one-sentence-per-line rule stays absolute, but a single sentence can still be too long to say cleanly in one breath at the target wpm. If a sentence exceeds ~18 words:
- Rewrite it as two sentences (two lines), preserving meaning and the specificity rule (script-writing skill) — don't lose the named service/number/pattern in the split.
- Re-verify linearity: the second half must still read as a continuation, not a new thought.

Do not split at exactly 18 — treat 18 as a hard ceiling the draft should already be under (script-writing targets 8–16). If you're splitting more than one or two lines per script, that's a signal the script-writing draft ran long; flag it to the user rather than mechanically chopping everything.

### 4. Flag hard consonant clusters and sibilant runs

Flag a sentence when ≥3 words in any window of 5 consecutive spoken words start with:
- **the same sibilant** — s, sh, z, or soft c (as in "cell") — e.g. "the service sends six signals" (4 s-starts in 5 words);
- **or the same plosive** — p, b, t, d, k (incl. hard c), or g — e.g. "bad backups break builds" (4 b-starts).

Count spoken words (digits read aloud: "22nd" = "twenty second"). Match by starting sound, not letter: soft c counts as s ("cell" matches "system"), hard c as k ("cache" matches "key"), and different sounds don't combine (an s-word and a sh-word are not a match).

For each flagged sentence (s1.1 is the one exception — rule 5), don't silently rewrite it — **propose a rewrite** to the user that keeps the same fact/number/service name but reorders or resyllabifies to remove the cluster, and let them accept or keep the original. These are stylistic judgment calls; don't auto-apply.

### 5. Ensure scene 1 line 1 is easy to nail in one take

The very first line of the recording is the highest-stakes line — a bad first take means restarting the whole take from the top (or living with a rougher opening). Specifically check line `s1.1`:
- Short (script-writing already targets ≤12 spoken words for it).
- No cue-worthy numbers or acronyms right at the start — if the hook line has a number, make sure it's the plainest possible spoken form.
- No sibilant/plosive cluster (rule 4) in the opening words — the first 5 spoken words of `s1.1`.

If `s1.1` fails any of these, rewrite it directly (this is the one line where you should just fix it, not merely flag it) and confirm the fact still traces to research.md and still satisfies the script-writing skill's Scene 1 rule (concrete, ≤12 spoken words, no greeting).

### 6. Set / adjust `wpm`

Re-check the frontmatter `wpm` against the actual script: recompute `words / (wpm/60)` and compare to a 45–65s target (config/market.md). If cues and breath marks you added meaningfully slow real delivery pace beyond what raw word count suggests, note that estimated duration will run a bit longer than the raw wpm math implies — don't inflate `wpm` to compensate, since breath pauses are supposed to happen. Leave `wpm` at the script-writing default (170) unless the user asks for a different target pace.

---

## Output

1. **Rewritten `script.md`** — same file, same frontmatter/scene structure, with `>` cues and `[breath]` marks added, overlong lines split, and (if applicable) `s1.1` fixed. Preserve every sentence id's underlying meaning and fact-traceability to research.md — this pass edits delivery, not content.
2. **A short "delivery notes" list**, written under `## Delivery notes` at the end of script.md (replace the section if it already exists; the parser ignores it) and also printed in chat:
   - **Energy:** curious, not hype — market.md §5: tone beats wording; sound like you're genuinely explaining something interesting, not selling it.
   - **Pace:** ~170 wpm (or whatever this script's frontmatter now says).
   - **Smile on the takeaway line** — the last line (the Callback beat — reuses the hook's key word) is the payoff the viewer should remember; there's no spoken CTA (market.md §4 bans outros), so deliver the takeaway like you mean it.
   - Any lines you flagged for sibilant/plosive clusters but didn't auto-rewrite — call these out explicitly so the creator knows to watch them.
   - Any lines with `> [breath]` marks — a quick "these are the natural breath points" note.

---

## Workflow

1. Confirm `videos/<name>/script.md` exists and is the approved draft (already scored ≥80 by the market-research skill, per the script-writing skill's final step). If it hasn't been scored, run the market-research skill first — don't prep an unscored draft.
2. Read every `### Scene N` block, line by line.
3. Apply steps 1–5 above in order: cues → breath marks → splits → cluster flags → scene-1 check.
4. Recompute word count and check `wpm` (step 6).
5. Write the updated `script.md`.
6. Write the delivery notes under `## Delivery notes` in script.md, and print them in chat.
7. Tell the user the script is ready to record: point them at `npm run app` → `http://localhost:4310` → pick the video → Teleprompter view.

---

## Checklist

1. Every ambiguous number/acronym has a `> say:` cue on the line above it?
2. Every sentence of ≥16 spoken words — and only those — has a `> [breath]` cue on the line above it?
3. No line exceeds 18 spoken words?
4. Every sentence with ≥3 same-sibilant or same-plosive word starts in a 5-word window flagged (and proposed rewrite offered, not silently applied)?
5. Is `s1.1` short, clean, cue-free at the very start, and still a valid Scene-1-context line per the script-writing skill?
6. Is `wpm` in frontmatter consistent with a 45–65s runtime for this word count?
7. Did content (facts, numbers, named services) stay unchanged from the approved script — only delivery mechanics touched?
8. Delivery notes (energy / pace / takeaway smile / flagged lines) written under `## Delivery notes` in script.md and printed in chat?
