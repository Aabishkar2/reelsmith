---
name: take-review
description: Read an analyzed take.json, explain what it found in plain language, and guide the creator through the re-record-or-accept loop and finalize step. Use whenever the user says "review my take", "how did the take go", "what should I re-record", or asks about a take after recording in the app. Hands off to the html-animation skill once finalize succeeds.
---

# Take Review Skill

This skill is how Claude reads the pipeline's analysis of a recorded take and turns it into plain guidance for the creator: what to re-record, what's fine as-is, and when to move on to finalize + HTML.

It does not do audio analysis itself — `pipeline/analyze.js` already did that (docs/spec.md §4, §6) and wrote `videos/<name>/take.json`. This skill's job is interpretation and workflow.

---

## Getting the current state

Two equivalent ways to see where a take stands:

1. **Read the file directly:** `videos/<name>/take.json` (schema: docs/spec.md §4). Read it with the Read tool like any other file.
2. **Run the CLI status command:**
   ```bash
   node pipeline/cli.js status videos/<name>
   ```
   Prints a summary table. Use this when you just want the headline counts without paging through the full JSON.

If neither exists yet (no `take.json`), the creator hasn't recorded and analyzed a take yet — point them at the app (see "Recording, if not done yet" below) rather than guessing.

**Node path gotcha (docs/learnings.md):** in a non-interactive shell, the bare `node` on PATH can be broken (`_nvm_load: command not found`) — if a plain `node pipeline/cli.js ...` fails to run, use the full path instead: `~/.nvm/versions/node/v22.17.0/bin/node pipeline/cli.js status videos/<name>`.

---

## Recording, if not done yet

The app is a local Node server + browser UI, not something Claude drives directly:

```bash
npm run app
```

Then open `http://localhost:4310` in a browser. Flow: **picker → teleprompter → review view**. The creator picks the video, records one long take in the teleprompter view (arm mic → countdown → scroll + record), then the app runs analyze automatically and drops them into the review view.

---

## Reading `take.json` (spec §4)

Key fields to look at:

- `status`: `"analyzed" | "needs-rerecord" | "ready" | "cut"` — the take-level verdict.
- `summary`: `{ ok, warn, bad, missing, fillers, estimatedCleanSec }` — the headline counts.
- `sentences[]`: per-sentence `status` (`ok|warn|bad|missing|rerecorded`), `flags[]`, `range`, `wer`, `wpm`.
- `cuts[]`: ranges the pipeline will remove automatically (fillers, stutters, over-long pauses, pre/post-roll) — these are handled for the creator, not something to act on.

## Flag types, in plain language (spec §6)

| Flag | What it means | Severity | What to tell the creator |
|---|---|---|---|
| `filler` | An "um/uh/like/so/basically..." got inserted | warn (bad if ≥3 in one sentence) | Usually nothing to do — it gets auto-cut. If a sentence has 3+, the sentence is marked `bad`: re-record it, the pile-up usually means the delivery was shaky there. |
| `stutter` | A repeated word or a false-start restart ("the the", "we we-") | warn, auto-cut | Nothing to do — the first occurrence is trimmed automatically. |
| `mismatch` | What was said differs too much from the script (WER > 0.15) | bad | Re-record. Either the wording drifted or a chunk was skipped/added. |
| `dropped-key` | A number, capitalized term, or backticked term from the script didn't come through | bad | Re-record. This is the flag that most directly risks a factual error on screen — never accept it. |
| `pause` | A gap >1.2s inside a sentence, or >2.0s between sentences | warn, auto-trimmed | Nothing to do — trimmed to 0.35s/0.6s automatically. |
| `pace` | Sentence ran <110 or >200 wpm | warn | Usually accept — cutting handles minor pace issues. Only re-record if it sounds genuinely rushed or dragging on playback. |
| `loudness` | Too quiet (<-30dBFS) or clipping | bad | Re-record — this is an audio-quality problem cutting can't fix. |
| `missing` | The sentence was never found in the take at all | missing | Re-record. It was skipped entirely (or said so differently the aligner couldn't find it — check by ear). |
| `order` | Spoken out of script order | bad | Re-record, or check whether the script order itself needs to change (rare — usually a delivery slip). |

## Rules of thumb

- **`bad` or `missing` → re-record.** Don't argue with these; they represent something a viewer would notice.
- **≥3 fillers in one sentence → re-record**, even if individually each filler is only `warn` — the pipeline itself escalates this to `bad` (spec §6), but call it out explicitly since it's easy to miss in a quick scan.
- **`warn`-only sentences → accept.** Filler, stutter, and pause warnings are auto-fixed by the cut step. Don't send the creator back to re-record something the pipeline already handles.
- **When everything is `ok`/`warn` (no `bad`, no `missing`) → the take is ready to finalize.**

---

## The re-record loop

Re-recording individual sentences happens **in the app's Review view**, not from the CLI — this is a live audio-capture UI action.

1. In Review view, each sentence shows its status and flags.
2. Press **R** on a flagged sentence to re-record just that line — countdown, mic capture, then the app calls `pipeline/splice.js` (via `POST /api/videos/:name/rerecord`) to whisper-verify the new clip matches the sentence and splice it in.
3. The sentence's status updates in place (`rerecorded`, or back to `bad` if the new take still doesn't match — re-record again).
4. Repeat until no `bad`/`missing` sentences remain (or the creator explicitly accepts a residual issue — the app has a "finalize anyway" override for edge cases).

If asked "how do I re-record sentence X" — tell the creator to open Review view for the video, find that sentence, and press R. Claude cannot record audio for them; this step is a human-in-the-loop action inside the app.

---

## Finalize

Once the take is clear (no `bad`/`missing`, or the creator has explicitly accepted the remainder):

```bash
node pipeline/cli.js cut videos/<name>
```

(Equivalent to clicking **Finalize** in the app's Review view — either path calls `pipeline/cut.js`.)

This writes:
- `videos/<name>/voiceover/sN.mp3` — per-scene clean audio
- `videos/<name>/voiceover.mp3` — concatenated clean audio
- `videos/<name>/scenes.json` — the v1 contract: `[{ idx, dur, file, words:[{word,start,end}] }]`

**Confirm both `scenes.json` and `voiceover.mp3` exist** after running this (`ls videos/<name>/`) before telling the creator the video is ready for the next step — don't take the command's exit code alone as proof.

---

## Handoff

Once `scenes.json` + `voiceover.mp3` are confirmed present, the take-review step is done. Hand off to the **html-animation** skill (`.claude/skills/html-animation/SKILL.md`) to write `videos/<name>/index.html` — it consumes `scenes.json` exactly as v1's renderer already does, unchanged.

---

## Workflow summary

1. Read `take.json` or run `node pipeline/cli.js status videos/<name>`.
2. Summarize: how many ok/warn/bad/missing, and which specific sentence ids are `bad`/`missing`.
3. For each `bad`/`missing` sentence, explain the flag in plain language (table above) and say "re-record this one."
4. For `warn`-only sentences, reassure the creator these are handled automatically — no action needed.
5. Tell the creator to fix flagged sentences in the app's Review view (press R per sentence), then re-check status.
6. Once clear, run `node pipeline/cli.js cut videos/<name>` (or confirm they clicked Finalize in-app).
7. Verify `scenes.json` and `voiceover.mp3` exist.
8. Hand off to the html-animation skill.
