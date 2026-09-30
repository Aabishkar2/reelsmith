'use strict';
/**
 * plugins/publish-discord — post a finished video to a Discord channel with a bot (team review).
 * docs/framework-spec.md §5.5. Global fetch + FormData; ffmpeg/ffprobe for the size transcode.
 *
 *   publish({ video, dryRun, force, file, channel, limitBytes, notes, root, config, env, paths, log })
 *       → { ok, dryRun, target: 'discord', id?, url?, channelId, message, file, bytes, transcoded, request }
 *     channel     channel id (--channel=), else env[publish.targets.discord.channelIdEnv || 'DISCORD_CHANNEL_ID']
 *     file        relative to the video folder (default output.mp4)
 *     limitBytes  upload limit (default 10 MiB, the limit for bots on servers without boosts;
 *                 publish.targets.discord.limitBytes or env DISCORD_MAX_BYTES override it)
 *   Message: the publish.md title (fallback: the script.md title) + the first line of the
 *   description. When the file is over the limit it is transcoded to output-discord.mp4 first
 *   (libx264 -preset slow, two-pass, video bitrate from the duration so the file lands ≤ 9.3 MB,
 *   AAC 96k, 720×1280; 540×960 if still too big) and that file is sent. The transcode is reused
 *   while it is newer than the source and under the limit.
 *   dryRun prints channel, message, file, size and whether a transcode is needed, and DOES run the
 *   transcode so the size can be checked. It never calls Discord.
 *   Result → videos/<n>/publish/discord.json { id, messageId, channelId, guildId, url, file, bytes, transcoded, at }.
 *   A re-run refuses when that file has an id, unless force.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const notesLib = require('../../core/publishNotes');

const TARGET = 'discord';
const API = 'https://discord.com/api/v10';
const LIMIT = 10 * 1024 * 1024; // 10 MiB
const TARGET_BYTES = 9.3e6; // aim for 9.3 MB total
const AUDIO_KBPS = 96;
const CONTENT_MAX = 2000;
const SIZES = [[720, 1280], [540, 960]];

const logger = (log) => (typeof log === 'function' ? log : log && typeof log.info === 'function' ? (...a) => log.info(...a) : console.log);
const fmtMB = (b) => `${(b / 1048576).toFixed(2)} MB`;

function videoDirOf(video, root) {
  const v = typeof video === 'string' ? video : video && (video.dir || video.path || video.name);
  if (!v) throw new Error('publish: `video` (a folder or { dir }) is required');
  return path.resolve(root || process.cwd(), v);
}

const secrets = new Set();
const addSecret = (v) => { if (v && String(v).length >= 8) secrets.add(String(v)); };
function scrub(text) {
  let out = String(text);
  for (const s of secrets) out = out.split(s).join('[redacted]');
  return out.replace(/[MN][A-Za-z\d_-]{23,25}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{27,}/g, '[redacted]');
}

// ── tools ───────────────────────────────────────────────────────────────────
function findTool(name, paths, env) {
  if (paths && paths[name]) return paths[name];
  try {
    const p = require('../../core/env')[name]();
    if (p) return p;
  } catch (_) { /* core/env unavailable: resolve here */ }
  const override = env[name === 'ffmpeg' ? 'FFMPEG_PATH' : 'FFPROBE_PATH'];
  const dirs = [...String(env.PATH || '').split(path.delimiter), '/opt/homebrew/bin', '/usr/local/bin'].filter(Boolean);
  for (const c of [override, ...dirs.map((d) => path.join(d, name))].filter(Boolean)) {
    try { fs.accessSync(c, fs.constants.X_OK); return c; } catch (_) { /* next */ }
  }
  return name;
}

function run(bin, args) {
  const r = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(`${path.basename(bin)} could not start: ${r.error.code || r.error.message} (install ffmpeg or set FFMPEG_PATH)`);
  if (r.status !== 0) throw new Error(`${path.basename(bin)} failed (exit ${r.status}): ${String(r.stderr || '').trim().split('\n').slice(-3).join(' | ')}`);
  return r.stdout;
}

function probe(ffprobe, file) {
  const out = JSON.parse(run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', file]));
  const v = (out.streams || []).find((s) => s.codec_type === 'video') || {};
  return { duration: Number(out.format && out.format.duration) || 0, width: v.width || 0, height: v.height || 0,
    hasAudio: (out.streams || []).some((s) => s.codec_type === 'audio') };
}

/** Two-pass size-targeted transcode → { file, bytes, width, height, videoKbps } (throws if it can't fit). */
function transcode({ ffmpeg, ffprobe, src, out, targetBytes, limitBytes, say }) {
  const info = probe(ffprobe, src);
  if (!(info.duration > 0)) throw new Error(`cannot read the duration of ${src}`);
  const audio = info.hasAudio ? AUDIO_KBPS : 0;
  let last = null;
  for (let i = 0; i < SIZES.length; i++) {
    const [w, h] = SIZES[i];
    const factor = i === 0 ? 1 : 0.9;
    let vk = Math.floor(((targetBytes * 8 * 0.96) / info.duration / 1000 - audio) * factor);
    if (vk < 80) { say(`  ⚠ ${info.duration.toFixed(1)} s is long for ${fmtMB(targetBytes)}: video bitrate clamped to 80 kbps`); vk = 80; }
    const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reelsmith-discord-'));
    const passlog = path.join(logDir, 'pass');
    const vf = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
    const common = ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-vf', vf, '-c:v', 'libx264', '-preset', 'slow',
      '-b:v', `${vk}k`, '-maxrate', `${Math.round(vk * 1.6)}k`, '-bufsize', `${vk * 2}k`, '-pix_fmt', 'yuv420p', '-passlogfile', passlog];
    say(`  transcoding → ${path.basename(out)} (${w}×${h}, ${vk} kbps video + ${audio} kbps audio, two-pass) …`);
    try {
      run(ffmpeg, [...common, '-pass', '1', '-an', '-f', 'mp4', os.devNull]);
      run(ffmpeg, [...common, '-pass', '2', ...(audio ? ['-c:a', 'aac', '-b:a', `${audio}k`] : ['-an']), '-movflags', '+faststart', out]);
    } finally {
      fs.rmSync(logDir, { recursive: true, force: true });
    }
    const bytes = fs.statSync(out).size;
    last = { file: out, bytes, width: w, height: h, videoKbps: vk };
    if (bytes <= limitBytes) return last;
    say(`  ${fmtMB(bytes)} is still over ${fmtMB(limitBytes)}${i + 1 < SIZES.length ? '; retrying smaller' : ''}`);
  }
  throw new Error(`transcode could not get ${path.basename(src)} under ${fmtMB(limitBytes)} (last ${fmtMB(last.bytes)})`);
}

// ── plan ────────────────────────────────────────────────────────────────────
function settings({ config, env, channel, limitBytes }) {
  const tc = (config && config.publish && config.publish.targets && config.publish.targets.discord) || {};
  const channelEnv = tc.channelIdEnv || 'DISCORD_CHANNEL_ID';
  const limit = Number(limitBytes || tc.limitBytes || env.DISCORD_MAX_BYTES) || LIMIT;
  return {
    token: env.DISCORD_BOT_TOKEN || '',
    channelEnv,
    channelId: String(channel || tc.channelId || env[channelEnv] || '').trim(),
    limit,
    targetBytes: Math.min(TARGET_BYTES, Math.floor(limit * 0.93)),
  };
}

function composeMessage(notes, dir) {
  const title = String(notes.title || path.basename(dir)).trim();
  const first = String(notes.description || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
  const line = first && first !== title && !/^#\S/.test(first) ? first : '';
  let content = `**${title}**${line ? `\n${line}` : ''}`;
  if (content.length > CONTENT_MAX) content = `${content.slice(0, CONTENT_MAX - 1)}…`;
  return content;
}

async function discord(method, url, token, body) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      res = await globalThis.fetch(url, { method, headers: { Authorization: `Bot ${token}` }, body });
    } catch (e) {
      const cause = e && e.cause && e.cause.code ? ` (${e.cause.code})` : '';
      throw new Error(scrub(`network error contacting Discord: ${(e && e.message) || e}${cause}`));
    }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) { /* not JSON */ }
    if (res.status === 429 && attempt === 0) {
      const wait = Math.min(10, Number((json && json.retry_after) || 1));
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    if (!res.ok) {
      const msg = json && json.message ? `${json.message}${json.code ? ` [code ${json.code}]` : ''}` : res.statusText;
      const hint = res.status === 401 ? ' — DISCORD_BOT_TOKEN is invalid'
        : res.status === 403 ? ' — the bot needs View Channel, Send Messages and Attach Files in that channel'
          : res.status === 404 ? ' — unknown channel (check the channel id, and that the bot is in that server)'
            : res.status === 413 ? ' — file too large for this server' : '';
      throw new Error(scrub(`Discord HTTP ${res.status}: ${msg}${hint}`));
    }
    return json;
  }
  throw new Error('Discord kept rate-limiting the request');
}

module.exports = {
  name: 'publish-discord',
  kind: 'publish',
  version: '1.0.0',
  description: 'Post the video to a Discord channel with a bot (transcodes to fit the 10 MB limit)',
  configSchema: {
    DISCORD_BOT_TOKEN: { type: 'string', required: true, env: 'DISCORD_BOT_TOKEN', secret: true,
      description: 'Bot token (Discord developer portal → your app → Bot). The bot needs View Channel, Send Messages, Attach Files.' },
    DISCORD_CHANNEL_ID: { type: 'string', required: true, env: 'DISCORD_CHANNEL_ID',
      description: 'Channel to post in. publish.targets.discord.channelIdEnv renames this variable; --channel= overrides it.' },
    limitBytes: { type: 'number', required: false, env: 'DISCORD_MAX_BYTES', default: LIMIT,
      description: 'Upload limit in bytes (10 MiB without server boosts).' },
  },

  async check(ctx = {}) {
    const s = settings({ config: ctx.config, env: ctx.env || process.env });
    const missing = [!s.token && 'DISCORD_BOT_TOKEN', !s.channelId && s.channelEnv].filter(Boolean);
    if (missing.length) return { ok: false, optional: true, message: `${missing.join(', ')} not set (.env)` };
    return { ok: true, optional: true, message: `bot token + channel ${s.channelId}; files over ${fmtMB(s.limit)} are transcoded` };
  },

  async publish(args = {}) {
    const { video, dryRun = false, force = false, file, channel, limitBytes, root, config, env = process.env, paths } = args;
    const say = logger(args.log);
    const dir = videoDirOf(video, root);
    const notes = args.notes && typeof args.notes === 'object' ? args.notes : notesLib.load(dir);
    const s = settings({ config, env, channel, limitBytes });
    addSecret(s.token);
    const problems = [];
    if (!s.token) problems.push('DISCORD_BOT_TOKEN is not set (.env)');
    if (!s.channelId) problems.push(`no channel: set ${s.channelEnv} in .env or pass --channel=<id>`);
    else if (!/^\d{15,22}$/.test(s.channelId)) problems.push(`channel id "${s.channelId}" does not look like a Discord snowflake`);

    const src = path.resolve(dir, file || 'output.mp4');
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) problems.push(`video file not found: ${src}`);
    const content = composeMessage(notes, dir);
    const prev = notesLib.readResult(dir, TARGET);
    const refused = prev && prev.id && !force ? `already posted (${prev.url || prev.id}) — re-run with --force to post again` : null;

    let send = src;
    let bytes = problems.some((p) => p.startsWith('video file')) ? 0 : fs.statSync(src).size;
    const srcBytes = bytes;
    const needsTranscode = bytes > s.limit;
    let transcoded = null;
    if (needsTranscode) {
      const out = path.join(dir, `${path.basename(src, path.extname(src))}-discord.mp4`);
      const fresh = fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(src).mtimeMs && fs.statSync(out).size <= s.limit;
      if (fresh) {
        transcoded = { file: out, bytes: fs.statSync(out).size, reused: true };
        say(`  reusing ${path.basename(out)} (${fmtMB(transcoded.bytes)}, newer than the source)`);
      } else {
        say(`  ${path.basename(src)} is ${fmtMB(bytes)}, over the ${fmtMB(s.limit)} limit`);
        transcoded = transcode({ ffmpeg: findTool('ffmpeg', paths, env), ffprobe: findTool('ffprobe', paths, env), src, out,
          targetBytes: s.targetBytes, limitBytes: s.limit, say });
        say(`  ✓ ${path.basename(out)}: ${fmtMB(transcoded.bytes)}`);
      }
      send = transcoded.file;
      bytes = transcoded.bytes;
    }

    const request = {
      method: 'POST', url: `${API}/channels/${s.channelId || '{channel}'}/messages`, auth: 'Bot [redacted]',
      multipart: { payload_json: { content, attachments: [{ id: 0, filename: path.basename(send) }] }, 'files[0]': `@${send} (${bytes} bytes, video/mp4)` },
    };
    const base = { target: TARGET, dryRun, channelId: s.channelId, message: content, file: send, bytes, transcoded: Boolean(transcoded), request };

    if (dryRun) {
      say('DRY RUN — nothing was sent to Discord.\n');
      say(`  Channel  : ${s.channelId || '(none)'}${channel ? ' (--channel)' : ` (${s.channelEnv})`}`);
      say(`  Message  : ${content.replace(/\n/g, ' ⏎ ')}`);
      say(`  File     : ${send} (${fmtMB(bytes)}, limit ${fmtMB(s.limit)})`);
      say(`  Transcode: ${needsTranscode ? `yes — ${fmtMB(srcBytes)} → ${fmtMB(bytes)}${transcoded && transcoded.reused ? ' (reused)' : ''}` : 'no, under the limit'}`);
      if (refused) say(`  Refused  : ${refused}`);
      say('\n  request:');
      say(JSON.stringify(request, null, 2).replace(/^/gm, '  '));
      if (problems.length) { say('\n✗ would fail:'); for (const p of problems) say(`  - ${p}`); }
      return { ...base, ok: problems.length === 0 && !refused, problems, ...(refused ? { refused } : {}) };
    }

    if (problems.length) throw new Error(`Discord publish has ${problems.length} problem(s):\n  - ${problems.join('\n  - ')}`);
    if (refused) return { ...base, ok: false, refused, id: prev.id, url: prev.url };

    const ch = await discord('GET', `${API}/channels/${s.channelId}`, s.token);
    const form = new FormData();
    form.append('payload_json', JSON.stringify(request.multipart.payload_json));
    form.append('files[0]', new Blob([fs.readFileSync(send)], { type: 'video/mp4' }), path.basename(send));
    say(`→ posting ${path.basename(send)} (${fmtMB(bytes)}) to #${ch.name || s.channelId} …`);
    const msg = await discord('POST', `${API}/channels/${s.channelId}/messages`, s.token, form);
    const guildId = ch.guild_id || null;
    const url = `https://discord.com/channels/${guildId || '@me'}/${s.channelId}/${msg.id}`;
    const record = {
      target: TARGET, id: msg.id, messageId: msg.id, channelId: s.channelId, guildId, url,
      file: path.relative(dir, send), bytes, transcoded: Boolean(transcoded), at: new Date().toISOString(),
    };
    const out = notesLib.writeResult(dir, TARGET, record);
    say(`✓ posted: ${url}\n✓ recorded → ${path.relative(root || process.cwd(), out)}`);
    return { ...base, ok: true, id: msg.id, url, sent: { content, bytes }, result: out };
  },

  _settings: settings,
  _composeMessage: composeMessage,
};
