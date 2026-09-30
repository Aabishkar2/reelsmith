# tts-openrouter

The built-in `tts` plugin. It turns text into speech through OpenRouter's
`POST https://openrouter.ai/api/v1/audio/speech`, by default with Google's
`google/gemini-3.8-flash-tts`.

```jsonc
// reelsmith.config.json
{ "tts": { "provider": "openrouter", "model": "google/gemini-3.8-flash-tts", "voice": null, "speed": 1.15 } }
```

## How it works

Every request sends exactly `{ model, voice, input, response_format }` with
`Authorization: Bearer $OPENROUTER_API_KEY`.

- **Sentence mode** (`reelsmith tts <video> --voice=<v>`, the default) calls
  `synthesize({ text, voice, model, format })` once per script line, with
  `response_format: "mp3"`. The pipeline caches every clip in
  `voiceover/tts/<sha1(provider|model|voice|text)>.wav`, so a re-run only pays for the
  lines that changed.
- **Performance mode** (`reelsmith tts <video> --voice=<v> --mode=performance`) calls
  `synthesizePerformance({ prompt, voice, model })` once for the whole script. The prompt
  is the title, the `PERFORMANCE` direction block, the `## Voice direction` context and
  the transcript. It asks for `response_format: "pcm"`: raw 24 kHz, 16-bit, mono. This
  endpoint answers `wav` with a 400, so don't ask for it. The audio is cached in
  `voiceover/source/performance.{pcm,wav}` and reused while the prompt, model and voice
  are unchanged, and also when only the PERFORMANCE direction text changed (`--force`
  re-voices; `--offline` never calls the API).

Speed is never sent to the API. The pipeline applies it locally with ffmpeg `atempo`, so
changing it costs nothing.

Errors:

- **401/403** stops at once with *"OPENROUTER_API_KEY rejected — put a working key in .env"*.
- **429, 5xx and network errors** are retried twice, with backoff.
- **A JSON or text body** where audio was expected is an error that includes the body.

The audio format comes from the content type (`audio/L16;rate=…` or `audio/pcm`,
`audio/wav`, `audio/mpeg`). If that doesn't say, the plugin checks the bytes (`RIFF` for
WAV, `ID3` for MP3). If neither helps, it assumes the format it asked for.

`check()` (used by `reelsmith doctor`) only confirms that `OPENROUTER_API_KEY` is set. It
never calls the network.

## Settings

| Env | Default | What |
|---|---|---|
| `OPENROUTER_API_KEY` | none | Required only when audio isn't cached yet. Get one at https://openrouter.ai/keys |
| `TTS_MODEL` | `google/gemini-3.8-flash-tts` | Overrides `tts.model`. A `--model` flag or `tts_model:` in the frontmatter wins over it |
| `TTS_VOICE` | none, on purpose | The creator picks a voice for each video (`--voice` or `tts_voice:`) |
| `TTS_SPEED` | `1.15` | Local tempo from 0.5 to 2 (`--speed` or `tts_speed:` win) |

Precedence for every setting: CLI flag > `script.md` frontmatter > what the video used
last time (`voiceover/tts/meta.json`: model and voice, while the provider is unchanged) >
env > `reelsmith.config.json` > built-in defaults. The speed skips the "last time" step.

## Voices

Gemini TTS voices include **Leda** (youthful), **Kore** (firm), **Puck** (upbeat),
**Charon** (informative), **Aoede** (breezy), **Zephyr** (bright), **Fenrir** (excitable)
and **Orus** (firm). There are more; see Google's Gemini TTS voice list. Voice names are
case-sensitive. Reelsmith has no default voice: ask the creator.

## Cost

Gemini 3.8 Flash TTS on OpenRouter costs about $0.5 per million input tokens and $9 per
million audio-output tokens. That is roughly **$0.01 per minute of audio**. A 60-second
short costs about a cent in either mode. Performance mode also pays for its prompt
tokens, which is a fraction of a cent. Cached audio is free: a speed change, a re-split
or a re-run with the same prompt never calls the API.
