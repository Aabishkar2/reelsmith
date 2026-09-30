# Audio defaults

This is the one place to look up how a video should sound. Don't ask the creator again for any value here.

| Setting | Value | Where it's set | Source |
|---|---|---|---|
| Voice | Own recording (`app/` → `pipeline/cli.js cut`) **or** TTS (`pipeline/cli.js tts`) | CLAUDE.md pipeline | |
| TTS model | `google/gemini-3.8-flash-tts` (OpenRouter) | `config/tts.json` `model` | Creator's pick (devotion-tts) |
| TTS voice | **No default.** Ask the creator which voice for each video, then pass `--voice=<name>` or put `tts_voice: <name>` in `script.md` frontmatter. Re-runs reuse the voice recorded in `voiceover/tts/meta.json` | `config/tts.json` `voice: null` | |
| **TTS speed** | **1.15×** (ffmpeg `atempo=1.15`, pitch kept; sentence gaps and scene tails shrink by the same factor) | `config/tts.json` `speed`; override with `--speed=` / `tts_speed:` / `TTS_SPEED` | **Creator's pick, 2026-09-29** (devotion-tts voice sped up 1.15× and approved) |
| TTS gaps | 0.35 s between sentences, 0.6 s scene tail (before the speed factor) | `config/tts.json` `sentenceGapSec`, `sceneTailSec` | |
| Word timings | Whisper word timestamps on the final, sped-up voice (falls back to a length-weighted estimate if python3.11 + whisper are missing; the CLI says which it used) | `config/tts.json` `timings: "auto"` | Exact cues for `useWordCue`, as on devotion-tts |
| Voice loudness | **−16 LUFS** integrated (`loudnorm=I=-16:TP=-1.5:LRA=11`) | `scripts/mix-music.js` (`VOICE_LUFS`) | Phone/YouTube target |
| Music bed | **6 dB under the voice**, measured per track, gentle duck, 2.5 s tail | `scripts/mix-music.js` | See [`config/music.md`](music.md), creator's A/B pick 2026-09-28 |
| Default track (reflective) | `music/clean-soul.mp3` | `--track=` | `config/music.md` |

Order for a TTS video:

```bash
node pipeline/cli.js tts videos/<name> --voice=<name>                 # → voiceover/sN.mp3, voiceover.mp3, scenes.json
node scripts/mix-music.js videos/<name> --track=music/clean-soul.mp3  # → voiceover-mix.mp3 (voice loudnormed to −16 LUFS, bed 6 dB under)
node renderer/render.js … --audio=videos/<name>/voiceover-mix.mp3
```

Loudness normalisation happens in `mix-music.js`. Plain `voiceover.mp3` (TTS or cut) is not normalised. For a video with no music, loudnorm it to −16 LUFS the same way (`-af loudnorm=I=-16:TP=-1.5:LRA=11`) before rendering.
