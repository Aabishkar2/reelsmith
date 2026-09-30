---
name: take-review
description: Read an analyzed take.json, explain what it found in plain language, and guide the creator through the re-record-or-accept loop and the cut. Use whenever the user says "review my take", "how did the take go", "what should I re-record", or asks about a take after recording with `reelsmith record`. Hands off to the html-animation skill once `reelsmith cut` has written scenes.json and voiceover.mp3.
---

# Take review

This skill turns the pipeline's analysis of a recorded take into plain guidance: what to re-record, what is fine as it is, and when to move on to the cut and the animation.

It does no audio analysis itself. `reelsmith analyze` (run automatically by the recording app) already wrote `videos/<name>/take.json`. This skill interprets it and runs the workflow. The full schema and flag rules are in `docs/spec.md` §4 and §6.

The commands below are the `reelsmith` CLI (`npx reelsmith` in a project made by `init`, `node bin/reelsmith.js` in a clone of the framework). The escape hatch for all of them is `node pipeline/cli.js <command> videos/<name>`, the old entry point with the same flags.

---

## Getting the current state

Two equivalent ways:

1. **Read the file:** `videos/<name>/take.json`.
2. **Print the summary table:**
   ```bash
   reelsmith status videos/<name>
   ```

If there is no `take.json`, the creator has not recorded and analyzed a take yet. Point them at the app (below) instead of guessing.

---

## Recording, if not done yet

The app is a local server plus a browser UI. Claude does not drive it.

```bash
reelsmith record
```

Then open `http://localhost:4310`. Flow: **picker, teleprompter, review**. The creator picks the video, records one long take (arm the mic, countdown, scroll and record), the app runs the analysis and opens the review view.

To re-analyze a take from the terminal (for example after changing the script):

```bash
reelsmith analyze videos/<name>                        # latest take
reelsmith analyze videos/<name> --take=takes/take-02   # a specific take
reelsmith analyze videos/<name> --no-jev               # rules only, no Jev AI call
```

---

## Reading `take.json`

- `status`: `analyzed`, `needs-rerecord`, `ready` or `cut` for a normal take. `silent` (the mic delivered no audio) and `no-speech` (only Whisper silence hallucinations) come with `problem.message`: tell the creator to check the mic and record again.
- `summary`: `{ ok, warn, bad, missing, fillers, estimatedCleanSec }`, the headline counts.
- `sentences[]`: per sentence `status` (`ok`, `warn`, `bad`, `missing`, `rerecorded`), `flags[]`, `range`, `wer`, `wpm`, and `attempts[]` when a line was said more than once.
- `cuts[]`: ranges the cut removes automatically (fillers, stutters, long pauses, pre and post roll). Nothing to act on.

## Flags in plain language

| Flag | What it means | Severity | What to tell the creator |
|---|---|---|---|
| `filler` | An "um", "uh", "like", "basically" got inserted | warn (bad if 3+ in one sentence) | Usually nothing: it is cut automatically. With 3 or more the sentence is `bad`: re-record it. |
| `stutter` | A repeated word or a false start ("the the", "we we-") | warn, auto-cut | Nothing: the first occurrence is trimmed. A "possible hidden repeat" warn is not auto-cut: listen to it. |
| `mismatch` | What was said differs too much from the script (WER over 0.15) | bad | Re-record. The wording drifted or a chunk was skipped. |
| `dropped-key` | A number, capitalized term or backticked term did not come through | bad | Re-record. This is the flag that most directly risks a factual error on screen. Never accept it. |
| `pause` | A gap over 1.2 s inside a sentence, or over 2.0 s between sentences | warn, auto-trimmed | Nothing: trimmed to 0.35 s / 0.6 s. |
| `pace` | The sentence ran under 110 or over 200 wpm | warn | Usually accept. Re-record only if it sounds rushed or dragging on playback. |
| `loudness` | Too quiet (under −30 dBFS) or clipping | bad | Re-record. Cutting cannot fix audio quality. |
| `missing` | The sentence was not found in the take | missing | Re-record. It was skipped, or said so differently the aligner missed it (check by ear). |
| `order` | Spoken out of script order | bad | Re-record, or change the script order if that reads better. |
| `attempts` | The line was said completely 2 or more times | info | Nothing: the best attempt is kept and the others are cut. The creator can pick another attempt in the review view. |

## Rules of thumb

- **`bad` or `missing`: re-record.** These are things a viewer would notice.
- **3 or more fillers in one sentence: re-record.** The pipeline already marks it `bad`, but call it out.
- **`warn`-only sentences: accept.** Fillers, stutters and pauses are fixed by the cut.
- **No `bad` and no `missing`: the take is ready to cut.**

---

## The re-record loop

Re-recording happens **in the app's review view**. It is live audio capture, so the creator does it, not Claude.

1. Each sentence shows its status and flags.
2. The creator presses **R** on a flagged sentence to re-record just that line. The app whispers the clip, checks it matches the sentence and adds it as an attempt.
3. The sentence updates in place (`rerecorded`, or still `bad` if the new clip does not match).
4. Repeat until no `bad` or `missing` sentences remain, or the creator explicitly accepts a residual issue (the app has a "finalize anyway" override).

A clip that already exists on disk can be spliced from the terminal:

```bash
reelsmith rerecord videos/<name> --sentence=s2.1 --clip=takes/rr-s2.1-1
```

A clip that is bad, misses the sentence or is silent is rejected: the take stays as it was and the command exits 1 (the old `node pipeline/cli.js rerecord` exits 2). An accepted clip becomes another attempt; if the take's own attempt still scores higher, the take is kept and the command says so.

---

## Cut

Once the take is clear (no `bad` or `missing`, or the creator accepted the rest):

```bash
reelsmith cut videos/<name>
```

This is the same as **Finalize** in the review view. It writes:

- `videos/<name>/voiceover/sN.mp3`: clean audio per scene
- `videos/<name>/voiceover.mp3`: the scenes joined
- `videos/<name>/scenes.json`: `[{ idx, dur, file, words: [{ word, start, end }] }]`

**Confirm both `scenes.json` and `voiceover.mp3` exist** (`ls videos/<name>/`) before saying the voice is ready. The exit code alone is not proof.

Optional music bed: `reelsmith mix videos/<name> --track=music/<file>.mp3` (see `config/music.md`; without `--track` it uses `music.defaultTrack` from `reelsmith.config.json`).

---

## Handoff

With `scenes.json` and `voiceover.mp3` present, take review is done. Hand off to the **html-animation** skill to write `videos/<name>/index.html`.

## Workflow summary

1. Read `take.json` or run `reelsmith status videos/<name>`.
2. Summarize: counts of ok, warn, bad and missing, and the ids of every `bad` or `missing` sentence.
3. Explain each `bad` or `missing` flag in plain language and say "re-record this one".
4. Reassure the creator that `warn`-only sentences are handled.
5. Ask them to re-record in the review view (R per sentence), then check the status again.
6. When clear, run `reelsmith cut videos/<name>` (or confirm they clicked Finalize).
7. Verify `scenes.json` and `voiceover.mp3` exist.
8. Hand off to the html-animation skill.
