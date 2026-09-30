# Pipeline internals (take analysis, alignment, cut)

> **Note:** this document describes the internals of the recording, analysis, alignment, cut and TTS pipeline that Reelsmith inherited from its predecessor. The contract for the framework as a whole (CLI, config, plugins, styles, skills) is [framework-spec.md](framework-spec.md). The helper scripts it names live in `tools/`, and `node pipeline/cli.js …` commands are available as `reelsmith …`.

Successor to the v1 pipeline: `video.md` → Gemini TTS → Whisper → `scenes.json` → Claude writes React HTML → Playwright frames → FFmpeg MP4.

**v2 change: the creator's own voice replaces TTS.** A local teleprompter web app records one long take, Whisper transcribes it, the pipeline aligns transcript to script, flags anything that would make the video look bad, lets the creator re-record flagged sentences, then cuts fillers/silence and emits the exact same `scenes.json` + `voiceover.mp3` contract v1's renderer already consumes. Everything downstream (HTML animation, subtitles, render) is reused unchanged.

Decisions locked (from owner):
- Voice only (no webcam) for now.
- Local web app (Node backend + browser UI), no Electron.
- One long take, then per-sentence re-records.
- Whisper (local, `openai-whisper`, python3.11) after recording — not live STT. Teleprompter scroll = WPM auto-scroll + keyboard control.
- Flag rule: anything that could make the video look bad (see §6).
- English only.
- Market research: one-time deep dive → `config/market.md`. Per-topic YouTube API research is a later phase (leave stub skill).
- Claude Code drives research / script / HTML / assembly via skills. No Anthropic API calls from app code.
- Jev AI (OpenRouter, `typesafe/jev-1.13`) for cheap structured decisions (§8).
- Fresh repo. Visual style = v1 output. Auto-upload: stub only.

---

## 1. Repo layout & ownership

```
reelsmith/
  CLAUDE.md                     [skills-agent]  agent entry point
  BIDS.MD                       [scaffold]      copy from v1
  package.json                  [scaffold]      NO new runtime deps beyond v1's (playwright, dotenv). Backend uses Node built-ins only.
  .env.example / .gitignore     [scaffold]
  config/
    design.md voice.md templates.md components.md   [scaffold] copy from v1
    market.md                   [research-agent] one-time market deep dive
    fillers.json                [pipeline]      filler word list + thresholds (§6)
  runtime/animations.jsx        [scaffold] copy from v1
  renderer/render.js            [fast-render] sharded renderer: JPEG frames via CDP piped into per-shard ffmpeg, concat; --draft / --from / --to; docs/fast-render.md
  tools/                        [scaffold] copy check-sync.js validate-sync.js preview.js search-images.js download-image.js from v1
  whisper_timestamps.py         [scaffold] copy from v1 (python3.11 shebang)
  pipeline/                     [pipeline-agent]
    whisper.js                  run whisper_timestamps.py on a wav → words[]
    script.js                   parse script.md → { meta, scenes:[{idx, sentences:[{id, text}]}] }
    align.js                    align script tokens ↔ transcript words
    analyze.js                  take audio + script → take.json (flags, fillers, ranges)
    cut.js                      take.json + audio → clean voiceover + scenes.json + voiceover/sN.mp3
    splice.js                   apply re-recorded sentence clips into take
    jev.js                      OpenRouter client for Jev
    audio.js                    ffmpeg helpers (convert, trim, concat, loudness stats)
    attempts.js                 best-attempt scoring/choice for repeated lines (§7a)
    denoise.js / denoise_dfn.py background-noise removal for the cut (§7c)
    whisper_words.py            whisper word timestamps, VAD-chunked interleaved windows + safety net (§7b)
    cli.js                      `node pipeline/cli.js analyze|cut|splice|finalize videos/<name>`
  app/                          [app-agent]
    server.js                   Node http server, port 4310, serves app/public + API (§5)
    public/index.html, app.js, style.css
  docs/spec.md (this) learnings.md
  videos/<name>/                per-video working dir (§2)
  .claude/skills/               [skills-agent] (§9)
```

Agents must only write files they own. Node: if a non-interactive shell cannot run a bare `node` (an nvm profile that only loads interactively), call it by its full path; scripts should not rely on PATH — use `process.execPath` when spawning child node. Python: the one that has `openai-whisper` (`core/env.js` finds it; `REELSMITH_PYTHON` forces one). FFmpeg: resolved by `core/env.js` (`FFMPEG_PATH`, `PATH`, the usual install dirs).

## 2. Per-video working directory

```
videos/<name>/
  research.md          from research skill (v1 format)
  script.md            §3 — the teleprompter script
  takes/
    take-01.webm       raw browser recording (opus)
    take-01.wav        16k mono (for whisper)
    take-01.hq.wav     48k mono (for final cut)
    take-01.json       raw whisper words for the take (word.suspect = unresolved long word, §7b)
    take-01.whisper.json  how take-01.json was made { mode, model, prompt, chunks } (cache key)
    rr-<sentenceId>-<n>.webm/.wav/.hq.wav/.json   re-record clips
    take-01.clean.wav  denoised take-01.hq.wav (§7c) — what the cut plays; re-record clips get rr-….clean.wav too
    take-01.clean.json how/when it was made { settings, engine, warning, lagMs, srcMtimeMs }
  settings.json        per-video switches, e.g. { "denoise": false } (default from config denoise.enabled)
  take.json            §4 — current analysis state (single source of truth)
  voiceover/sN.mp3     per-scene clean audio (words in scenes.json are relative to these)
  voiceover.mp3        concatenated clean audio
  scenes.json          v1 contract: [{ idx, dur, file, words:[{word,start,end}] }]
  index.html           HTML animation (Claude writes, v1 skill)
  output.mp4           final render (preview gate applies)
  draft.mp4            render --draft: 15 fps, 0.75× size, with voice (~30 s) — what the user watches at the preview gate
  clip-<a>s-<b>s.mp4   render --from=a --to=b: one range, for checking a fix
  frames/render-cache/ per-render segment cache (crash resume); gitignored via frames/
  publish.md           title/description/tags (stub skill)
```

## 3. `script.md` format

```markdown
---
title: Claude prompt caching: the timestamp trap
topic: ai-ml
date: 2026-09-27
wpm: 170            # optional, teleprompter auto-scroll speed
---

## Script

### Scene 1
Prompt caching may make your Claude bill go up, not down.
It takes one line at the top of your prompt.

### Scene 2
Your agent resends that exact prompt on every turn.
> say: "one hundred", not "a hundred"
At 100 input tokens per output token, that prompt is most of your bill.
```

Rules:
- `### Scene N` blocks, N 1-based, contiguous.
- **One sentence per line** inside a scene. A line is one sentence (the unit of re-recording). Sentence id = `s<scene>.<line>` e.g. `s2.1`.
- Blank lines ignored. Lines starting with `>` are teleprompter-only notes (pronunciation cues, `[pause]`), never spoken, never aligned.
- Numbers may be written as digits; `script.js` normalizes for alignment (see §7).
- Sections after `## Script` are allowed and ignored by the parser: `## Scene Hints` (per-scene visual plan incl. the frame-0 overlay — consumed by the html-animation skill and scored by the rubric), `## Blueprint` (script-writing skill's working notes: angle block, scored hooks, beat map, blind-read log), `## Score` (market-research rubric output), `## Delivery notes` (teleprompter-prep output). Only `### Scene N` blocks under `## Script` are spoken/aligned.
- `>` cue lines attach to the sentence BELOW them (parser rule). Put `> say:` / `> [breath]` cues on the line above the sentence they describe. A `>` line outside any scene (e.g. right after the frontmatter) is a file-level note and ignored.
- Frontmatter `topic` is one of `aws | ai-ml | swe | devtools`. Word counts anywhere in this repo mean *spoken* words (digits/acronyms counted as read aloud).

## 4. `take.json` schema

```jsonc
{
  "version": 1,
  "video": "lambda-cold-starts",
  "take": "takes/take-01",                 // base path without extension
  "status": "analyzed" | "needs-rerecord" | "ready" | "cut" | "silent" | "no-speech",
  "problem": { "kind": "silent" | "hallucination", "message": "Take is silent — the mic delivered no audio. …" },   // only for silent / no-speech
  "audio": { "durationSec": 71.2, "sampleRate": 48000, "meanVolumeDb": -18.2, "maxVolumeDb": -1.1, "clipping": false },
  "attemptRef": { "speechDb": -25.1, "wpm": 190, "conf": 0.97 },   // take medians the attempt scores are relative to (§7a)
  "words": [ { "i": 0, "word": "S3", "start": 0.31, "end": 0.72, "conf": 0.98 } ],   // whisper words, take-relative
  "sentences": [
    {
      "id": "s1.1", "scene": 1, "line": 1,
      "text": "S3 is the oldest and most widely used AWS service.",
      "status": "ok" | "warn" | "bad" | "missing" | "rerecorded",
      "range": { "start": 0.31, "end": 3.9 },        // in take audio (null if missing)
      "wordIdx": [0, 8],                              // inclusive span into words[] (null if missing)
      "edgeGuard": { "head": 0.29, "tail": 0.12 },   // optional: range extended over untranscribed speech energy at its edges (§7b)
      "wer": 0.0,
      "wpm": 148,
      "flags": [ { "type": "filler", "severity": "warn", "detail": "um @1.20-1.45", "range": {"start":1.2,"end":1.45} } ],
      "source": { "kind": "take" } | { "kind": "rerecord", "clip": "takes/rr-s1.1-1", "range": {"start":0.1,"end":3.5} },
      "attempts": [                                   // every complete saying of the line (§7a); [] if missing
        { "n": 1, "source": "take", "range": [0.31, 3.9], "wer": 0.0, "wpm": 148, "conf": 0.97, "score": 0.93,
          "breakdown": { "accuracy": 1, "fluency": 0.85, "confidence": 0.97, "audio": 1, "pace": 0.9,
                         "fuzzyRate": 0, "fillers": 1, "repeats": 0, "pauses": 0, "meanVolumeDb": -24.8, "clipping": false, "bad": false },
          "aligned": true, "chosen": true },          // aligned = the take attempt take.json's words/cuts use
        { "n": 2, "source": "rerecord", "clip": "takes/rr-s1.1-1", "range": [0.1, 3.5], "…": "…", "chosen": false,
          "result": { "wer": 0, "wpm": 150, "flags": [], "heard": "…", "clipStatus": "ok", "source": { "kind": "rerecord", "…": "…" } } }
      ],
      "pick": { "source": "take", "n": 1, "start": 0.31 } | { "source": "rerecord", "n": 2, "clip": "takes/rr-s1.1-1" }   // optional manual choice
    }
  ],
  "cuts": [ { "start": 1.2, "end": 1.45, "reason": "filler:um" } ],   // ranges to remove from take audio
  "summary": { "ok": 12, "warn": 2, "bad": 1, "missing": 0, "fillers": 5, "estimatedCleanSec": 66.4 },
  "jev": { "model": "typesafe/jev-1.13", "reviewedAt": "...", "notes": "..." }   // optional
}
```

## 5. App API (server.js, port 4310)

All JSON. Paths are video names (dir under `videos/`).

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| GET | `/api/videos` | | `[{ name, hasScript, hasTake, status }]` |
| GET | `/api/videos/:name/script` | | parsed script (§3 → `script.js` output) + raw markdown |
| POST | `/api/videos/:name/take` | raw `audio/webm` body, header `x-take-kind: take\|rerecord`, `x-sentence-id` for rerecord | `{ take: "takes/take-01" }` — saves webm, converts wav + hq.wav |
| POST | `/api/videos/:name/analyze` | `{ take }` | runs `pipeline/analyze.js` → writes and returns `take.json`. Silent take (max volume < `silence.maxDb`) → 422 `{ error, code: 'SILENT_TAKE', take }` in seconds, whisper never runs, `take.json.status = 'silent'` |
| POST | `/api/videos/:name/rerecord` | `{ sentenceId, clip }` | runs `pipeline/splice.js` — whisper the clip, verify it matches the sentence, add it as an attempt (§7a); the best attempt (or the user's pick) drives the sentence source + status. Returns `{ ok, kept: 'rerecord'\|'take', reason, sentence, summary }`. A silent clip is rejected before whisper (`ok:false, silent:true`). |
| POST | `/api/videos/:name/pick` | `{ sentenceId, n }` or `{ sentenceId, source: 'auto' }` | persists / clears `sentence.pick` (§7a), re-runs analyze on the same take (cached whisper words) so words/cuts follow the chosen attempt. Returns `take.json`. |
| GET | `/api/videos/:name/take.json` | | current `take.json` |
| GET | `/api/videos/:name/audio?src=takes/take-01.hq.wav&start=1.2&end=3.4` | | audio slice (wav) for playback in review UI. No start/end → whole file. |
| POST | `/api/videos/:name/finalize` | | runs `pipeline/cut.js` → `voiceover/sN.mp3`, `voiceover.mp3`, `scenes.json` (from the denoised sources unless settings.json turns denoise off, §7c). Returns `{ scenes, totalSec, warnings }` |
| GET / POST | `/api/videos/:name/settings` | POST `{ denoise: bool }` | per-video switches (`videos/<name>/settings.json`) → `{ denoise, defaultDenoise, engine }` |
| POST | `/api/videos/:name/denoise` | `{ src: "takes/take-01.hq.wav" }` | makes/reuses `<base>.clean.wav` for the review A/B player → `{ clean, engine, warning, cached }` |
| GET | `/api/health` | | `ok` |

Static: `/` serves `app/public`. Long-running ops (analyze/finalize) may take 10–60s (whisper turbo on CPU); server responds when done, UI shows progress spinner. No websockets needed.

## 6. Flag rules ("anything that could make the video look bad")

Defaults live in `config/fillers.json` (pipeline owns). Severity: `warn` = auto-fixable by cutting, shown for info; `bad` = recommend re-record; `missing` = sentence never spoken.

| Flag type | Detection | Severity |
|---|---|---|
| `filler` | inserted transcript token in filler list (`um uh uhm er ah hmm like you-know sort-of kind-of basically actually literally right okay so` — "like/so/right/okay" only when inserted, never when in script) | warn; `bad` if ≥3 in one sentence |
| `stutter` | inserted token equal to next/prev script token (repeat: "the the", "we we"), or partial word restart | warn (auto-cut first occurrence) |
| `mismatch` | sentence WER > 0.15 after normalization | bad |
| `dropped-key` | a script token containing a digit, a capitalized non-initial word, or a backticked term is missing/substituted | bad |
| `pause` | silence gap > 1.2s inside a sentence, or > 2.0s between sentences | warn (auto-trim to 0.35s inside, 0.6s between) |
| `pace` | sentence WPM < 110 or > 200 | warn |
| `loudness` | sentence mean volume < -30dBFS (too quiet) or clipping in range | bad |
| `missing` | no alignment found for sentence | missing |
| `order` | sentence spoken out of script order | bad |
| `attempts` | the line was said ≥2 times completely (§7a) — detail `3 attempts — kept #1 (score 0.91 vs 0.84, 0.62); others auto-cut` (+ `· your pick`) | info (never changes status) |

Severity `info` (added with `attempts`) is informational only: it never changes a sentence's status. A non-chosen complete attempt is cut like a restart (its words get role `restart`, cut reason `attempt:…`) and is summarised by the one `attempts` flag instead of a `stutter` "restart …" flag. `stutter` also carries `possible hidden repeat @t1–t2` (warn, NOT auto-cut) for a long word over continuous speech the whisper safety net could not resolve (§7b).

Take-level guards (not sentence flags): a take whose max volume is below `silence.maxDb` (−60 dBFS) is `status: 'silent'` and never transcribed; a transcript made of Whisper silence hallucinations (`silence.hallucinations`, e.g. "Thank you." ×13) with ≤ `silence.hallucinationMaxFound` of the sentences found is `status: 'no-speech'`. Both carry `take.problem.message`, which the app shows as a banner.

`cuts[]` = union of: filler ranges (with 40ms padding), stutter first-occurrence ranges, pause over-trim, and any transcript region not belonging to any sentence (pre-roll, post-roll, abandoned restarts) — computed in analyze, applied in cut.

## 7. Alignment contract (`align.js`)

- Normalize tokens: lowercase, strip punctuation (keep inner apostrophes), expand common numerals (`900ms` → `nine hundred milliseconds`, `$0.30` → `thirty cents`, `3` → `three`, `S3`/`EC2`/`IAM` kept as-is), hyphen split.
- Global alignment (Needleman–Wunsch / LCS-style DP with substitution cost using Levenshtein similarity ≥0.7 = match) of the full script token sequence vs full transcript token sequence. Must handle ~600×700 tokens fast (pure JS, O(n·m) fine).
- Output per script token: `{ matchedWordIdx | null, op: 'match'|'sub'|'del' }` and per transcript token: `op: 'match'|'sub'|'ins'`.
- Sentence range = [first matched word start, last matched word end]. Insertions between two matched words of the same sentence belong to that sentence.
- Handle **restarts**: if the speaker restarts a sentence, the earlier partial attempt appears as insertions; choose the later, more complete attempt when both exist (prefer the alignment with the higher match count per sentence — implement by running DP with a small penalty for early partial matches, or a post-pass that re-anchors a sentence to a later duplicate span with better coverage). Document what is implemented.

**Implemented** (see the `align.js` header): DP tie-break keeps the latest attempt; pass C re-anchors a sentence stitched from two attempts; pass D recovers out-of-order sentences. §7a then chooses between complete attempts on quality.

## 7a. Attempt selection (`pipeline/attempts.js`, run in `analyze.js` / `splice.js`)

When a line is said more than once, the best attempt is kept — not simply the latest.

1. **Find.** For each found sentence, candidates are the adopted span plus every unowned transcript span between the previous and the next found sentence that the sentence fits (align.js `fit`) with coverage ≥ `attempts.minCoverage` (0.8). Partial attempts stay restarts (§6 `stutter`). Each accepted re-record clip (`takes/rr-sX.Y-N`) is another candidate.
2. **Score** (deterministic, weights in `config/fillers.json` `attempts`): accuracy = 1 − WER − 0.5·fuzzy-match rate (weight 0.5); fluency = 1 − 0.15/filler − 0.2/repeat or internal restart − 0.15/pause > `pauseInsideSec` (0.2); confidence = mean whisper `conf` (0.1); audio = speech RMS vs the take median (`attemptRef.speechDb`): −1/12 per dB below median − 2 dB, −0.5 if clipping (0.1); pace = 1 − |wpm − take median wpm| / median / 0.5 (0.1).
3. **Choose.** A manual `pick` always wins. Otherwise attempts that would be `bad` (WER > 0.15, dropped key term, ≥3 fillers, too quiet, clipping) lose to any non-bad one; among the rest the best score wins, and every attempt within `tieEpsilon` (0.02) of the best counts as a tie → the **latest** wins (the pre-attempts behaviour). Unscored attempts from older take.json files: an accepted re-record always wins, a take attempt always loses.
4. **Apply.** The chosen take attempt is (re-)anchored in the alignment, so range / wordIdx / wer / wpm / heard / flags come from it; the other attempts are cut. If a re-record wins, the sentence becomes `rerecorded` and the take analysis is kept in `sentence.take`. One `attempts` info flag summarises the choice.
5. **Persist.** Re-analyzing the same take keeps re-record attempts, `pick`, and `rerecords[]` (same sentence id + text). `POST /pick` writes `pick` and re-runs analyze.

Aligner post-passes added with attempts (`align.js` header): **pass C** also re-anchors on a retake that starts at the sentence's 2nd token (whisper dropped the 1st word) when ≥3 inserted tokens there repeat the opening; **pass F (split)** re-fits a sentence whose span swallowed an insertion run plus a few anchors borrowed from the next line's retake, when that cuts its errors by ≥2; **pass E (edge compaction)** moves an edge anchor tied to a far duplicate ("…over you, and you feel you") to the identical inserted token next to the sentence body.

## 7b. VAD-chunked transcription (`pipeline/whisper.js` + `whisper_words.py`)

Whisper over a whole take hears a repeated phrase once and stretches one word over the hidden repeat (in one real take, "how" 25.52–28.04 covered a second "Success seems to depend…"), so the aligner never sees the second attempt. `whisper.mode: 'chunked'` (default):

1. `audio.energyVad` splits the take at pauses ≥ `whisper.chunk.minSilenceSec` (0.25 s) whose 20 ms frame RMS is below floor + `vadFrac`·(speech − floor) (floor/speech = 10th/70th percentile of the take's frame dB — silencedetect's sample-peak test misses pauses under room noise). Chunks < `minChunkSec` merge into a neighbour; each is padded ≤ `padSec` into its pauses.
2. One python process transcribes the chunks packed into windows of ≤ `packSec` (24 s) with `sepSec` (1 s) of silence between chunks, **interleaved** (window p gets chunks p, p+P, …) so neighbouring chunks — a line and its retake — never share a whisper window. `condition_on_previous_text=False`; the disfluent prompt is kept. Words are mapped back to take time; words inside separators (silence hallucinations) are dropped. The encoder output is reused for the word-alignment pass (≈ one encoder pass per window, so runtime ≈ whole-file mode).
3. Safety net (`whisper.net`): a word longer than max(1.0 s, 3 × the take's median sec/char × its length) that is ≥ 60 % speech frames gets its chunk split at finer energy dips and re-transcribed; if that yields more words and no long word the chunk's words are replaced, else the word is marked `suspect` and analyze adds a `stutter` warn "possible hidden repeat @t1–t2".

The cache (`<base>.json`) is reused only if `<base>.whisper.json` matches the mode/model (a cache without it counts as `whole`). Packed windows cap whisper's temperature fallback at 0.4 (each fallback is a full re-decode).

Known limit: whisper sometimes omits a short, soft word at a chunk start ("It depends" → "Depends", "But I don't" → "I don't"). WER counts it missing. So the audio isn't cut, analyze's **edge guard** (`thresholds.edgeGuardSec`, 0.8 s) extends a sentence's range over untranscribed speech energy (energy VAD, no whisper word at all) running into its first word or out of its last. It never extends past the midpoint to the neighbouring word, and it records the extension in `sentence.edgeGuard`.

## 7c. Background-noise removal (`pipeline/denoise.js`)

Whisper and analysis always read the ORIGINAL audio, because denoisers smear word onsets. `cut.js` reads the denoised sibling of every source it plays: the take and each re-record clip, including the room tone kept between sentences.

- `ensureClean(src)` writes `<base>.clean.wav` (48 kHz mono) + `<base>.clean.json`. It regenerates only when the clean file is missing, the source is newer than the one denoised (`srcMtimeMs`), or `denoise.{engine,attenLimitDb,fallback}` changed. It never writes the source.
- Engine `deepfilternet`: `pipeline/denoise_dfn.py`, run by `denoise.python`. DeepFilterNet 0.5.6 pins `numpy<2` and needs a torch-matched `torchaudio`, so install it in its own venv, not the Whisper env. `attenLimitDb` (35) caps the attenuation so the voice doesn't sound underwater.
- Fallback: when DFN is missing or fails, or `engine: 'afftdn'`, ffmpeg runs `highpass=80,lowpass=12000,afftdn`. This is weaker on non-stationary noise like barks. It adds a warning to `take.cut.warnings` and CLI output, and never blocks the cut.
- Every output is checked (48 kHz, same length) and re-aligned to the source. `estimateLag` cross-correlates loud windows; afftdn adds ~25 ms, which would otherwise shift every cut and word time.
- Gate (`denoise.gate`): in each rendered scene, 10 ms frames outside the kept words (± `padSec`) that are > `aboveRoomDb` (18) over the scene's room tone are pulled down to room tone with smooth gain ramps. This catches a bark in a pause or gap that the engine left.
- `videos/<name>/settings.json { "denoise": false }` switches it off per video. `take.cut.denoise` records `{ engines, gatedFrames, gate }` or `{ off: true }`. The cut has no loudness-normalization step, so the mp3 encode is the last stage.

## 8. Jev (`pipeline/jev.js`)

OpenRouter chat completions, model from env `JEV_MODEL` default `typesafe/jev-1.13`, key `OPENROUTER_API_KEY` (in `.env`). Verify the slug exists via `GET https://openrouter.ai/api/v1/models` (public) and record real context/pricing in `docs/learnings.md`. Use JSON-mode / structured output if the model supports it; otherwise prompt for strict JSON and parse defensively.

Jev decides (cheap, structured, non-creative):
1. `reviewSentence({ scriptText, heardText, flags })` → `{ verdict: "keep"|"rerecord", reason }` — used only for `warn` sentences that are borderline (e.g. paraphrase that keeps meaning vs a real error). Deterministic rules decide clear cases; Jev breaks ties.
2. `classifyInsertion({ before, token, after })` → `{ isFiller: bool }` for ambiguous inserted tokens (`like`, `so`, `right`) — batch all ambiguous tokens in one call.
Both must be optional: if no API key or call fails, fall back to rules and mark `take.json.jev = null`. Never block the pipeline on Jev.

## 9. Skills (`.claude/skills/`) — skills-agent

- `market-research/SKILL.md` — reads `config/market.md`; phase-2 stub section for YouTube Data API per-topic pull (documented, not implemented).
- `research/SKILL.md` — copy v1, unchanged.
- `script-writing/SKILL.md` — adapted from v1: writes `script.md` (§3) for a **human reader**, one sentence per line, 130–170 spoken words, 6–8 scenes, informed by `config/market.md` hook/pacing rules. Keeps v1 linear structure + specificity rules. Adds `>` cue lines for hard pronunciations.
- `teleprompter-prep/SKILL.md` — replaces v1 `tts` skill: final pass on `script.md` for spoken delivery (breath points, number spelling in cues, tongue-twister rewrites).
- `take-review/SKILL.md` — how Claude reads `take.json`, explains flags to the user, runs re-record loop guidance, then `finalize`.
- `html-animation/SKILL.md` — copy v1, unchanged.
- `publish/SKILL.md` — writes `publish.md` (title ≤60 chars, description, tags, hashtags) from script + market.md. YouTube upload = documented stub at the time (now `plugins/publish-youtube`).

## 10. Pipeline CLI

```
node pipeline/cli.js analyze  videos/<name> [--take=takes/take-01] [--no-jev] [--whisper-model=turbo]
node pipeline/cli.js rerecord videos/<name> --sentence=s2.1 --clip=takes/rr-s2.1-1
node pipeline/cli.js cut      videos/<name>            # = finalize
node pipeline/cli.js status   videos/<name>            # prints summary table
```

Test fixture: `pipeline/test/` — generate a synthetic "bad take" with edge-tts (`python3.11 -c "import edge_tts"` is installed in v1's env; copy v1 `tts.py` to `pipeline/test/tts.py`) from a script that injects fillers, a stutter, a wrong number and a long pause; assert analyze flags them. Also test clean case.

## 11. Non-goals now

Webcam, live STT, YouTube API research, upload, multi-language, Electron.

## 12. TTS voice path (`pipeline/tts.js`)

An alternative to RECORD → analyze → take-review → cut, and the default from the first TTS video on. It writes the same contract as `cut` (`voiceover/sN.mp3`, `voiceover.mp3`, `scenes.json`), so everything downstream is unchanged.

```
node pipeline/cli.js tts videos/<name> --voice=<name> [--model=…] [--speed=1.15] [--timings=auto|whisper|estimate] [--cta=N] [--force] [--json]
node tools/mix-music.js videos/<name> --track=music/clean-soul.mp3        # → voiceover-mix.mp3, bed 6 dB under
```

- **Synthesis:** one `POST https://openrouter.ai/api/v1/audio/speech` per `script.md` sentence (`{ model, voice, input, response_format: "mp3" }`, `Authorization: Bearer $OPENROUTER_API_KEY`). A 401/403 fails at once with "OPENROUTER_API_KEY rejected — put a working key in .env". 429/5xx are retried twice. Raw PCM responses (`audio/L16`, `audio/pcm`) are decoded too.
- **Cache:** `voiceover/tts/<sha1(model|voice|text)>.wav`, trimmed of head/tail silence (−50 dB). A re-run only calls the API for changed sentences (`--force` re-generates all). The key is only needed when a call is actually made.
- **Speed:** default 1.15× (`config/tts.json`), applied with ffmpeg `atempo` (pitch kept) to cached clips as `<hash>-x<speed>.wav`. Changing speed never re-calls the API. Sentence gaps (0.35 s) and scene tails (0.6 s) are divided by the speed.
- **Settings precedence:** flag > script.md frontmatter (`tts_model`, `tts_voice`, `tts_speed`) > `voiceover/tts/meta.json` from the last run (model + voice) > env (`TTS_MODEL`, `TTS_VOICE`, `TTS_SPEED`) > `config/tts.json`. Model default `google/gemini-3.8-flash-tts`. **No default voice**: the creator picks one per video, and a missing voice is an error that lists how to set it.
- **Word timings:** `auto` runs Whisper (`pipeline/whisper.js`, whole-file mode, no disfluency prompt) on the final sped-up voice `voiceover/tts/voice-<content hash>.wav` (so its cache is reused when nothing changed). Each word is assigned to the sentence clip it overlaps most and clamped into it. The fallback, when python3.11 + whisper aren't available, is a length-weighted estimate per sentence. `meta.json` and the CLI output say which was used.
- **Durations:** `dur` is the exact scene wav length, and `voiceover.mp3` is encoded from the concatenated scene wavs, so Σ`dur` matches it to within mp3 padding (≪ 0.1 s).
- **Record:** `voiceover/tts/meta.json` = `{ model, voice, speed, sentenceGapSec, sceneTailSec, format, timings, timingsFallback?, sentences, totalSec, at }`. `scenes.json` stays a bare array (the runtime requires it).
- **Tests:** `pipeline/test/tts.test.js` (stubbed fetch, ffmpeg-generated clip; covers caching, speed ratio, Σdur, 401/403, voice precedence, whisper split). It runs from `pipeline/test/run-tests.js` step 1.
