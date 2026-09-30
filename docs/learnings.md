# Technical Learnings

Running log of bugs fixed, decisions made, and things discovered. Newest first.

---

## 2026-09-27 — script-writing v3: Question Arc, hook tournament, blind read (`.claude/skills/script-writing/`)

This implements docs/script-research.md. The old prompt-cache-miss script scored 100/100 on the presence rubric and still read flat.

### What changed
- **script-writing:** `SKILL.md` is rewritten (291 lines), and the bulk moved into `references/`:
  - `hooks.md`: 20 formulas plus the 6-property panel.
  - `line-craft.md`: §5 rules and bans.
  - `blind-read.md`: the reader prompt, LEAK → fix table, named checks and stop rule.
- **Process:** one angle (one villain) → ≥10 hooks from ≥5 formulas → a line-by-line beat map → a one-pass draft → a blind read by a **fresh sonnet subagent** that sees only the title and lines → named checks → at most 3 rewrites, else change the angle → score.
- **research:** hands off `## Angle options` (2–3 angles, one villain each) instead of a hook line plus a compound thesis. The old thesis "byte-identical **and** reused in time" was the two-villain bug.
- **market.md §11:** 18 rows, 100 points. Gates are G1 hook (now needs you/your in s1.1–s1.2), G4 through-line, G12 blind read, G16 bans and G17 facts. Rows check what lines do, and every "yes" cites line ids.

### Rubric validity test (new §11)

| Script | Score | Gates failed |
|---|---|---|
| Old prompt-cache-miss (`git show HEAD:…`, 100/100 on the old rubric) | **18/100**. 26 if the Blueprint-only rows are judged on the lines alone | G1 (no you/your until s3.2), G4 (timestamp s4.2 + TTL s5.2), G12 (no log; the calibration reads also leaked), G16 ("It launched September 22nd, so…") |
| fixture-e2e | **6/100** | All five (S3 opener for a Lambda title, 5 LEAKs, "Follow for more", no research.md) |
| New prompt-cache-miss | **96/100** | None. Row 15 is "no": "breakpoint" isn't defined in speech |

Both flat scripts fail even with the paperwork rows granted, so no tightening was needed after the test. Drafting forced three wording fixes:
- G1 bans only *generic* questions ("have you ever wondered"). market.md §2 template 4 is itself a question.
- G4 allows row 10's "when not to bother" only if it follows from the same villain.
- "No four near-equal lines (±1)" now means four consecutive lengths spanning ≤2 words. The old script trips it at s3.1–s4.3.

### Blind reader calibration (fresh sonnet, blind-read.md §1 prompt)
- **Fixture:** 5 LEAK.
- **Old prompt-cache-miss:** 2 LEAK (s2.2 LOST "Manus", s6.2 DOUBT). A re-run with the added LEAK-FORK tag gave 1 LEAK (s2.2). The swipe line was s2.2 both times, and no callback word came back.
- **Gotcha: the reader misses a second villain.** Neither run flagged s5.2 (the TTL) as a fork; one called it "new relevant constraint", KEEP. The reader catches confusion and flat lines, not through-line drift. That's why the writer's "one villain" check and G4 exist.
- **Gotcha: reads vary between runs** (2 LEAK, then 1, on identical lines). A clean read is necessary, not sufficient.
- **Answer 3 (swipe line) is load-bearing.** In round 2 every row said KEEP, but the reader still named s2.2 as the swipe line. Counting a named swipe line as a LEAK caught it.

### Dogfood (prompt-cache-miss)
- **Angle:** A, the timestamp (5×5×5=125). B, the TTL (48), and C, the hit rate (36), were deferred.
- **Hooks:** 11 hooks from 11 formulas. Backfire won at 4.40; Misconception First was runner-up at 4.20.
- **Reads:** 4 reads, 3 rewrites (the cap):
  - **R1:** 12 KEEP / 2 LEAK. s2.2 LOST ("Who's Manus, and why does their number matter to my bill?"). s5.4 FLAT (the one-shot prompt, also the TTL's sibling).
  - **R2:** 0 LEAK rows but swipe line s2.2, because the name and stat arrived before their relevance. Fix: put the number and its consequence in one line, "At 100 input tokens per output token, that prompt is most of your bill.", and credit Manus on screen.
  - **R3:** clean. Named check 10 then found a /k/ cluster in s1.1, "caching can make your Claude". research §8's example hook has the same cluster. Changed "can" to "may".
  - **R4:** clean. 13/13 KEEP, swipe line none, callback words "down" and "bill".
- **Final:** 152 words, turn at 47.4%.
  - Hook: "Prompt caching may make your Claude bill go up, not down."
  - Last line: "Static above the breakpoint, changes below, and your bill goes down."

### Gotchas
- **A proper noun plus a stat leaks even with a descriptor.** "The agent startup Manus measured…" still got LOST. Viewers want relevance first.
- **research §3's Deadline example "Misses didn't" is false for Opus 5.5.** The write price fell from $6.25 to $5. Bank examples are shapes, not facts.
- **Stale references (out of scope, not edited):**
  - teleprompter-prep still calls the last line "the [TAKEAWAY] beat"; it's now the Callback.
  - CLAUDE.md's format example still uses the fixture's S3 opener.

---

## 2026-09-27 — Fix: word cues and subtitles 0.5s early in scenes 2+ (`runtime/animations.jsx`)

This resolves the "Subtitles and cues lead the audio by 0.5s" and "`validate-sync` skips the SubtitleRail check for the highest scene idx" bullets in the entry below.

- **Bug.** A scene has two start times. `audioStart` = Σdur of earlier scenes, where `sN.mp3` starts in `voiceover.mp3`. `windowStart` = `audioStart − 0.5` for scenes i>0, where `useSceneWindow(N)` mounts the Sprite so it can crossfade. `useWordTimings(N)` returned the raw scene-relative Whisper times, which count from `audioStart`. Every consumer compared those times against the window clock instead: `SubtitleRail` and `WordReveal` use `time − useSceneWindow(N).start`, and generated HTML uses the Sprite's `localTime − useWordCue(...)`. So every word fired `lead = audioStart − windowStart` (0.5s) early. Scene 1 has no lead, so it was fine.
- **Fix (one source of truth).** New internal `_sceneOffsets(scenes, idx, overlap)` returns `{ windowStart, audioStart, end }`, and `SCENE_OVERLAP = 0.5` is the one shared default. `useSceneWindow` is now built on the helper, with the same `{start, end}` output. The public `useWordTimings(N, {overlap})` adds `lead` to each word's `start`/`end`, so its times are on the window clock. `SubtitleRail`, `WordReveal` and every `useWordCue` consumer become correct with **no change to generated HTML**. `_useWordTimingsAbsolute` still returns absolute playhead times and reuses the helper for `audioStart`. `lead` is computed as `audioStart − windowStart` rather than hardcoded to `overlap`, so the `Math.max(0, …)` clamp for a sub-0.5s first scene is handled too.
- **Gotcha: custom overlap.** If you call `useSceneWindow(N, { overlap: X })`, you must pass the same `{ overlap: X }` to `useWordTimings`/`useWordCue` (new optional 3rd arg), or cues drift by the difference. `SubtitleRail`/`WordReveal` always use the default on both sides.
- **`validate-sync` rail check.** It no longer assumes the highest scene idx is a silent CTA. It skips only scenes whose `scenes.json` entry has no `words` (or an empty array). A narrated last scene with no rail now gets the same `missing-subtitle` warning as any other scene. Exit codes are unchanged, since the warning is not an error. The check also matches `useSceneWindow(N, {...})`, and `sceneIdx={1}` no longer matches `sceneIdx={12}`.
- **Verification method (frame-based, reusable).** Pick a word in scene N. Compute absolute `t = Σdur(1..N−1) + word.start`. Grab frames with `ffmpeg -ss <t−0.35> -i output.mp4 -frames:v 1` and `-ss <t+0.10>`. The before-frame must **not** yet highlight the word in the rail, and the after-frame must. With a 0.5s lead, the before-frame already highlights it. That makes it a sharp discriminator, and it is worth running on an old render first to see the bug. For a frame-exact check, use `-vf "select=eq(n\,K)"` with K = ⌈t·30⌉−1 and ⌈t·30⌉, since the renderer draws frame k at k/fps. Results on fixture-e2e:
  - Scene 2, "Lambda" (t = 8.063): before, scene 2 has no rail and only scene 1's "…BACKUPS." shows. After, LAMBDA is highlighted. Frame 241 (8.033) has no rail, and frame 242 (8.067) shows LAMBDA.
  - Scene 4, "Follow" (t = 32.297): before shows "YOU PAY TO REMOVE **THEM.**", and after shows **FOLLOW** with the CTA card starting.
  - Scene 1, "AWS" (t = 2.892): USED, then AWS. This is identical to the pre-fix render, so there is no regression.
  - The old render showed LAMBDA and FOLLOW highlighted in the before-frames.
- A side effect: the outgoing scene's rail and the incoming scene's rail no longer overlap during the 0.5s crossfade. The incoming rail now appears only when its first word is actually spoken.
- **Stale doc (not edited, out of scope):** `config/components.md` "`useWordTimings(sceneIdx)`" says the hook returns absolute times. It returns window-clock times, and it never returned absolute times (that is `_useWordTimingsAbsolute`).

---

## 2026-09-27 — Renderer E2E on v2 output (`videos/fixture-e2e`)

The v1 renderer consumed v2 `scenes.json` + `voiceover.mp3` with **no renderer changes**: 1047 frames in 61s, h264 720×1280 + aac, 34.879s (= Σdur).

- **Subtitles and cues lead the audio by 0.5s in scenes 2+.** This is v1 runtime behavior, not a v2 regression. `useSceneWindow(N)` pulls `start` back by the 0.5s overlap, while word times are relative to `sN.mp3`, which starts at Σdur(1..N−1) in the concatenated voiceover. `SubtitleRail` and `useWordCue` both measure from the pulled-back start, so a word at t is highlighted at Σdur − 0.5 + t. v1 concatenated the same way, so v1 videos have the same lead. The fix would go in `runtime/animations.jsx`: measure word times from the audio start (Σdur) rather than the Sprite start. It has not been applied.
- **Overlapping scenes stack badly by default.** `SubtitleRail` has `zIndex: 10`, and scene roots have no stacking context. During the 0.5s overlap, the outgoing scene’s subtitle therefore draws on top of the incoming scene. Fix in `index.html`: give each scene root `zIndex: N`, plus a short opacity fade-in (0.3s) so the overlap reads as a crossfade.
- **`validate-sync` skips the SubtitleRail check for the highest scene idx** because it assumes that scene is a CTA with no narration. When the CTA line is spoken inside the last narrated scene (as in fixture-e2e scene 4), a missing rail there goes unflagged, so add it by hand. The CTA card can live inside that scene, bound to `useWordCue(N, "follow")`.
- The React "change in the order of Hooks" console warning comes from `useWordCue` inside the Sprite render prop (the skill’s pattern). Those hooks are all `useContext`, so the warning is harmless.

---

## 2026-09-27 — Pipeline: take analysis (`pipeline/`)

### Jev model
- **Slug `typesafe/jev-1.13` exists** ("TypeSafe: Jev 1.13", provider TypeSafe, served as dated snapshot `typesafe/jev-1.13-20260917`). Context **32,000** tokens, max completion 28,800. Pricing **$0.042 per 1M input tokens** (`prompt: 0.000000042`), **output free** (`completion: 0`). Modality `text->decisions`. Siblings: `~typesafe/jev-latest` (alias that tracks the newest Jev), `typesafe/jev-router` (text router, no endpoints listed).
- **Gotcha — not in the default model list.** `GET /api/v1/models` only returns text-output models, so Jev is absent; use `GET /api/v1/models?output_modalities=all` (or `=decisions`), or `GET /api/v1/models/typesafe/jev-1.13/endpoints`.
- **Gotcha — not a chat model.** Jev only serves the Decisions API: `POST https://openrouter.ai/api/alpha/decisions` with `{ model, state, questions: { id: { type: "noul"|"choice"|"score", instructions, criteria } } }`. You get back typed probabilities (`answers.id.noul` = P(yes)), with no text and no reasoning. So `pipeline/jev.js` asks `noul` questions instead of using chat completions/JSON mode. All questions in one request share one `state`, so `classifyInsertions` batches up to 25 tokens per call (one `noul` per item). OpenRouter's example request (476 input tokens) cost about $0.00002.
- **Status on 2026-09-27:** the `OPENROUTER_API_KEY` in `.env` gets **401 "User not found."** from the Decisions endpoint, so the pipeline currently runs rules-only (`take.json.jev = null`). The Jev wiring is covered by stubbed unit tests. It needs a valid key to go live.

### Whisper silently drops disfluencies unless prompted
- On the edge-tts fixture, whisper **base and turbo both dropped "um", "uh" and the sentence restart** ("S3 is the… S3 is the oldest") when run without a prompt. The only trace was a gap in the timestamps. That defeats filler and restart detection entirely.
- Fix: pass a disfluent `initial_prompt` ("Umm, let me think like, hmm… So, uh, I-I mean, we, we should…"). With it, both models keep the fillers and the restart, and the clean take picks up no phantom fillers. The repo-root `whisper_timestamps.py` (v1 copy) has no `--prompt`, so the pipeline uses its own `pipeline/whisper_words.py` (same CLI, plus `--prompt` and per-word `conf`). You can switch back with `config/fillers.json` → `whisper.script: "root"`.
- An immediate repeat with no pause ("the the") is **never** transcribed. With a comma pause ("the, the"), base transcribes it; turbo does on a short clip but not always in full-take context. We don't try to catch un-transcribed voiced gaps: the clean take already has 0.2–0.36 s voiced gaps between words that come from timestamp imprecision, so the signal isn't discriminative.
- Whisper word **starts** right after a pause or cut can be up to 0.7 s early, while ends are accurate. analyze snaps word edges to `silencedetect` intervals before measuring pauses or cutting.

### Pipeline notes
- Alignment is a global DP. Among equal-cost paths, traceback prefers the latest transcript token, so the earlier copy of a stutter, restart or retaken line becomes an insertion and gets cut. A post-pass re-anchors sentences that the DP stitched together from two attempts. See the header of `pipeline/align.js`.
- Numbers are canonicalized by value on both sides ("1500" ≡ "fifteen hundred" ≡ "one thousand five hundred"; "$0.30" ≡ "30 cents"). Number tokens never fuzzy-match (million≠billion).
- Speaking rate measured word-to-word overstates WPM by about 25% compared with how it plays, so `wpm` adds the normalized inter-sentence gap.
- `cut.js` never re-runs whisper. Re-transcribing the cut output agreed with the arithmetic word times to about 13 ms median.
- API for `app/`: `await analyze(dir,{take})` (async), `await rerecord(dir,id,clip)` (async), `finalize(dir)` (sync), `audio.ensureWavs(base)` for webm → wav + hq.wav. The CLI also takes `--json`.

---

## 2026-09-27 — v2 fork

**v2 replaces TTS with the creator's own voice**, recorded via a local teleprompter web app (no Electron), rather than Gemini TTS. Whisper still transcribes, but now aligns the recorded take back to `script.md` instead of driving generation — flagging anything that would make the video look bad, allowing per-sentence re-records, then cutting fillers/silence to emit the same `scenes.json` + `voiceover.mp3` contract v1's renderer already consumes. Everything downstream (HTML animation, subtitles, render) is reused unchanged.

**Node binary path gotcha:** use `~/.nvm/versions/node/v22.17.0/bin/node`, not the plain `node`/`npm` on PATH. In non-interactive shells (scripts, cron, subprocesses), the shell profile prints `_nvm_load: command not found` and the PATH-resolved `node` can be broken. Any script that spawns a child Node process should use `process.execPath` instead of assuming `node` is on PATH.

**python3.11 rule still applies** — always invoke `python3.11` explicitly (never bare `python3`) for whisper/edge-tts scripts.

**ffmpeg** lives at `/opt/homebrew/bin/ffmpeg` (on PATH on this machine).

---

## 2026-04-20 — Renderer: HTTP server must serve from project root

**Problem:** `page.waitForFunction(() => window.__stage)` timed out after 30s.

**Root cause:** The HTTP server was set to serve from the video directory (`videos/example-hormuz/`). When the browser loaded `index.html` and encountered `src="../../runtime/animations.jsx"`, it resolved the URL relative to the document and requested `/runtime/animations.jsx`. The server looked for this inside the video dir — it doesn't exist there.

**Fix:** Set `serveDir = path.resolve(__dirname, '..')` (project root). Compute the HTML path relative to root: `htmlFile = path.relative(serveDir, htmlPath)`. Now `runtime/animations.jsx` is found correctly.

**Rule:** Always serve from project root. Any HTML that uses `../../runtime/animations.jsx` depends on this.

---

## 2026-04-20 — Claude can generate HTML directly (no API call)

**Discovery:** Claude Code has all config files and video.md in context. It can write `index.html` directly without calling the Anthropic API — saving cost and latency.

**How:** Read `config/*.md` + `videos/<name>/video.md`, write the HTML, then run TTS + renderer.

**When to use API:** Only when you want to experiment with Claude generating a novel interpretation or when the brief is too complex to implement by hand.

---

## 2026-04-20 — TTS: must use python3.11 explicitly

**Problem:** `python3` and `pip3` on this machine point to Python 3.14, which has a broken `pyexpat` symbol (`_XML_SetAllocTrackerActivationThreshold` not found in `/usr/lib/libexpat.1.dylib`).

**Fix:** Always use `python3.11` explicitly in all shell commands and the shebang line in `tts.py`.

**Never use:** `python3`, `python`, `pip3`, `pip` — these are broken on this machine.

---

## 2026-04-20 — Renderer: `waitUntil: 'load'` not `networkidle`

**Problem:** `page.goto(url, { waitUntil: 'networkidle' })` never resolved — CDN script loading and Google Fonts kept the network busy.

**Fix:** Use `waitUntil: 'load'` then separately `waitForFunction(() => typeof window.__stage !== 'undefined')`. This correctly waits for Babel to transpile and React to mount without depending on network silence.

---

## 2026-04-20 — Renderer: two rAF cycles required per frame

**Why:** After `window.__stage.setTime(t)`, React schedules a re-render via `setState`. The first `requestAnimationFrame` processes the state update; the second lets the browser paint. Screenshotting after only one rAF captures the previous frame.

**Code:**
```js
await page.evaluate(() =>
  new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
);
```

---

## 2026-04-20 — File:// protocol blocks external .jsx loading

**Problem:** First render attempt used `file://` URL. Playwright timed out because the browser blocked loading `../../runtime/animations.jsx` from a `file://` origin (security restriction).

**Fix:** Spin up a local Node HTTP server on a random port, serve the project over `http://127.0.0.1:{port}/`. All cross-file references work normally.

---

## 2026-04-20 — FFmpeg audio merging

**Pattern for merging video frames + audio:**
```bash
ffmpeg -y \
  -framerate 30 \
  -i "frames/frame%05d.png" \
  -i "voiceover.mp3" \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p \
  -c:a aac -b:a 192k \
  -shortest \
  output.mp4
```

`-shortest` trims to the shorter of video/audio. The audio input must come before the codec flags that apply to it.

---

## 2026-04-26 — TTS: Gemini TTS via OpenRouter + Whisper word timestamps

**Why:** Edge TTS produced robotic audio and gave no word-level timestamps, making within-scene text animation timing a guess.

**Solution:**
- `tts_gemini.mjs` — calls `google/gemini-3.1-flash-tts-preview` via OpenRouter (`OPENROUTER_API_KEY` in `.env`). Streams raw PCM/MP3 bytes, saves per-scene MP3.
- `whisper_timestamps.py` — runs Whisper on each scene MP3, outputs `[{word, start, end}]` JSON to stdout. Uses `python3.11`.
- `generate.js` runs both in sequence automatically.

**Setup:**
```bash
# 1. Add OPENROUTER_API_KEY to .env
# 2. Install Whisper
pip3.11 install openai-whisper

# 3. Run pipeline (Whisper model downloads ~1.5GB on first run, cached after)
node generate.js videos/<name> --skip-render
```

**Flags:**
- `--skip-tts` — reuse existing `voiceover/s*.mp3` and `voiceover.mp3`
- `--skip-whisper` — skip Whisper pass (use if `scenes.json` already has `words`)
- `--whisper-model=base` — use smaller/faster model (less accurate; `turbo` is default)

**`scenes.json` schema (extended):**
```json
[{ "idx": 1, "dur": 6.72, "file": "voiceover/s1.mp3",
   "words": [{"word": "Nine", "start": 0.12, "end": 0.38}, ...] }]
```

**Voices (set via `voice:` in video.md frontmatter):**
- `Charon` — informational, clear (default — good for news)
- `Fenrir` — excitable, punchy (good for hooks)
- `Sadaltager` — authoritative (good for thesis)
- Full list in `.claude/skills/tts/SKILL.md`

**Note:** `tts.py` (edge-tts) is kept for reference but is no longer called by `generate.js`. The active TTS entry point is `tts_gemini.mjs`.

---

## 2026-04-20 — TTS: must use python3.11 explicitly

**Problem:** `python3` and `pip3` on this machine point to Python 3.14, which has a broken `pyexpat` symbol (`_XML_SetAllocTrackerActivationThreshold` not found in `/usr/lib/libexpat.1.dylib`).

**Fix:** Always use `python3.11` explicitly in all shell commands and the shebang line in Python scripts (`tts.py`, `whisper_timestamps.py`).

**Never use:** `python3`, `python`, `pip3`, `pip` — these are broken on this machine.

---

## What good HTML output looks like

- `scenesSrc="scenes.json"` on `<Stage>` — no `TOTAL` constant; duration is computed from the sidecar
- `persistKey="unique-per-video"` on `<Stage>` (prevents playhead conflicts between videos)
- Scenes structured as `<Sprite {...useSceneWindow(N)}>` — timing derives from `scenes.json` with 0.5s overlap baked in
- All animation uses `clamp`, `Easing.*`, `slideUp`, `fade` helpers defined inline
- Background images use `KenBurns` (single image, zoom+pan), `ImageCut` (multiple images with cross-dissolve cuts), or `Parallax` (two-layer depth) — all from `animations.jsx`. `SceneBg` is deprecated. No image held >3 seconds.
- Narration text uses `<WordReveal sceneIdx={N} />` for word-synced reveals — powered by Whisper timestamps in `scenes.json`. Wrap in a styled `<div>` for font/size/color.
- Content positioned in bottom 40% of canvas (headlines ~y:940–1000, body ~y:1070–1110)
