# Music bed

> All audio defaults in one table: [`audio.md`](audio.md).

Every video with background music uses these defaults. Don't ask the creator for a level.

## Level: 6 dB under the voice

| Setting | Value | Why |
|---|---|---|
| Voice loudness | `loudnorm=I=-16:TP=-1.5:LRA=11` | Phone/YouTube-friendly target |
| Bed level | **6 dB under the voice**, i.e. music at −22 LUFS | Audible without competing with the words |
| Bed gain | `(voiceLUFS − 6) − musicLUFS`, with the track's LUFS **measured** (ebur128) | Tracks differ by 10+ dB, so a fixed gain makes some inaudible |
| Ducking | `sidechaincompress=threshold=0.05:ratio=2.5:attack=60:release=600` | A gentle dip under speech |
| Fades | in 1.5 s, out over the last 3 s | |
| Tail | 2.5 s of music after the last word | Lets the ending breathe; the render holds the closing frame |
| Mix | `amix=normalize=0`, then `alimiter=limit=0.95` | |

**Never use a fixed dB offset** like `volume=-20dB`. Always measure the track first (`reelsmith mix` does).

`npx reelsmith mix <video> --track=music/<file>.mp3` applies all of this and writes `voiceover-mix.mp3` (+ `voiceover-mix.json`). `reelsmith draft` and `reelsmith render` use it automatically. The voice isn't shifted, so `scenes.json` timing is unchanged. `--under=<dB>` overrides the level for one video, only when the creator asks (`--under=4` is the louder option). Set `music.defaultTrack` in `reelsmith.config.json` to skip `--track`.

## Tracks

Tracks live in `music/` (the mp3s are gitignored; `bash music/download.sh` fetches the incompetech ones). Every CC BY track needs its credit line in the video description: see `music/CREDITS.md`.

**YouTube:** Content ID often claims Kevin MacLeod tracks. For a YouTube upload use a YouTube Audio Library bed, or none.

| File | Track | Mood | Source |
|---|---|---|---|
| `music/clean-soul.mp3` | "Clean Soul", Kevin MacLeod | Calm, warm, reflective | incompetech.com (CC BY 4.0) |
| `music/voxel-revolution.mp3` | "Voxel Revolution", Kevin MacLeod | Energetic electronic, ~123 BPM | incompetech.com (CC BY 4.0) |
| `music/digital-lemonade.mp3` | "Digital Lemonade", Kevin MacLeod | Bright electronic groove, mid-tempo | incompetech.com (CC BY 4.0) |
| `music/intergalactic.mp3` | "Intergalactic", Alex Jones / Xander Jones | Dance and electronic, inspirational; YouTube-safe | YouTube Audio Library (download by hand) |

**Pick the track by the video's mood.** Add a new track to this table and to `music/CREDITS.md` when you bring one in.
