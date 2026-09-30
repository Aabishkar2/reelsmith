# Music bed

> All audio defaults in one table (TTS speed 1.15×, voice −16 LUFS, this bed): `config/audio.md`.

Every video with background music uses these defaults. Don't ask the creator again. They picked them by A/B test on 2026-09-28 (10 / 8 / 6 / 4 dB-under mixes of the same voice; 6 won).

## Level: 6 dB under the voice

| Setting | Value | Why |
|---|---|---|
| Voice loudness | `loudnorm=I=-16:TP=-1.5:LRA=11` | Phone/YouTube-friendly target |
| Bed level | **6 dB under the voice**, i.e. music at −22 LUFS | Creator's pick. 8 dB was fine but thin; 4 dB competed with the words |
| Bed gain | `(voiceLUFS − 6) − musicLUFS`, with the track's LUFS **measured** (ebur128) | Tracks differ by 10+ dB. A fixed gain made "Clean Soul" (−27.7 LUFS) inaudible |
| Ducking | `sidechaincompress=threshold=0.05:ratio=2.5:attack=60:release=600` | Gentle dip under speech. Hard ducking (ratio 6) buried the bed |
| Fades | in 1.5 s, out over the last 3 s | |
| Tail | ~2.5 s of music after the last word | Lets the ending breathe |
| Mix | `amix=normalize=0`, then `alimiter=limit=0.95` | |

**Never use a fixed dB offset** like `volume=-20dB`. Always measure the track first.

`node scripts/mix-music.js videos/<name> --track=music/<file>.mp3` applies all of this and writes `voiceover-mix.mp3`. Render with `--audio=videos/<name>/voiceover-mix.mp3`. The voice isn't shifted, so `scenes.json` timing is unchanged. `--under=<dB>` overrides the level for one video, only if the creator asks. **4 dB under** (`--under=4`) is the louder option the creator asks for on energetic videos (used on `openai-devday`, 2026-09-30). Never make it the default.

## Tracks

Tracks live in `music/` (the mp3s are gitignored; re-download from the URL below). Every track needs a credit line in the YouTube description. See `music/CREDITS.md`.

| File | Track | Mood | Source |
|---|---|---|---|
| `music/clean-soul.mp3` | "Clean Soul", Kevin MacLeod | Calm, warm, reflective | https://incompetech.com/music/royalty-free/mp3-royaltyfree/Clean%20Soul.mp3 (CC BY 4.0) |
| `music/voxel-revolution.mp3` | "Voxel Revolution", Kevin MacLeod | Energetic electronic, ~123 BPM, 2:10 (loops) — fast tech-news breakdowns | https://incompetech.com/music/royalty-free/mp3-royaltyfree/Voxel%20Revolution.mp3 (CC BY 4.0) |
| `music/digital-lemonade.mp3` | "Digital Lemonade", Kevin MacLeod | Bright electronic groove, mid-tempo, 3:00 | https://incompetech.com/music/royalty-free/mp3-royaltyfree/Digital%20Lemonade.mp3 (CC BY 4.0) |

**Pick the track by the video's mood** (creator, 2026-09-30: "choose a better suited background music"). Clean Soul is for calm reflective essays; an energetic tech video gets an energetic bed. If nothing here fits, source a new CC BY track from incompetech, measure it, and add it to this table and to `music/CREDITS.md`.
