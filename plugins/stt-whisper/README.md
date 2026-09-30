# stt-whisper

The built-in `stt` plugin: word-level timestamps from
[openai-whisper](https://github.com/openai/whisper), run locally in Python. They drive
the karaoke subtitles, `useWordCue`, the take analysis and the performance-mode scene
split.

```jsonc
// reelsmith.config.json
{ "stt": { "provider": "whisper", "model": "turbo" } }
```

## How it works

`transcribe({ wavPath, mode, prompt, model, config, force, quiet })` is a thin wrapper
around `pipeline/whisper.js`, which spawns `pipeline/whisper_words.py`. It returns
`[{ word, start, end, conf }]`.

- **`mode: 'whole'`** transcribes the file in one pass. Used for TTS voices (sentence
  and performance mode).
- **`mode: 'chunked'`** splits a recorded take at its pauses (energy VAD) and
  transcribes the chunks in interleaved windows, so a line and its retake never share
  a window.
- **`prompt`** left undefined uses the disfluent take prompt from `config/fillers.json`,
  which keeps "um" and restarts in the transcript. Pass `''` for clean TTS audio.

Words are cached next to the audio: `performance.wav` → `performance.json` (the words)
plus `performance.whisper.json` (the mode and model they were made with). The cache is
reused unless you pass `force`, the wav is newer, or the mode or model differ. A second
run on unchanged audio doesn't start Python at all.

`available()` answers quickly: it checks for a Python that has whisper installed,
without importing torch. `check()` (used by `reelsmith doctor`) does a real
`import whisper`. Whisper is optional: without it, sentence-mode TTS falls back to
estimated word timings and says so. Performance mode and take analysis need it.

## Settings

| Env | Default | What |
|---|---|---|
| `WHISPER_MODEL` | `turbo` (`stt.model`) | `tiny`, `base`, `small`, `medium`, `large` or `turbo` |
| `REELSMITH_PYTHON` | auto | The Python interpreter that has openai-whisper. Otherwise the first of `python3.11`, `python3.12`, `python3.13`, `python3` on `PATH` (plus `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`) that has it (`core/env.js`) |

Install it with `python3.11 -m pip install openai-whisper`. ffmpeg must be installed
too. The first run downloads the model, about 1.5 GB for `turbo`.

## Writing another stt plugin

Export `{ name: 'stt-<id>', kind: 'stt', version, transcribe }` from
`plugins/stt-<id>/plugin.js`, and set `"stt": { "provider": "<id>" }`. `transcribe` must
return words in seconds, in order, with `end >= start`. Cache the result next to
`wavPath` if the service costs money. `docs/plugins.md` has a full example.
