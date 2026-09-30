'use strict';
/**
 * plugins/tts-openrouter — TTS through OpenRouter's /api/v1/audio/speech (docs/framework-spec.md §5.1).
 *
 *   synthesize({ text, voice, model, format = 'mp3' })     one sentence → { audio, format, sampleRate?, contentType }
 *   synthesizePerformance({ prompt, voice, model })        the whole performance prompt in ONE call,
 *                                                          response_format 'pcm' (24 kHz s16le mono;
 *                                                          'wav' is a 400 on this endpoint)
 *                                                          → { audio, format: 'pcm', sampleRate: 24000, contentType }
 * Both also take { key, fetch, retryDelayMs, timeoutMs } (key defaults to $OPENROUTER_API_KEY,
 * fetch to the global fetch at call time, so tests can pass or install a stub).
 * Request body is exactly { model, voice, input, response_format }. 401/403 fail at once with
 * "OPENROUTER_API_KEY rejected — put a working key in .env"; 429/5xx and network errors are retried
 * twice (backoff retryDelayMs × attempt). A JSON/text body instead of audio is an error.
 * Audio format comes from the content type (audio/L16 or audio/pcm with rate=…, audio/wav,
 * audio/mpeg), else from the bytes (RIFF / ID3), else the format that was asked for.
 */
const ENDPOINT = 'https://openrouter.ai/api/v1/audio/speech';
const PCM_RATE = 24000;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** { format, sampleRate? } of a TTS response. */
function audioFormat(buf, contentType, requested) {
  const ct = String(contentType || '').toLowerCase();
  const rate = Number((ct.match(/rate=(\d+)/) || [])[1]) || PCM_RATE;
  if (/l16|pcm/.test(ct)) return { format: 'pcm', sampleRate: rate };
  if (/wav|wave/.test(ct)) return { format: 'wav' };
  if (/mpeg|mp3/.test(ct)) return { format: 'mp3' };
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF') return { format: 'wav' };
  if (buf.length >= 3 && buf.toString('ascii', 0, 3) === 'ID3') return { format: 'mp3' };
  return requested === 'pcm' ? { format: 'pcm', sampleRate: rate } : { format: requested || 'mp3' };
}

async function request(body, { key, fetch: fetchImpl, retryDelayMs = 1500, timeoutMs } = {}) {
  const k = key || process.env.OPENROUTER_API_KEY;
  if (!k) throw new Error('OPENROUTER_API_KEY is not set — put a working key in .env');
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== 'function') throw new Error('no fetch() available (Node 18+ required)');
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await doFetch(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        ...(timeoutMs && typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
      });
    } catch (e) {
      if (attempt < 2) { await sleep(retryDelayMs * (attempt + 1)); continue; }
      throw new Error(`TTS request failed (network): ${e.message}`);
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(`OPENROUTER_API_KEY rejected (HTTP ${res.status}) — put a working key in .env`);
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 2) { await sleep(retryDelayMs * (attempt + 1)); continue; }
    if (!res.ok) throw new Error(`TTS HTTP ${res.status} (model ${body.model}, voice ${body.voice}): ${(await res.text()).slice(0, 300)}`);
    const contentType = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
    if (/json|text\//i.test(contentType)) throw new Error(`TTS returned ${contentType}, not audio: ${(await res.text()).slice(0, 300)}`);
    const audio = Buffer.from(await res.arrayBuffer());
    if (!audio.length) throw new Error(`TTS returned an empty body (model ${body.model}, voice ${body.voice})`);
    return { audio, contentType, ...audioFormat(audio, contentType, body.response_format) };
  }
}

module.exports = {
  name: 'tts-openrouter',
  kind: 'tts',
  version: '1.0.0',
  description: 'OpenRouter /api/v1/audio/speech (default model google/gemini-3.8-flash-tts); sentence and performance modes',
  ENDPOINT,
  configSchema: {
    OPENROUTER_API_KEY: { type: 'string', required: true, env: 'OPENROUTER_API_KEY', secret: true,
      description: 'OpenRouter API key (https://openrouter.ai/keys). Only needed when audio is not cached yet.' },
    TTS_MODEL: { type: 'string', required: false, env: 'TTS_MODEL', default: 'google/gemini-3.8-flash-tts',
      description: 'OpenRouter model id; overrides reelsmith.config.json tts.model (a flag or tts_model: frontmatter wins).' },
    TTS_VOICE: { type: 'string', required: false, env: 'TTS_VOICE',
      description: 'Voice name (e.g. Leda, Kore, Puck). No default on purpose: pick one per video.' },
    TTS_SPEED: { type: 'number', required: false, env: 'TTS_SPEED', default: 1.15,
      description: 'Tempo applied locally with ffmpeg atempo (0.5–2); never sent to the API.' },
  },

  async synthesize({ text, voice, model, format = 'mp3', ...opts }) {
    if (!text || !String(text).trim()) throw new Error('synthesize: empty text');
    return request({ model, voice, input: String(text), response_format: format }, { ...opts, timeoutMs: opts.timeoutMs || 120000 });
  },

  async synthesizePerformance({ prompt, voice, model, ...opts }) {
    if (!prompt || !String(prompt).trim()) throw new Error('synthesizePerformance: empty prompt');
    return request({ model, voice, input: String(prompt), response_format: 'pcm' }, { ...opts, timeoutMs: opts.timeoutMs || 600000 });
  },

  voices() {
    return [
      { name: 'Leda', note: 'youthful (Gemini TTS)' }, { name: 'Kore', note: 'firm' }, { name: 'Puck', note: 'upbeat' },
      { name: 'Charon', note: 'informative' }, { name: 'Aoede', note: 'breezy' }, { name: 'Zephyr', note: 'bright' },
      { name: 'Fenrir', note: 'excitable' }, { name: 'Orus', note: 'firm' },
    ];
  },

  async check(ctx = {}) {
    const env = ctx.env || process.env;
    if (!env.OPENROUTER_API_KEY) {
      return { ok: false, message: 'OPENROUTER_API_KEY is not set — add it to .env (only needed to generate new TTS audio)' };
    }
    if (typeof globalThis.fetch !== 'function') return { ok: false, message: 'no global fetch (Node 18+ required)' };
    return { ok: true, message: 'OPENROUTER_API_KEY is set (not verified: check() never calls the network)' };
  },
};
