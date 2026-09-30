# Audio defaults

The one place to look up how a video should sound. Don't ask the creator again for any value here. Change a value here and in `reelsmith.config.json` together.

| Setting | Value | Where it's set |
|---|---|---|
| Voice | Your own recording (`reelsmith record` → `reelsmith cut`) **or** TTS (`reelsmith tts`) | per video |
| TTS model | `google/gemini-3.8-flash-tts` (OpenRouter) | `reelsmith.config.json` `tts.model`; `--model=` / `tts_model:` / `TTS_MODEL` |
| TTS voice | **No default.** Ask the creator which voice for each video, then pass `--voice=<name>` or put `tts_voice: <name>` in the `script.md` frontmatter. Re-runs reuse the voice recorded in `voiceover/tts/meta.json` | `reelsmith.config.json` `tts.voice: null` |
| TTS mode | `sentence` (one call per line) or `performance` (the whole script in one call, directed by `config/voice/performance.md`) | `tts.mode`; `--mode=` / `tts_mode:` |
| TTS speed | **1.15×** (ffmpeg `atempo`, pitch kept; sentence gaps and scene tails shrink by the same factor) | `tts.speed`; `--speed=` / `tts_speed:` / `TTS_SPEED` |
| Word timings | Whisper word timestamps on the final voice (sentence mode falls back to a length-weighted estimate when Python + openai-whisper are missing; the CLI says which it used) | `tts.timings: "auto"`, `stt.model` |
| Voice loudness | **−16 LUFS** integrated (`loudnorm=I=-16:TP=-1.5:LRA=11`), applied by `reelsmith mix` | `music.voiceLufs` |
| Music bed | **6 dB under the voice**, measured per track, gentle duck, 2.5 s tail | `music.underDb`, `music.tailSec`; see [`music.md`](music.md) |

Order for a TTS video:

```bash
npx reelsmith tts <video> --voice=<name>                 # → voiceover/sN.mp3, voiceover.mp3, scenes.json
npx reelsmith mix <video> --track=music/<file>.mp3       # → voiceover-mix.mp3 (voice at −16 LUFS, bed 6 dB under)
npx reelsmith draft <video>                              # picks voiceover-mix.mp3 (else voiceover.mp3) by itself
```

Loudness normalisation happens in `reelsmith mix`. A plain `voiceover.mp3` (TTS or cut) is not normalised.
