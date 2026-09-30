/**
 * pipeline/splice.js — apply a re-recorded sentence clip to take.json (§5 /rerecord).
 *
 * rerecord(videoDir, sentenceId, clipBase, { whisperModel, useJev, forceWhisper })
 *   clipBase: 'takes/rr-s2.1-1' (extension optional; .webm/.wav/.mp3 accepted)
 * Steps: ensure clip wav + hq.wav → silent clip? (max volume < silence.maxDb →
 * rejected at once, whisper never runs) → whisper the clip → run the same
 * analyzer as the full take (analyze.analyzeWords) against ONLY that sentence,
 * scored against the take's attemptRef → flags.
 *   ok / warn → the clip becomes another ATTEMPT of the sentence
 *               (sentence.attempts[], source 'rerecord', docs/spec.md §7a) and
 *               the best attempt wins unless the user picked one
 *               (sentence.pick). If the clip wins: sentence.status =
 *               'rerecorded', sentence.source = { kind:'rerecord', clip, range,
 *               cuts, words } (clip-relative; cuts/words are additive fields
 *               cut.js needs), sentence.flags = the clip's flags, original take
 *               analysis saved in sentence.take so it can be restored. If a take
 *               attempt still scores higher the take stays (result.kept = 'take').
 *   bad / missing / silent → sentence unchanged; returns { ok:false, reason }.
 * A take.json written before attempts existed has no sentence.attempts: the
 * take side becomes one unscored attempt, so the accepted clip wins (old behaviour).
 * Every clip is appended to sentence.rerecords[]. take.json is rewritten with a
 * fresh summary (estimatedCleanSec from cut.plan) and status.
 */
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./config');
const audio = require('./audio');
const whisper = require('./whisper');
const jev = require('./jev');
const ATT = require('./attempts');
const { analyzeWords, refineWords, silenceNoiseDb, summarize, takeStatus, isSilent, silenceHallucination, SILENT_MSG } = require('./analyze');
const cut = require('./cut');

function finish(videoDir, take, cfg) {
  if (!['silent', 'no-speech'].includes(take.status) || take.sentences.some(x => x.status === 'rerecorded')) take.status = takeStatus(take.sentences);
  take.summary = summarize(take.sentences, take.cuts || [], take.audio ? take.audio.durationSec : 0);
  try { take.summary.estimatedCleanSec = Math.round(cut.plan(videoDir, take, cfg).estSec * 1000) / 1000; } catch (_) { /* keep formula */ }
  fs.writeFileSync(path.join(videoDir, 'take.json'), JSON.stringify(take, null, 2));
}

async function rerecord(videoDir, sentenceId, clipBase, opts = {}) {
  const cfg = loadConfig(opts.config);
  videoDir = path.resolve(videoDir);
  const takePath = path.join(videoDir, 'take.json');
  if (!fs.existsSync(takePath)) throw new Error(`no take.json in ${videoDir} — run analyze first`);
  const take = JSON.parse(fs.readFileSync(takePath, 'utf8'));
  const s = take.sentences.find(x => x.id === sentenceId);
  if (!s) throw new Error(`unknown sentence ${sentenceId}`);
  const clip = String(clipBase).replace(/\.(hq\.wav|wav|webm|mp3|json)$/i, '').replace(/^\.?\//, '');

  const { wav, hq } = audio.ensureWavs(path.join(videoDir, clip));
  const stats = audio.volumeStats(hq, undefined, undefined, { clipDb: cfg.thresholds.clippingMaxDb });
  if (isSilent(stats, cfg)) {
    const reason = `${SILENT_MSG} (clip max ${stats.maxVolumeDb} dBFS)`;
    s.rerecords = [...(s.rerecords || []), { clip, at: new Date().toISOString(), status: 'silent', wer: null, range: null, flags: [reason] }];
    finish(videoDir, take, cfg);
    return { ok: false, silent: true, reason, sentence: s, summary: take.summary, status: take.status };
  }
  const raw = opts.words || whisper.transcribe(wav, { model: opts.whisperModel, force: opts.forceWhisper, quiet: opts.quiet });
  const durationSec = audio.duration(hq);
  const sil = audio.silences(hq, { noiseDb: silenceNoiseDb(stats.meanVolumeDb, cfg.thresholds), minSec: cfg.thresholds.silenceMinSec });
  const words = refineWords(raw, sil);
  const useJev = opts.useJev !== false && jev.available();

  const out = await analyzeWords({ sentences: [{ id: s.id, scene: s.scene, line: s.line, text: s.text }], words,
    audioFile: hq, durationSec, cfg, useJev, attemptRef: take.attemptRef || null });
  const r = out.sentences[0];
  const attempt = { clip, at: new Date().toISOString(), status: r.status, wer: r.wer, range: r.range,
    flags: r.flags.map(f => `${f.severity} ${f.type}: ${f.detail || ''}`.trim()) };
  const ok = r.status === 'ok' || r.status === 'warn';
  let reason = null, kept = null;
  if (ok) {
    if (!Array.isArray(s.attempts)) {                  // take.json from before attempts: unscored take side
      const t = s.source && s.source.kind === 'rerecord' ? s.take : s;
      s.attempts = t && t.range ? [ATT.legacyTake(t)] : [];
      if (s.source && s.source.kind === 'rerecord') s.attempts.push(ATT.legacyRerecord(s));
    }
    s.attempts = ATT.renumber([...s.attempts.filter(a => !(a.source === 'rerecord' && a.clip === clip)), ATT.rerecordEntry(r, out, clip)]);
    const { chosen } = ATT.applyChoice(s, cfg);
    kept = chosen ? chosen.source : null;
    if (kept === 'take') {
      const mine = s.attempts.find(a => a.clip === clip);
      reason = `clip accepted as attempt #${mine.n} (score ${ATT.r2(mine.score ?? 0)}), but take attempt #${chosen.n} scores higher (${ATT.r2(chosen.score ?? 0)}) — kept the take. Pick the clip in Review to override.`;
    }
  } else {
    const h = r.status === 'missing' ? silenceHallucination(raw, cfg) : null;
    reason = h ? `clip has no usable speech — ${h.message}`
      : r.status === 'missing' ? 'sentence not found in the clip'
        : r.flags.filter(f => f.severity === 'bad').map(f => `${f.type}: ${f.detail}`).join('; ');
  }
  s.rerecords = [...(s.rerecords || []), attempt];
  finish(videoDir, take, cfg);
  return { ok, kept, reason, sentence: s, summary: take.summary, status: take.status };
}

module.exports = { rerecord };
