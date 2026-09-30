# Plugins

Everything that talks to the outside world is a plugin: the voice provider, the transcriber, the looks, the publish targets. The built-ins load through the same registry as yours, so a plugin you write is a first-class citizen.

| Kind | Role | Built in | Selected by |
|---|---|---|---|
| `tts` | text → audio | `tts-openrouter` | `reelsmith.config.json` `tts.provider` |
| `stt` | audio → word timings | `stt-whisper` | `reelsmith.config.json` `stt.provider` |
| `style` | a visual look | `reflective`, `tech-news`, `motion` | `style:` in `script.md` or `style` in the config |
| `publish` | send a finished video somewhere | `publish-youtube`, `publish-meta`, `publish-discord` | `reelsmith publish --to=<target>` |

A provider or target name is the plugin name without its kind prefix: `"provider": "openrouter"` is the plugin `tts-openrouter`, `--to=youtube` is `publish-youtube`.

## The contract

A plugin is a directory with a `plugin.js` (CommonJS) and a `README.md`:

```js
module.exports = {
  name: 'tts-elevenlabs',            // unique
  kind: 'tts',                       // 'tts' | 'stt' | 'style' | 'publish'
  version: '1.0.0',
  description: 'ElevenLabs text to speech',

  // optional
  configSchema: {
    ELEVENLABS_API_KEY: { type: 'string', required: true, env: 'ELEVENLABS_API_KEY', description: 'API key from elevenlabs.io' },
  },
  async check(ctx) { return { ok: true, message: 'key present' }; },   // shown by reelsmith doctor

  // kind-specific functions, below
};
```

| Field | Required | Used by |
|---|---|---|
| `name` | yes | the registry, `reelsmith plugins`; a later plugin with the same name overrides an earlier one |
| `kind` | yes | the registry |
| `version`, `description` | yes | `reelsmith plugins`, docs |
| `configSchema` | no | `reelsmith doctor` and docs: `{ key: { type, required, env, description } }` |
| `check(ctx)` | no | `reelsmith doctor`: returns `{ ok, message }`. Keep it cheap: check that keys and binaries exist |

`ctx` (what `check()` receives) is:

```js
{
  root,                               // project root
  config,                             // the resolved reelsmith.config.json
  env,                                // process.env after .env is loaded
  log,                                // a function: log('message') (stderr for check())
  paths: { ffmpeg, ffprobe, python, pythonWhisper, node },   // resolved binaries (core/env.js)
}
```

### Discovery

Plugins load in this order, and a later one with the same `name` overrides an earlier one:

1. Built-ins: `<framework>/plugins/*`
2. The project's `plugins/*` (no registration needed)
3. Each entry of `"plugins"` in `reelsmith.config.json`: a relative path or a module name

```json
{ "plugins": ["./vendor/tts-elevenlabs", "reelsmith-plugin-foo"] }
```

A plugin that fails to load or validate is listed with its error; it never crashes the CLI, unless it is the provider a command asked for.

```bash
reelsmith plugins           # name, kind, version, source, ok or the error
reelsmith plugins --json
```

## `tts`

```js
async synthesize({ text, voice, model, format })
  // → { audio: Buffer, format: 'mp3' | 'pcm' | 'wav', sampleRate? }     one sentence

async synthesizePerformance({ prompt, voice, model })                   // optional
  // → same shape, the whole script in one call (reelsmith tts --mode=performance)

voices()                                                                // optional
  // → [{ name, note }]   hints for doctor and docs
```

- `synthesize` is called once per script line in sentence mode. Return the audio as a Buffer. For raw PCM, return `format: 'pcm'` and the `sampleRate` (16-bit little-endian mono).
- The pipeline does the rest: caching (the key includes the provider name), trimming, tempo, gaps, Whisper timings and `scenes.json`. A provider never deals with files.
- Without `synthesizePerformance`, `--mode=performance` fails with a clear "not supported" error for that provider.
- Throw an `Error` with a readable message on failure. Say so plainly when the key is rejected (401/403), because that is the most common failure.

### Worked example: `plugins/tts-elevenlabs/plugin.js`

A complete provider for [ElevenLabs](https://elevenlabs.io/docs/api-reference/text-to-speech/convert). It accepts a voice id or a voice name, retries rate limits and server errors, and returns MP3 or raw PCM.

```js
'use strict';
// plugins/tts-elevenlabs/plugin.js — ElevenLabs text to speech for Reelsmith.
// Key: ELEVENLABS_API_KEY in .env. Voice: an ElevenLabs voice id, or a voice name
// from your ElevenLabs library (resolved once through /v1/voices).

const API = 'https://api.elevenlabs.io/v1';
const DEFAULT_MODEL = 'eleven_multilingual_v2';
const PCM_RATE = 24000;
const RETRIES = 2;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let voiceCache = null; // name (lowercase) → voice_id

function apiKey() {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('ELEVENLABS_API_KEY is not set — add it to .env');
  return key;
}

// The project config may still name another provider's model (for example
// google/gemini-3.8-flash-tts). ElevenLabs model ids never contain a slash.
function modelId(model) {
  return model && !String(model).includes('/') ? model : DEFAULT_MODEL;
}

async function request(url, init) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, init);
    if (res.ok) return res;
    const body = await res.text().catch(() => '');
    if (res.status === 401 || res.status === 403) {
      throw new Error(`ElevenLabs rejected ELEVENLABS_API_KEY (${res.status}) — put a working key in .env`);
    }
    if ((res.status === 429 || res.status >= 500) && attempt < RETRIES) {
      await sleep(1500 * (attempt + 1));
      continue;
    }
    throw new Error(`ElevenLabs ${res.status}: ${body.slice(0, 300)}`);
  }
}

async function listVoices() {
  const res = await request(`${API}/voices`, { headers: { 'xi-api-key': apiKey() } });
  const data = await res.json();
  return (data.voices || []).map((v) => ({ id: v.voice_id, name: v.name, category: v.category }));
}

async function resolveVoice(voice) {
  if (!voice) throw new Error('no voice given — pass --voice=<name or id> or set tts_voice in script.md');
  if (/^[A-Za-z0-9]{20}$/.test(voice)) return voice;             // already a voice id
  if (!voiceCache) {
    voiceCache = new Map((await listVoices()).map((v) => [v.name.toLowerCase(), v.id]));
  }
  const id = voiceCache.get(String(voice).toLowerCase());
  if (!id) throw new Error(`ElevenLabs voice "${voice}" not found in your library`);
  return id;
}

module.exports = {
  name: 'tts-elevenlabs',
  kind: 'tts',
  version: '1.0.0',
  description: 'ElevenLabs text to speech (voice id or library name)',

  configSchema: {
    ELEVENLABS_API_KEY: {
      type: 'string', required: true, env: 'ELEVENLABS_API_KEY',
      description: 'API key from https://elevenlabs.io/app/settings/api-keys',
    },
  },

  async check(ctx) {
    if (!ctx.env.ELEVENLABS_API_KEY) {
      return { ok: false, message: 'ELEVENLABS_API_KEY missing in .env' };
    }
    return { ok: true, message: 'ELEVENLABS_API_KEY set' };
  },

  async synthesize({ text, voice, model, format = 'mp3' }) {
    const voiceId = await resolveVoice(voice);
    const pcm = format === 'pcm';
    const outputFormat = pcm ? `pcm_${PCM_RATE}` : 'mp3_44100_128';
    const res = await request(
      `${API}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${outputFormat}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey(),
          'Content-Type': 'application/json',
          Accept: pcm ? 'application/octet-stream' : 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: modelId(model),
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      },
    );
    const audio = Buffer.from(await res.arrayBuffer());
    if (!audio.length) throw new Error('ElevenLabs returned empty audio');
    return pcm ? { audio, format: 'pcm', sampleRate: PCM_RATE } : { audio, format: 'mp3' };
  },

  // No synthesizePerformance: ElevenLabs has no whole-script direction prompt,
  // so `reelsmith tts --mode=performance` reports that this provider does not support it.

  async voices() {
    try {
      return (await listVoices()).map((v) => ({ name: v.name, note: `${v.id} (${v.category})` }));
    } catch {
      return [];
    }
  },
};
```

Use it:

```bash
mkdir -p plugins/tts-elevenlabs    # put plugin.js (above) and a README.md in it
echo 'ELEVENLABS_API_KEY=...' >> .env
reelsmith plugins                  # tts-elevenlabs should be listed as ok
reelsmith doctor
```

```json
{
  "tts": { "provider": "elevenlabs", "model": "eleven_multilingual_v2", "voice": null, "speed": 1.15, "mode": "sentence" }
}
```

```bash
reelsmith tts videos/my-video --voice=Rachel
```

Everything after the voice (timings, animation, render) is unchanged. The clip cache key includes the provider, so switching providers never reuses the other provider's clips.

## `stt`

```js
async transcribe({ wavPath, mode, prompt, model, config })
  // → [{ word, start, end, conf? }]     seconds from the start of the file
```

| Argument | Meaning |
|---|---|
| `wavPath` | the audio to transcribe (wav) |
| `mode` | `'whole'` (one pass, used for TTS audio) or `'chunked'` (split at pauses, used for recorded takes so repeated phrases are heard twice) |
| `prompt` | an initial prompt, or `null`; take analysis passes a disfluent prompt so fillers are kept |
| `model` | from `stt.model` in the config (built in: `turbo`) |
| `config` | the resolved project config |

Return one entry per word, in order, with times in seconds. `conf` (0 to 1) is optional; take analysis uses it for attempt scoring when present. Keep punctuation on the word ("bill."): the aligner strips it.

The built-in `stt-whisper` runs local `openai-whisper` and caches words next to the wav (`<file>.json`). A cloud provider should cache the same way, so re-runs are free.

### Example skeleton: `plugins/stt-deepgram/plugin.js`

```js
'use strict';
// Deepgram pre-recorded transcription with word timestamps.
const fs = require('fs');

module.exports = {
  name: 'stt-deepgram',
  kind: 'stt',
  version: '0.1.0',
  description: 'Deepgram speech to text (word timestamps)',
  configSchema: {
    DEEPGRAM_API_KEY: { type: 'string', required: true, env: 'DEEPGRAM_API_KEY', description: 'Deepgram API key' },
  },

  async check(ctx) {
    return ctx.env.DEEPGRAM_API_KEY
      ? { ok: true, message: 'DEEPGRAM_API_KEY set' }
      : { ok: false, message: 'DEEPGRAM_API_KEY missing in .env' };
  },

  async transcribe({ wavPath, model }) {
    const cache = wavPath.replace(/\.wav$/i, '') + '.deepgram.json';
    if (fs.existsSync(cache) && fs.statSync(cache).mtimeMs > fs.statSync(wavPath).mtimeMs) {
      return JSON.parse(fs.readFileSync(cache, 'utf8'));
    }
    const res = await fetch(`https://api.deepgram.com/v1/listen?model=${encodeURIComponent(model || 'nova-3')}&punctuate=true`, {
      method: 'POST',
      headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`, 'Content-Type': 'audio/wav' },
      body: fs.readFileSync(wavPath),
    });
    if (!res.ok) throw new Error(`Deepgram ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    const words = (data.results?.channels?.[0]?.alternatives?.[0]?.words || []).map((w) => ({
      word: w.punctuated_word || w.word,
      start: w.start,
      end: w.end,
      conf: w.confidence,
    }));
    fs.writeFileSync(cache, JSON.stringify(words));
    return words;
  },
};
```

Select it with `"stt": { "provider": "deepgram", "model": "nova-3" }`.

## `style`

A style pack is a folder under `styles/` with a `STYLE.md` (see [Styles](styles.md)). `plugin.js` is optional:

```js
module.exports = { name: 'acme', kind: 'style', version: '1.0.0', description: 'Acme brand look' };
```

Without it, the registry builds the entry from the `name` and `description` in the `STYLE.md` frontmatter. A style has no functions: the agent reads `STYLE.md`, and `index.html` loads `kit.jsx`.

## `publish`

```js
async publish({ video, dryRun, force, privacy, file, publicUrl, channel, targetConfig, root, config, env, log, paths })
  // → { ok, dryRun, target, id?, url?, sent?: {...}, skipped?: reason }

async check(ctx)
  // → { ok, message }     credentials present, size limits

async auth({ check, targetConfig, root, config, env, log, paths })   // optional
  // → { ok, message }     `reelsmith publish <video> --to=<target> --auth [--check]`
```

| Argument | Meaning |
|---|---|
| `video` | `{ name, dir, script, scenes }` of the video being published (`script` is the parsed `script.md`, `scenes` the `scenes.json` array, either may be `null`) |
| `dryRun` | `true` for `--dry-run` |
| `force` | `true` for `--force` |
| `privacy`, `file`, `publicUrl`, `channel` | `--privacy`, `--file`, `--public-url`, `--channel`, or `undefined` |
| `targetConfig` | `publish.targets.<target>` from `reelsmith.config.json` (`{}` when absent) |
| `config` | the resolved project config |
| `env` | the environment after `.env` is loaded |
| `log` | a function: `log('message')` |

The CLI does not pass the publish notes: read `videos/<name>/publish.md` yourself with `core/publishNotes.js` (`load(video.dir)` → `{ title, description, tags, hashtags, meta, … }`), as the built-in targets do. In a project made by `init` that is `require('reelsmith/core/publishNotes')`.

Rules every publish plugin follows:

- **A dry run does everything except the network write:** read the credentials, check the file and its size, build the exact request, print it, and return `{ ok: true, dryRun: true, sent: <the request> }`.
- Return `id` and `url` when the target gives them, and save the result as `videos/<name>/publish/<target>.json`. The built-in targets use `writeResult()`, `readResult()` and `publishedId()` from `core/publishNotes.js`; use them too. Refuse a second run while that file has an `id`, unless `force` is set (`--force`).
- Return `{ ok: true, skipped: '<reason>' }` when the target cannot run for a known reason (for example no public URL). Do not throw for that.
- Never log tokens, secrets or signed upload URLs.

### Example skeleton: `plugins/publish-slack/plugin.js`

Posts the title, the description and a link to a Slack channel through an incoming webhook, for team review.

```js
'use strict';
module.exports = {
  name: 'publish-slack',
  kind: 'publish',
  version: '0.1.0',
  description: 'Post a review message to Slack (incoming webhook)',
  configSchema: {
    SLACK_WEBHOOK_URL: { type: 'string', required: true, env: 'SLACK_WEBHOOK_URL', description: 'Slack incoming webhook URL' },
  },

  async check(ctx) {
    return ctx.env.SLACK_WEBHOOK_URL
      ? { ok: true, message: 'SLACK_WEBHOOK_URL set' }
      : { ok: false, message: 'SLACK_WEBHOOK_URL missing in .env' };
  },

  async publish({ video, dryRun, targetConfig, env, log }) {
    const target = 'slack';
    const hook = env.SLACK_WEBHOOK_URL;
    if (!hook) throw new Error('SLACK_WEBHOOK_URL missing in .env');
    // publish.md (the title falls back to script.md). In clone mode: require('../../core/publishNotes')
    const notes = require('reelsmith/core/publishNotes').load(video.dir);
    const link = (targetConfig.linkBase || '') + `${video.name}/output.mp4`;
    const body = { text: `*${notes.title}*\n${(notes.description || '').split('\n')[0]}\n${link}` };

    if (dryRun) {
      log(`[slack] would POST ${JSON.stringify(body)}`);
      return { ok: true, dryRun: true, target, sent: body };
    }
    const res = await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`Slack webhook ${res.status}: ${await res.text()}`);
    return { ok: true, dryRun: false, target, sent: body };
  },
};
```

Then:

```bash
reelsmith publish videos/my-video --to=slack --dry-run
reelsmith publish videos/my-video --to=slack
```

## Checklist for a new plugin

- [ ] `name`, `kind`, `version`, `description` exported; `name` is unique (or intentionally overrides a built-in).
- [ ] Keys come from the environment, are listed in `configSchema` with `env`, and are checked in `check()`.
- [ ] Errors are thrown with a message a person can act on.
- [ ] Nothing secret is logged.
- [ ] `README.md` next to `plugin.js` says what it needs and how to select it.
- [ ] `reelsmith plugins` shows it as ok and `reelsmith doctor` shows its check.
