'use strict';
/**
 * plugins/stt-whisper — local word timestamps with openai-whisper (docs/framework-spec.md §5.3).
 *
 *   transcribe({ wavPath, mode = 'whole', prompt, model, config, force, quiet })
 *       → [{ word, start, end, conf }]  — a thin wrapper around pipeline/whisper.js transcribe(),
 *       so its cache semantics are unchanged: words cached at <wav minus .wav>.json plus
 *       <…>.whisper.json (mode/model), reused unless force, the wav is newer, or mode/model differ.
 *       mode   'whole' (one pass; TTS audio) | 'chunked' (VAD chunks; recorded takes)
 *       prompt undefined → the disfluent take prompt from config/fillers.json; '' or null → none
 *       model  default $WHISPER_MODEL, else 'turbo'
 *       config the pipeline config object (pipeline/config.js loadConfig()), optional
 *   available()  null when a python with openai-whisper is found (fast find_spec probe), else why not
 *   check(ctx)   real `import whisper` in the resolved python (what doctor reports)
 * Python: core/env.js pythonWithWhisper() ($REELSMITH_PYTHON, python3.11, python3.12, python3.13, python3).
 */
const env = require('../../core/env');

module.exports = {
  name: 'stt-whisper',
  kind: 'stt',
  version: '1.0.0',
  description: 'openai-whisper word timestamps (local, python), cached next to the wav',
  configSchema: {
    WHISPER_MODEL: { type: 'string', required: false, env: 'WHISPER_MODEL', default: 'turbo',
      description: 'Whisper model (tiny, base, small, medium, large, turbo). reelsmith.config.json stt.model is the project default.' },
    REELSMITH_PYTHON: { type: 'string', required: false, env: 'REELSMITH_PYTHON',
      description: 'Python interpreter with openai-whisper installed; otherwise python3.11 → python3.12 → python3.13 → python3.' },
  },

  available() {
    return env.pythonWithWhisper() ? null : 'openai-whisper not found in any python (pip install openai-whisper; or set REELSMITH_PYTHON)';
  },

  async transcribe({ wavPath, mode = 'whole', prompt, model, config, force, quiet } = {}) {
    if (!wavPath) throw new Error('transcribe: wavPath is required');
    return require('../../pipeline/whisper').transcribe(wavPath, { mode, prompt, model, config, force: Boolean(force), quiet: Boolean(quiet) });
  },

  async check() {
    const py = env.pythonWithWhisper({ strict: true });
    if (py) return { ok: true, message: `openai-whisper imports in ${py}` };
    const any = env.python();
    return {
      ok: false, optional: true,
      message: any ? `openai-whisper is not importable in ${any} — ${any} -m pip install openai-whisper (only needed for word timings)`
        : 'no python found (python3.11 recommended) — needed for Whisper word timings',
    };
  },
};
