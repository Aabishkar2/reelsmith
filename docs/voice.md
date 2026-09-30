# Voice

Reelsmith gives you two ways to get a voice: a TTS model, or your own recording. Both end in the same files, so everything after the voice is identical:

```
videos/<name>/voiceover/sN.mp3    one clip per scene
videos/<name>/voiceover.mp3       the scenes joined
videos/<name>/scenes.json         [{ idx, dur, file, words: [{ word, start, end }] }]
```

| | TTS | Your own take |
|---|---|---|
| Commands | `reelsmith tts` | `reelsmith record`, `analyze`, `cut` |
| Needs | a TTS key (built in: `OPENROUTER_API_KEY`) | a microphone and a browser |
| Cost | about $0.01 per minute with the built-in provider | free |
| Word timings | Whisper on the final voice | Whisper on the take, aligned to the script |
| Fixing one line | edit the line, re-run: only that line is regenerated (sentence mode) | re-record that line in the app |

## Choosing a voice

There is no default voice. Pick one per video and either pass it:

```bash
reelsmith tts videos/<name> --voice=Leda
```

or write it in the frontmatter:

```markdown
tts_voice: Leda
```

The voice is recorded in `voiceover/tts/meta.json`, so later runs of the same video reuse it. Voice names come from the provider. The built-in provider (`tts-openrouter`, model `google/gemini-3.8-flash-tts`) uses the Gemini TTS voice names. An agent never picks a voice: it asks the creator.

## TTS: sentence mode (default)

```bash
reelsmith tts videos/<name> --voice=<v>
```

1. One TTS call per script line (the `>` cues are never sent).
2. Each clip is cached in `voiceover/tts/` by a hash of provider, model, voice and text. Change one line and only that line is regenerated. `--force` regenerates every clip.
3. Head and tail silence is trimmed. Lines are joined with a short gap and each scene gets a short tail.
4. The tempo is applied with ffmpeg `atempo` (pitch kept). The default is 1.15×. A speed change reuses the cached clips and never re-calls the API. Gaps shrink by the same factor.
5. Whisper transcribes the final voice for word timings. Each word is assigned to the clip it overlaps. If Whisper is not installed, timings fall back to an estimate by word length, and the command says so. Install Whisper for exact cues.

## TTS: performance mode

```bash
reelsmith tts videos/<name> --voice=<v> --mode=performance
```

Or set `tts_mode: performance` in the frontmatter. The whole script goes to the provider in **one call** with a direction prompt, so it sounds like one person talking, with natural pauses. The provider must implement `synthesizePerformance` (the built-in one does).

The prompt has four parts:

```
# <title>

PERFORMANCE
Style: …
Pace: …
Accent: …

CONTEXT
<the script's ## Voice direction section>

TRANSCRIPT
<scene 1 lines>

<scene 2 lines>
```

| Part | Comes from |
|---|---|
| PERFORMANCE | `config/voice/performance.md`, from the line `PERFORMANCE` on. Override per video with `tts_performance: <path>` |
| CONTEXT | the `## Voice direction` section of `script.md` (the block is left out when the section is empty) |
| TRANSCRIPT | the spoken lines, one blank line between scenes, `>` cues left out |

What happens:

1. The raw audio is cached in `voiceover/source/` (`performance.pcm` or `.mp3`, plus a 24 kHz mono `performance.wav`). The prompt is saved as `performance-prompt.md`, and `performance.meta.json` records the provider, model, voice and a hash of model, voice and prompt.
2. **If the hash matches, no API call is made.** Edit the script or the direction and the next run calls the provider again.
3. The speed is applied with `atempo` (`performance-x<speed>.wav`).
4. Whisper transcribes the 1× audio. The script sentences are aligned to the Whisper words, and each scene boundary is cut in the middle of the pause between two scenes. No gaps are inserted: the natural pauses stay. Where Whisper misspelled a matched word ("RealSmith"), the subtitles use the script's spelling ("Reelsmith").
5. If fewer than 80 % of the sentences are found in the audio, the command fails and lists the missing sentence ids. Usually the voice skipped or rephrased a line; re-run with `--force`, or simplify the line.

Write `## Voice direction` as one short paragraph: who is talking to whom, the tone, which lines to land. For example:

```markdown
## Voice direction
The narrator explains two voice paths. Scene 3 is self referential: deliver "what you are hearing right now" with a smile. Keep the recording path practical.
```

## TTS settings

| Setting | Flag | Frontmatter | Env | Default |
|---|---|---|---|---|
| Voice | `--voice` | `tts_voice` | `TTS_VOICE` | none (required) |
| Mode | `--mode` | `tts_mode` | | `sentence` |
| Model | `--model` | `tts_model` | `TTS_MODEL` | `google/gemini-3.8-flash-tts` |
| Speed | `--speed` | `tts_speed` | `TTS_SPEED` | `1.15` |

Project defaults live in `reelsmith.config.json` under `"tts"` (`provider`, `model`, `voice`, `speed`, `mode`). A 401 or 403 from the provider means the key in `.env` is wrong.

## Your own voice

### Record

```bash
reelsmith record
```

Opens the teleprompter app at `http://localhost:4310` (`--port` changes it). Pick the video, arm the mic, and read the whole script in one take. The text scrolls at the script's `wpm`, and the keyboard controls the scroll. When you stop, the app saves `takes/take-01.webm` (plus wav copies) and analyzes the take.

Before recording, run the teleprompter-prep skill: it adds pronunciation and breath cues and makes the first line easy to say.

### Analyze

The app runs this for you. From the terminal:

```bash
reelsmith analyze videos/<name>                       # the latest take
reelsmith analyze videos/<name> --take=takes/take-02  # a specific take
reelsmith analyze videos/<name> --no-jev              # rules only
reelsmith status videos/<name>                        # summary table
```

Whisper transcribes the take, the transcript is aligned to the script, and every sentence gets a status and flags in `take.json`:

| Flag | Meaning | What happens |
|---|---|---|
| `filler` | "um", "uh", an inserted "like" | cut automatically (3 or more in one line marks it `bad`) |
| `stutter` | "the the", a false start | cut automatically |
| `pause` | over 1.2 s inside a line, over 2.0 s between lines | trimmed automatically |
| `pace` | under 110 or over 200 wpm | a warning |
| `mismatch` | the line differs from the script (WER over 0.15) | re-record |
| `dropped-key` | a number or name did not come through | re-record |
| `loudness` | too quiet or clipping | re-record |
| `missing` | the line was never said | re-record |
| `order` | said out of order | re-record |

When a line is said more than once, every complete attempt is scored (accuracy, fluency, confidence, loudness, pace) and the best one is kept. Borderline filler words can be classified by Jev AI through OpenRouter; without a key the rules decide alone.

### Re-record and cut

In the app's review view, press **R** on a flagged line to re-record just that line. The clip is transcribed, checked against the sentence, and added as another attempt. Repeat until nothing is `bad` or `missing`.

A clip already on disk can be spliced from the terminal:

```bash
reelsmith rerecord videos/<name> --sentence=s2.1 --clip=takes/rr-s2.1-1
```

Then:

```bash
reelsmith cut videos/<name>
```

Fillers, stutters and long pauses are removed, background noise is reduced (DeepFilterNet if installed, else an ffmpeg filter; `settings.json` `{ "denoise": false }` in the video folder turns it off), the best attempt of each line is used, and you get `voiceover/sN.mp3`, `voiceover.mp3` and `scenes.json`.

The internals of analysis, alignment, attempt scoring and denoising are in [the pipeline internals](spec.md).

## Music bed

```bash
reelsmith mix videos/<name> --track=music/clean-soul.mp3
```

Writes `voiceover-mix.mp3`. The defaults are in `config/audio.md` and `config/music.md`:

| Setting | Value |
|---|---|
| Voice loudness | −16 LUFS integrated |
| Bed level | 6 dB under the voice, measured per track (never a fixed gain) |
| Ducking | gentle sidechain compression under speech |
| Fades | in over 1.5 s, out over the last 3 s |
| Tail | about 2.5 s of music after the last word |

`--under=4` makes the bed louder for energetic videos. Pick the track by mood (`config/music.md`). The voice is not shifted, so `scenes.json` stays valid. `reelsmith draft` uses `voiceover-mix.mp3` when it exists, else `voiceover.mp3`. `--audio=<file>` on `draft` or `render` sets the audio explicitly.

Every CC BY track needs its credit line in the video description. `music/CREDITS.md` has them.
