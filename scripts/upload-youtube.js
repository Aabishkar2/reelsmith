#!/usr/bin/env node
/**
 * upload-youtube.js — upload a finished video to YouTube (Data API v3, resumable upload).
 *
 * Usage:
 *   node scripts/upload-youtube.js videos/<name> [--privacy=private|unlisted|public] [--file=output.mp4] [--dry-run] [--force]
 *
 * Reads videos/<name>/youtube.json:
 *   { "title", "description", "tags": [], "categoryId": "22", "privacy": "private", "madeForKids": false }
 * `privacy` defaults to private; --privacy overrides the file. --file is relative to the
 * video folder (default output.mp4). --dry-run validates and prints the request, no network.
 * Refuses to upload again when youtube-upload.json exists (a duplicate video) unless --force.
 *
 * Needs a token from `node scripts/youtube-auth.js` (see also: youtube-auth.js --check).
 * Writes videos/<name>/youtube-upload.json with the video id, links, requested privacy and
 * the status YouTube actually applied. Google documents that unaudited API projects are forced to
 * private; our project wasn't on its first upload (docs/youtube.md), but always trust the ACTUAL value.
 *
 * Secrets, tokens and the resumable-session URL are never printed.
 */
const fs = require('fs');
const path = require('path');
const yt = require('./lib/youtube-oauth');

const INSERT_URL = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
const VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos';
const MAX_RETRIES = 3;
const PRIVACIES = ['private', 'unlisted', 'public'];
const DEFAULT_CATEGORY = '22'; // People & Blogs
const MIME = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm' };

// ── CLI ────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node scripts/upload-youtube.js videos/<name> [--privacy=private|unlisted|public] [--file=output.mp4] [--dry-run] [--force]');
  console.log('Example: node scripts/upload-youtube.js videos/devotion-tts --dry-run');
  process.exit(args.length ? 0 : 2);
}

const flag = (name) => (args.find(a => a.startsWith(`--${name}=`)) || '').slice(name.length + 3) || null;
const target = args.find(a => !a.startsWith('--'));
const DRY_RUN = args.includes('--dry-run');
const FORCE = args.includes('--force');
const privacyArg = flag('privacy');
const fileArg = flag('file');

const knownFlag = /^--(privacy=.+|file=.+|dry-run|force|help)$/;
const bad = args.filter(a => a.startsWith('-') && a !== '-h' && !knownFlag.test(a));
if (bad.length || !target) {
  console.error(bad.length ? `Unknown or malformed argument: ${bad.join(' ')}` : 'Missing video folder.');
  console.error('Usage: node scripts/upload-youtube.js videos/<name> [--privacy=private|unlisted|public] [--file=output.mp4] [--dry-run] [--force]');
  process.exit(2);
}

const videoDir = path.resolve(target);
const metaPath = path.join(videoDir, 'youtube.json');
const recordPath = path.join(videoDir, 'youtube-upload.json');
const rel = (p) => {
  const r = path.relative(process.cwd(), p);
  return r && !r.startsWith('..') ? r : p;
};

function fail(msg) {
  console.error(`✗ ${yt.scrub(msg)}`);
  process.exit(1);
}

const fmtMB = (bytes) => (bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`);
const secs = (t0) => ((Date.now() - t0) / 1000).toFixed(1);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Metadata ───────────────────────────────────────────────────────────────────

/** → { snippet, status, filePath, size, mime, privacySource, notes } or exits with every problem listed. */
function resolveMetadata() {
  if (!fs.existsSync(videoDir) || !fs.statSync(videoDir).isDirectory()) fail(`${rel(videoDir)} is not a folder`);
  if (!fs.existsSync(metaPath)) fail(`${rel(metaPath)} not found — write it from publish.md (see .claude/skills/publish/SKILL.md)`);
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch (e) {
    fail(`${rel(metaPath)} is not valid JSON (${e.message})`);
  }
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) fail(`${rel(metaPath)} must be a JSON object`);

  const problems = [];
  const notes = [];

  const title = typeof meta.title === 'string' ? meta.title.trim() : '';
  if (!title) problems.push('title is required (1–100 characters)');
  else if ([...title].length > 100) problems.push(`title is ${[...title].length} characters, max 100`);

  const description = meta.description === undefined ? '' : meta.description;
  if (typeof description !== 'string') problems.push('description must be a string');
  else if (Buffer.byteLength(description) > 5000) problems.push(`description is ${Buffer.byteLength(description)} bytes, max 5000`);

  for (const [k, v] of [['title', title], ['description', description]]) {
    if (typeof v === 'string' && /[<>]/.test(v)) problems.push(`${k} contains "<" or ">" — YouTube rejects them`);
  }

  let tags = meta.tags === undefined ? [] : meta.tags;
  if (!Array.isArray(tags) || tags.some(t => typeof t !== 'string' || !t.trim())) {
    problems.push('tags must be an array of non-empty strings');
    tags = [];
  } else {
    tags = tags.map(t => t.trim());
    if (tags.some(t => /[<>]/.test(t))) problems.push('tags contain "<" or ">" — YouTube rejects them');
    // A tag with a space counts as if wrapped in quotes (+2).
    const total = tags.reduce((n, t) => n + [...t].length + (/\s/.test(t) ? 2 : 0), 0);
    if (total > 500) problems.push(`tags total ${total} characters, max 500`);
  }

  let categoryId = meta.categoryId === undefined || meta.categoryId === null ? DEFAULT_CATEGORY : String(meta.categoryId);
  if (!/^\d+$/.test(categoryId)) problems.push(`categoryId must be numeric (got "${categoryId}")`);
  if (meta.categoryId === undefined) notes.push(`categoryId not set — using ${DEFAULT_CATEGORY} (People & Blogs)`);

  const fromFile = meta.privacy === undefined ? 'private' : meta.privacy;
  const privacy = privacyArg || fromFile;
  if (!PRIVACIES.includes(privacy)) problems.push(`privacy must be one of ${PRIVACIES.join('|')} (got "${privacy}")`);
  const privacySource = privacyArg ? '--privacy' : meta.privacy === undefined ? 'default' : 'youtube.json';

  if (meta.madeForKids !== undefined && typeof meta.madeForKids !== 'boolean') problems.push('madeForKids must be true or false');
  if (meta.madeForKids === undefined) notes.push('madeForKids not set — declaring false (not made for kids)');

  const filePath = path.resolve(videoDir, fileArg || 'output.mp4');
  let size = 0;
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) problems.push(`video file not found: ${rel(filePath)}`);
  else {
    size = fs.statSync(filePath).size;
    if (size === 0) problems.push(`video file is empty: ${rel(filePath)}`);
  }

  if (problems.length) {
    console.error(`✗ ${rel(metaPath)} / video has ${problems.length} problem${problems.length > 1 ? 's' : ''}:`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  const snippet = { title, description, categoryId };
  if (tags.length) snippet.tags = tags;
  return {
    snippet,
    status: { privacyStatus: privacy, selfDeclaredMadeForKids: meta.madeForKids === true },
    filePath, size, mime: MIME[path.extname(filePath).toLowerCase()] || 'video/mp4', privacySource, notes,
  };
}

// ── Resumable upload ───────────────────────────────────────────────────────────

/** fetch that turns network failures into { status: 0 } so the resume loop can retry them. */
async function tryFetch(url, opts) {
  try {
    const res = await fetch(url, { redirect: 'manual', ...opts }); // 308 is "resume incomplete", not a redirect
    return { status: res.status, res };
  } catch (e) {
    return { status: 0, note: yt.netMessage('YouTube upload', e) };
  }
}

async function failFrom(res) {
  return yt.apiErrorFrom(res.status, await res.text().catch(() => ''), res.statusText);
}

/** Ask the session how many bytes it has: → { status, offset?, res? } */
async function queryProgress(sessionUrl, size) {
  const r = await tryFetch(sessionUrl, { method: 'PUT', headers: { 'Content-Length': '0', 'Content-Range': `bytes */${size}` } });
  if (r.status === 308) {
    const m = /bytes=\d+-(\d+)/.exec(r.res.headers.get('range') || '');
    r.offset = m ? Number(m[1]) + 1 : 0; // no Range header = nothing received yet
  }
  return r;
}

async function startSession(accessToken, meta) {
  const body = JSON.stringify({ snippet: meta.snippet, status: meta.status });
  let res;
  try {
    res = await fetch(INSERT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(meta.size),
        'X-Upload-Content-Type': meta.mime,
      },
      body,
    });
  } catch (e) {
    throw new Error(yt.netMessage('YouTube upload', e));
  }
  if (!res.ok) throw await failFrom(res);
  const location = res.headers.get('location');
  if (!location) throw new Error('YouTube did not return an upload session URL (no Location header)');
  yt.addSecret(location); // the session URL is a capability — never print it
  return location;
}

/** PUT the bytes; on 5xx / network errors / 308 resume from the server's offset, up to MAX_RETRIES times. */
async function sendBytes(sessionUrl, buf, mime) {
  const size = buf.length;
  const put = (offset) => {
    const body = offset ? buf.subarray(offset) : buf;
    const headers = { 'Content-Type': mime, 'Content-Length': String(body.length) };
    if (offset) headers['Content-Range'] = `bytes ${offset}-${size - 1}/${size}`;
    return tryFetch(sessionUrl, { method: 'PUT', headers, body });
  };
  const done = (r) => r.status === 200 || r.status === 201;

  let offset = 0;
  let retries = 0;
  let r = await put(0);
  while (!done(r)) {
    if (r.status >= 400 && r.status < 500) throw await failFrom(r.res);
    const why = r.status === 0 ? r.note : r.status === 308 ? 'server reported an incomplete upload' : `HTTP ${r.status}`;
    if (++retries > MAX_RETRIES) throw new Error(`upload failed after ${MAX_RETRIES} retries (last: ${why})`);
    console.log(`  … ${why}; checking upload status and resuming (retry ${retries}/${MAX_RETRIES})`);
    await sleep(retries * 2000);

    const q = await queryProgress(sessionUrl, size);
    if (q.status >= 400 && q.status < 500) throw await failFrom(q.res);
    if (done(q)) { r = q; break; }
    if (q.status === 308) offset = q.offset;
    else { r = q; continue; } // status query itself failed (5xx / network): burn a retry and ask again
    console.log(`  … server has ${fmtMB(offset)} of ${fmtMB(size)}; resuming from there`);
    r = await put(offset);
  }
  return r.res.json();
}

// ── Run ────────────────────────────────────────────────────────────────────────

(async () => {
  const meta = resolveMetadata();
  const requested = meta.status.privacyStatus;

  if (DRY_RUN) {
    console.log('DRY RUN — nothing was sent to YouTube.\n');
    console.log(`  Video   : ${rel(meta.filePath)} (${fmtMB(meta.size)}, ${meta.size} bytes, ${meta.mime})`);
    console.log(`  Privacy : ${requested} (from ${meta.privacySource})`);
    for (const n of meta.notes) console.log(`  Note    : ${n}`);
    console.log('\n  videos.insert body:');
    console.log(JSON.stringify({ snippet: meta.snippet, status: meta.status }, null, 2).replace(/^/gm, '  '));
    return;
  }

  if (fs.existsSync(recordPath) && !FORCE) {
    let prev = '';
    try { prev = ` (${JSON.parse(fs.readFileSync(recordPath, 'utf8')).url})`; } catch {}
    fail(`${rel(recordPath)} already exists${prev} — this video was already uploaded. Re-run with --force to upload a duplicate.`);
  }
  for (const n of meta.notes) console.log(`  Note: ${n}`);

  // Access token, refreshed again if the upload ran long.
  let auth = await yt.refreshAccessToken();
  const accessToken = async () => {
    if (auth.expiresAt - Date.now() < 5 * 60 * 1000) auth = await yt.refreshAccessToken();
    return auth.accessToken;
  };
  console.log('✓ access token refreshed');

  const t0 = Date.now();
  const sessionUrl = await startSession(auth.accessToken, meta);
  const buf = fs.readFileSync(meta.filePath);
  console.log(`→ uploading ${rel(meta.filePath)} (${fmtMB(buf.length)}) as ${requested} …`);
  const inserted = await sendBytes(sessionUrl, buf, meta.mime);
  console.log(`✓ upload finished in ${secs(t0)}s`);
  const id = inserted.id;
  if (!id) throw new Error('upload finished but YouTube returned no video id');

  // The upload is done and can't be repeated cheaply: a failed verification must not lose the record.
  let video = null;
  try {
    const q = new URLSearchParams({ part: 'status,processingDetails,snippet', id });
    const data = await yt.apiGet(`${VIDEOS_URL}?${q}`, await accessToken());
    video = (data.items && data.items[0]) || null;
  } catch (e) {
    console.error(`⚠ uploaded, but could not re-read the video to confirm its status: ${e.message}`);
  }
  const status = (video && video.status) || inserted.status || {};
  const actual = status.privacyStatus || 'unknown';

  const url = `https://youtu.be/${id}`;
  const studioUrl = `https://studio.youtube.com/video/${id}/edit`;
  console.log(`\n  Video id  : ${id}`);
  console.log(`  Watch     : ${url}`);
  console.log(`  Studio    : ${studioUrl}`);
  console.log(`  Privacy   : requested ${requested} | ACTUAL ${actual}`);
  if (video && video.processingDetails && video.processingDetails.processingStatus) {
    console.log(`  Processing: ${video.processingDetails.processingStatus}`);
  }
  console.log('  Status    :');
  console.log(JSON.stringify(status, null, 2).replace(/^/gm, '    '));
  if (requested !== actual) {
    console.log('\n⚠ YouTube overrode privacy — unaudited API project uploads are locked to private until the project passes the YouTube API Services compliance audit.');
  }

  const record = {
    uploaded_at: new Date().toISOString(),
    video_id: id,
    url,
    studio_url: studioUrl,
    requested_privacy: requested,
    status,
    snippet: { title: (video && video.snippet && video.snippet.title) || meta.snippet.title, categoryId: (video && video.snippet && video.snippet.categoryId) || meta.snippet.categoryId },
  };
  fs.writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n');
  console.log(`\n✓ recorded → ${rel(recordPath)}`);
})().catch(err => {
  console.error(`✗ ${yt.scrub(err.message)}`);
  process.exit(1);
});
