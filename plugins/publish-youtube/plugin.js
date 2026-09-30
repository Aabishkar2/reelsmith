'use strict';
/**
 * plugins/publish-youtube — upload a finished video to YouTube (Data API v3, resumable upload).
 * docs/framework-spec.md §5.5. Self-contained: lib/ holds the OAuth, sign-in and upload code.
 *
 *   publish({ video, dryRun, force, privacy, file, notes, root, config, env, log })
 *       → { ok, dryRun, target: 'youtube', id?, url?, privacy?, request, sent?, refused?, problems? }
 *     video    { dir, name } or a folder path
 *     privacy  private | unlisted | public   (default private; beats publish.md / youtube.json)
 *     file     relative to the video folder   (default output.mp4, or legacy youtube.json "file")
 *     notes    parsed publish.md (core/publishNotes); read from the video folder when omitted
 *   Metadata: publish.md (## Title ≤ 100 chars, ## Description ≤ 5000 bytes, ## Tags ≤ 500 chars;
 *   frontmatter privacy / categoryId / madeForKids / file), then a legacy youtube.json, then the
 *   script.md title. A re-run refuses when publish/youtube.json (or the legacy youtube-upload.json)
 *   already has an id, unless force. dryRun reads the credentials, checks the file, builds and prints
 *   the full videos.insert request (token redacted) and returns without any network call.
 *   Result → videos/<n>/publish/youtube.json { id, url, studioUrl, requestedPrivacy, privacy, … }.
 *
 *   check(ctx)  client JSON + token present (no network), token age hint
 *   auth({ check, open, env, log })  the loopback Google sign-in (check: verify the stored token)
 */
const fs = require('fs');
const path = require('path');
const notesLib = require('../../core/publishNotes');
const yt = require('./lib/oauth');
const signin = require('./lib/auth');
const upload = require('./lib/upload');

const TARGET = 'youtube';
const PRIVACIES = ['private', 'unlisted', 'public'];
const DEFAULT_CATEGORY = '22'; // People & Blogs
const MIME = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm' };
const TOKEN_DAYS = 7;

const logger = (log) => (typeof log === 'function' ? log : log && typeof log.info === 'function' ? (...a) => log.info(...a) : console.log);
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return null; } };

function videoDirOf(video, root) {
  const v = typeof video === 'string' ? video : video && (video.dir || video.path || video.name);
  if (!v) throw new Error('publish: `video` (a folder or { dir }) is required');
  return path.resolve(root || process.cwd(), v);
}

const rel = (p, root) => {
  const r = path.relative(root || process.cwd(), p);
  return r && !r.startsWith('..') ? r : p;
};

/** Everything the upload needs, or the list of problems. No network. */
function resolveRequest({ dir, notes, privacy, file, targetConfig = {} }) {
  const problems = [];
  const info = [];
  const legacyPath = path.join(dir, 'youtube.json');
  const legacy = readJson(legacyPath);
  const legacyMeta = legacy && typeof legacy === 'object' && !Array.isArray(legacy) && (legacy.title || legacy.file) ? legacy : null;
  const fm = notes.meta || {};

  let title = notes.exists && notes.titleSource === 'publish.md' ? notes.title : '';
  let titleFrom = 'publish.md';
  if (!title && legacyMeta && legacyMeta.title) { title = String(legacyMeta.title); titleFrom = 'youtube.json'; }
  if (!title && notes.title) { title = notes.title; titleFrom = notes.titleSource || 'script.md'; }
  title = String(title || '').trim();
  if (titleFrom !== 'publish.md' && title) info.push(`title from ${titleFrom} — write publish.md (reelsmith publish <video> --notes) to set it`);
  if (!title) problems.push('title is required (1–100 characters): write ## Title in publish.md');
  else if ([...title].length > 100) problems.push(`title is ${[...title].length} characters, max 100`);

  let description = notes.description || '';
  if (!description && legacyMeta && typeof legacyMeta.description === 'string') description = legacyMeta.description;
  if (Buffer.byteLength(description) > 5000) problems.push(`description is ${Buffer.byteLength(description)} bytes, max 5000`);
  for (const [k, v] of [['title', title], ['description', description]]) {
    if (/[<>]/.test(v)) problems.push(`${k} contains "<" or ">" — YouTube rejects them`);
  }

  let tags = notes.tags && notes.tags.length ? notes.tags : legacyMeta && Array.isArray(legacyMeta.tags) ? legacyMeta.tags : [];
  tags = tags.map((t) => String(t).trim()).filter(Boolean);
  if (tags.some((t) => /[<>]/.test(t))) problems.push('tags contain "<" or ">" — YouTube rejects them');
  const tagChars = tags.reduce((n, t) => n + [...t].length + (/\s/.test(t) ? 2 : 0), 0); // a spaced tag counts its quotes
  if (tagChars > 500) problems.push(`tags total ${tagChars} characters, max 500`);

  const pickFirst = (...vals) => vals.find((v) => v !== undefined && v !== null && v !== '');
  const categoryId = String(pickFirst(fm.categoryId, legacyMeta && legacyMeta.categoryId, targetConfig.categoryId, DEFAULT_CATEGORY));
  if (!/^\d+$/.test(categoryId)) problems.push(`categoryId must be numeric (got "${categoryId}")`);

  const privacyFrom = privacy ? '--privacy' : fm.privacy ? 'publish.md' : legacyMeta && legacyMeta.privacy ? 'youtube.json'
    : targetConfig.privacy ? 'reelsmith.config.json' : 'default';
  const priv = String(pickFirst(privacy, fm.privacy, legacyMeta && legacyMeta.privacy, targetConfig.privacy, 'private'));
  if (!PRIVACIES.includes(priv)) problems.push(`privacy must be one of ${PRIVACIES.join('|')} (got "${priv}")`);

  const kids = pickFirst(fm.madeForKids, legacyMeta && legacyMeta.madeForKids, targetConfig.madeForKids, false);
  if (typeof kids !== 'boolean') problems.push('madeForKids must be true or false');

  const fileFrom = file ? '--file' : fm.file ? 'publish.md' : legacyMeta && legacyMeta.file ? 'youtube.json' : 'default';
  const filePath = path.resolve(dir, String(pickFirst(file, fm.file, legacyMeta && legacyMeta.file, 'output.mp4')));
  let size = 0;
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) problems.push(`video file not found: ${filePath}`);
  else if ((size = fs.statSync(filePath).size) === 0) problems.push(`video file is empty: ${filePath}`);

  const snippet = { title, description, categoryId };
  if (tags.length) snippet.tags = tags;
  return {
    problems, info, snippet, status: { privacyStatus: priv, selfDeclaredMadeForKids: kids === true },
    filePath, size, mime: MIME[path.extname(filePath).toLowerCase()] || 'video/mp4', privacyFrom, fileFrom, tagChars,
  };
}

/** Credentials without any network call → { ok, problems[], info[], loc, token? } */
function readCredentials(env) {
  const loc = yt.locate(env);
  const problems = [];
  const info = [];
  const note = yt.migrationNote(loc);
  if (note) info.push(note);
  try { yt.loadClient(loc); } catch (e) { problems.push(yt.scrub(e.message)); }
  let token = null;
  try {
    token = yt.loadToken(loc);
    const age = yt.tokenAgeDays(token);
    if (age != null) {
      info.push(`token issued ${age.toFixed(1)} days ago${age >= TOKEN_DAYS - 1 ? ` — Testing-mode tokens expire after ${TOKEN_DAYS} days; run ${yt.AUTH_COMMAND} if the upload is refused` : ''}`);
    }
  } catch (e) { problems.push(yt.scrub(e.message)); }
  return { ok: problems.length === 0, problems, info, loc, token };
}

function redactedRequest(meta) {
  const req = upload.insertRequest('[redacted]', meta);
  return { ...req, file: meta.filePath, bytes: meta.size };
}

module.exports = {
  name: 'publish-youtube',
  kind: 'publish',
  version: '1.0.0',
  description: 'YouTube upload (Data API v3, resumable) with a loopback Google sign-in',
  configSchema: {
    REELSMITH_CONFIG_DIR: { type: 'string', required: false, env: 'REELSMITH_CONFIG_DIR', default: '~/.config/reelsmith',
      description: 'Folder with youtube-client.json (Google "Desktop app" OAuth client) and yt-token.json (written by --auth).' },
    YOUTUBE_CLIENT_FILE: { type: 'string', required: false, env: 'YOUTUBE_CLIENT_FILE',
      description: 'Path to the OAuth client JSON, if not <config dir>/youtube-client.json.' },
    privacy: { type: 'string', required: false, description: 'publish.targets.youtube.privacy: default privacy (private).' },
    categoryId: { type: 'string', required: false, description: `publish.targets.youtube.categoryId (default ${DEFAULT_CATEGORY}).` },
  },

  async check(ctx = {}) {
    const creds = readCredentials(ctx.env || process.env);
    const where = creds.loc.dir;
    if (!creds.ok) {
      return { ok: false, optional: true, message: `${creds.problems[0].split('\n')[0]}${creds.problems.length > 1 ? ` (+${creds.problems.length - 1} more)` : ''}` };
    }
    const legacy = creds.loc.legacy.client || creds.loc.legacy.token;
    return { ok: true, optional: true,
      message: `client + token found${legacy ? '' : ` in ${where}`}${creds.info.length ? `; ${creds.info.join('; ')}` : ''}` };
  },

  async auth({ check = false, open = true, env = process.env, log } = {}) {
    const say = logger(log);
    const loc = yt.locate(env);
    const note = yt.migrationNote(loc);
    if (note) say(`  note: ${note}`);
    try {
      return check ? await signin.verify({ loc, log: say }) : await signin.signIn({ loc, log: say, open });
    } catch (e) {
      throw new Error(yt.scrub(e.message));
    }
  },

  async publish(args = {}) {
    const { video, dryRun = false, force = false, privacy, file, root, config, env = process.env } = args;
    const say = logger(args.log);
    const dir = videoDirOf(video, root);
    const notes = args.notes && typeof args.notes === 'object' ? { exists: true, titleSource: 'publish.md', ...args.notes } : notesLib.load(dir);
    const targetConfig = (config && config.publish && config.publish.targets && config.publish.targets.youtube) || {};
    const meta = resolveRequest({ dir, notes, privacy, file, targetConfig });
    const request = redactedRequest(meta);
    const prev = notesLib.readResult(dir, TARGET);
    const refused = prev && prev.id && !force
      ? `already uploaded (${prev.url || prev.id}, ${prev.legacy ? 'youtube-upload.json' : 'publish/youtube.json'}) — re-run with --force to upload a duplicate`
      : null;
    const base = { target: TARGET, dryRun, request };

    if (dryRun) {
      const creds = readCredentials(env);
      say('DRY RUN — nothing was sent to YouTube.\n');
      say(`  Video    : ${rel(meta.filePath, root)} (${upload.fmtMB(meta.size)}, ${meta.size} bytes, ${meta.mime}; from ${meta.fileFrom})`);
      say(`  Privacy  : ${meta.status.privacyStatus} (from ${meta.privacyFrom})`);
      say(`  Title    : ${meta.snippet.title} (${[...meta.snippet.title].length}/100)`);
      say(`  Tags     : ${(meta.snippet.tags || []).length} (${meta.tagChars}/500 chars)`);
      say(`  Auth     : ${creds.ok ? `ok (${path.dirname(creds.loc.clientFile)})` : creds.problems.join("; ")}`);
      for (const n of [...meta.info, ...creds.info]) say(`  Note     : ${n}`);
      if (refused) say(`  Refused  : ${refused}`);
      say('\n  videos.insert (resumable) request:');
      say(JSON.stringify(request, null, 2).replace(/^/gm, '  '));
      const problems = [...meta.problems, ...creds.problems];
      if (problems.length) { say('\n✗ would fail:'); for (const p of problems) say(`  - ${p}`); }
      return { ...base, ok: problems.length === 0 && !refused, problems, ...(refused ? { refused } : {}) };
    }

    if (meta.problems.length) {
      throw new Error(`YouTube metadata has ${meta.problems.length} problem(s):\n  - ${meta.problems.join('\n  - ')}`);
    }
    if (refused) return { ...base, ok: false, refused, id: prev.id, url: prev.url };
    for (const n of meta.info) say(`  Note: ${n}`);

    const loc = yt.locate(env);
    const note = yt.migrationNote(loc);
    if (note) say(`  Note: ${note}`);
    try {
      let authz = await yt.refreshAccessToken(loc);
      const accessToken = async () => {
        if (authz.expiresAt - Date.now() < 5 * 60 * 1000) authz = await yt.refreshAccessToken(loc);
        return authz.accessToken;
      };
      say('✓ access token refreshed');
      const t0 = Date.now();
      const sessionUrl = await upload.startSession(authz.accessToken, meta);
      const buf = fs.readFileSync(meta.filePath);
      say(`→ uploading ${rel(meta.filePath, root)} (${upload.fmtMB(buf.length)}) as ${meta.status.privacyStatus} …`);
      const inserted = await upload.sendBytes(sessionUrl, buf, meta.mime, say);
      say(`✓ upload finished in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      const id = inserted && inserted.id;
      if (!id) throw new Error('upload finished but YouTube returned no video id');

      // The upload can't be repeated cheaply: a failed verification must not lose the record.
      let vid = null;
      try {
        const q = new URLSearchParams({ part: 'status,processingDetails,snippet', id });
        const data = await yt.apiGet(`${upload.VIDEOS_URL}?${q}`, await accessToken());
        vid = (data.items && data.items[0]) || null;
      } catch (e) {
        say(`⚠ uploaded, but could not re-read the video to confirm its status: ${e.message}`);
      }
      const status = (vid && vid.status) || inserted.status || {};
      const actual = status.privacyStatus || 'unknown';
      const url = `https://youtu.be/${id}`;
      const record = {
        target: TARGET, id, url, studioUrl: `https://studio.youtube.com/video/${id}/edit`,
        requestedPrivacy: meta.status.privacyStatus, privacy: actual, status,
        title: (vid && vid.snippet && vid.snippet.title) || meta.snippet.title, categoryId: meta.snippet.categoryId,
        file: path.relative(dir, meta.filePath), bytes: meta.size, at: new Date().toISOString(),
      };
      const out = notesLib.writeResult(dir, TARGET, record);
      say(`\n  Video id : ${id}\n  Watch    : ${url}\n  Studio   : ${record.studioUrl}`);
      say(`  Privacy  : requested ${meta.status.privacyStatus} | ACTUAL ${actual}`);
      if (meta.status.privacyStatus !== actual && actual !== 'unknown') {
        say('⚠ YouTube overrode the privacy (unaudited API projects are locked to private until they pass the API compliance audit).');
      }
      say(`✓ recorded → ${rel(out, root)}`);
      return { ...base, ok: true, id, url, privacy: actual, sent: { snippet: meta.snippet, status: meta.status, bytes: meta.size }, result: out };
    } catch (e) {
      throw new Error(yt.scrub(e.message));
    }
  },

  // exposed for tests and tools
  _resolveRequest: resolveRequest,
};
