'use strict';
/**
 * pipeline/test/publish.test.js — core/publishNotes + the publish-youtube / publish-meta /
 * publish-discord plugins with a stubbed global fetch (no network, no real credentials).
 *   node pipeline/test/publish.test.js
 * Asserts: dry runs make no fetch call; youtube refuses a re-upload without --force; meta skips
 * Instagram without a public URL; discord transcodes a file over the limit (a tiny ffmpeg-made mp4
 * with a small fake limit) and posts multipart. Needs ffmpeg/ffprobe for the transcode case.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const notesLib = require(path.join(ROOT, 'core', 'publishNotes'));
const youtube = require(path.join(ROOT, 'plugins', 'publish-youtube', 'plugin.js'));
const meta = require(path.join(ROOT, 'plugins', 'publish-meta', 'plugin.js'));
const discord = require(path.join(ROOT, 'plugins', 'publish-discord', 'plugin.js'));

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${String(e.stack || e.message).split('\n').slice(0, 5).join('\n    ')}`); }
}

// ── fetch stub ────────────────────────────────────────────────────────────────
const realFetch = globalThis.fetch;
let calls = [];
let routes = [];
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), method: init.method || 'GET', headers: init.headers || {}, body: init.body });
  for (const [match, respond] of routes) if (match(String(url), init)) return respond(String(url), init);
  throw new Error(`unexpected fetch: ${init.method || 'GET'} ${url}`);
};
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const reset = (r = []) => { calls = []; routes = r; };

// ── fixtures ──────────────────────────────────────────────────────────────────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'reelsmith-publish-'));
let ffmpeg = null, ffprobe = null;
try { const env = require(path.join(ROOT, 'core', 'env')); ffmpeg = env.ffmpeg(); ffprobe = env.ffprobe(); } catch (_) { /* no core/env */ }
const quiet = () => {};

function makeMp4(file, seconds = 3, bitrate = '3M') {
  if (!ffmpeg) { fs.writeFileSync(file, Buffer.alloc(200000, 1)); return false; }
  const r = spawnSync(ffmpeg, ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=30', '-f', 'lavfi',
    '-i', 'sine=frequency=440:sample_rate=44100', '-t', String(seconds), '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', bitrate,
    '-c:a', 'aac', '-b:a', '128k', '-pix_fmt', 'yuv420p', file], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg fixture failed: ${r.stderr}`);
  return true;
}

const MP4 = path.join(TMP, 'clip.mp4');
const HAVE_FFMPEG = makeMp4(MP4);

function videoDir(name, { publish = true, extra = {} } = {}) {
  const dir = path.join(TMP, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(MP4, path.join(dir, 'output.mp4'));
  fs.writeFileSync(path.join(dir, 'script.md'), '---\ntitle: Script title fallback\ntopic: devtools\n---\n\n## Script\n\n### Scene 1\nHello.\n');
  if (publish) {
    fs.writeFileSync(path.join(dir, 'publish.md'), `---
publicUrl: ${extra.publicUrl || ''}
---
# Publish — ${name}

## Title
Reelsmith in 60 seconds

## Description
Script in, short out.
https://example.com/reelsmith

## Hashtags
#reelsmith #devtools #shorts

## Tags
reelsmith, claude code, video automation

## Pinned comment
Repo link in the description.
`);
  }
  return dir;
}

const CONFIG_DIR = path.join(TMP, 'config');
fs.mkdirSync(CONFIG_DIR, { recursive: true });
fs.writeFileSync(path.join(CONFIG_DIR, 'youtube-client.json'), JSON.stringify({ installed: { client_id: 'cid.apps.googleusercontent.com', client_secret: 'GOCSPX-testsecret123' } }));
fs.writeFileSync(path.join(CONFIG_DIR, 'yt-token.json'), JSON.stringify({ refresh_token: '1//testrefreshtoken-abcdefghijklmnop', obtained_at: new Date().toISOString() }));
const YT_ENV = { REELSMITH_CONFIG_DIR: CONFIG_DIR, PATH: process.env.PATH };
const META_ENV = { META_SYSTEM_TOKEN: 'EAAtesttoken1234567890abcdefghij', META_PAGE_ID: '1234567890', PATH: process.env.PATH };
const DISCORD_ENV = { DISCORD_BOT_TOKEN: 'test-bot-token-0123456789', DISCORD_CHANNEL_ID: '1539936894690009152', PATH: process.env.PATH };

(async () => {
  console.log('publish notes');

  await test('parse(): sections, frontmatter extras, tags, hashtags, caption dedupe', () => {
    const n = notesLib.parse('---\npublicUrl: https://x.test/v.mp4\nprivacy: unlisted\nmadeForKids: false\n---\n# Publish — x\n\n## Title\n`A title`\n\n## Description\nLine one.\n\n#a #b\n\n## Hashtags\n#a #b #c\n\n## Tags\n- one\n- two, three\n');
    assert.strictEqual(n.title, 'A title');
    assert.strictEqual(n.description, 'Line one.\n\n#a #b');
    assert.deepStrictEqual(n.tags, ['one', 'two', 'three']);
    assert.deepStrictEqual(n.hashtags, ['#a', '#b', '#c']);
    assert.deepStrictEqual(n.meta, { publicUrl: 'https://x.test/v.mp4', privacy: 'unlisted', madeForKids: false });
    assert.strictEqual(notesLib.caption(n), 'Line one.\n\n#a #b\n\n#c');
  });

  await test('parse(): the --notes skeleton parses as empty (placeholders dropped)', () => {
    const n = notesLib.parse(notesLib.skeleton('demo'));
    assert.strictEqual(n.title, '');
    assert.strictEqual(n.description, '');
    assert.deepStrictEqual(n.tags, []);
    assert.deepStrictEqual(n.hashtags, []);
  });

  await test('load(): no publish.md → script.md title fallback; readResult maps legacy youtube-upload.json', () => {
    const dir = videoDir('notes-fallback', { publish: false });
    const n = notesLib.load(dir);
    assert.strictEqual(n.exists, false);
    assert.strictEqual(n.title, 'Script title fallback');
    assert.strictEqual(n.titleSource, 'script.md');
    fs.writeFileSync(path.join(dir, 'youtube-upload.json'), JSON.stringify({ video_id: 'abc123', url: 'https://youtu.be/abc123' }));
    assert.strictEqual(notesLib.publishedId(dir, 'youtube'), 'abc123');
    notesLib.writeResult(dir, 'discord', { id: '42' });
    assert.strictEqual(notesLib.readResult(dir, 'discord').id, '42');
  });

  console.log('publish-youtube');

  await test('dry run: no fetch, full request built from publish.md, token redacted, private by default', async () => {
    reset();
    const dir = videoDir('yt-dry');
    const r = await youtube.publish({ video: dir, dryRun: true, env: YT_ENV, log: quiet });
    assert.strictEqual(calls.length, 0, 'dry run must not call fetch');
    assert.strictEqual(r.ok, true, JSON.stringify(r.problems));
    assert.strictEqual(r.request.body.snippet.title, 'Reelsmith in 60 seconds');
    assert.deepStrictEqual(r.request.body.snippet.tags, ['reelsmith', 'claude code', 'video automation']);
    assert.strictEqual(r.request.body.status.privacyStatus, 'private');
    assert.strictEqual(r.request.headers.Authorization, 'Bearer [redacted]');
    assert.ok(!JSON.stringify(r).includes('testrefreshtoken') && !JSON.stringify(r).includes('GOCSPX-'));
  });

  await test('dry run honours --privacy and the legacy youtube.json "file"; rejects a 101-char title', async () => {
    reset();
    const dir = videoDir('yt-legacy');
    fs.copyFileSync(MP4, path.join(dir, 'output-yt.mp4'));
    fs.writeFileSync(path.join(dir, 'youtube.json'), JSON.stringify({ title: 'legacy', file: 'output-yt.mp4', categoryId: '28' }));
    const r = await youtube.publish({ video: dir, dryRun: true, privacy: 'unlisted', env: YT_ENV, log: quiet });
    assert.strictEqual(r.request.file, path.join(dir, 'output-yt.mp4'));
    assert.strictEqual(r.request.body.status.privacyStatus, 'unlisted');
    assert.strictEqual(r.request.body.snippet.categoryId, '28');
    assert.strictEqual(r.request.body.snippet.title, 'Reelsmith in 60 seconds', 'publish.md beats youtube.json');
    const long = await youtube.publish({ video: dir, dryRun: true, env: YT_ENV, log: quiet, notes: { title: 'x'.repeat(101), description: '', tags: [], meta: {} } });
    assert.strictEqual(long.ok, false);
    assert.ok(long.problems.some((p) => /101 characters, max 100/.test(p)));
    assert.strictEqual(calls.length, 0);
  });

  await test('refuses a re-upload when publish/youtube.json (or legacy youtube-upload.json) has an id, unless --force', async () => {
    reset();
    const dir = videoDir('yt-refuse');
    notesLib.writeResult(dir, 'youtube', { id: 'prev123', url: 'https://youtu.be/prev123' });
    const r = await youtube.publish({ video: dir, env: YT_ENV, log: quiet });
    assert.strictEqual(r.ok, false);
    assert.ok(/already uploaded/.test(r.refused));
    assert.strictEqual(calls.length, 0, 'refusal happens before any network call');
    const dry = await youtube.publish({ video: dir, dryRun: true, env: YT_ENV, log: quiet });
    assert.ok(dry.refused && dry.ok === false, 'the dry run reports the refusal too');
    const forced = await youtube.publish({ video: dir, dryRun: true, force: true, env: YT_ENV, log: quiet });
    assert.strictEqual(forced.ok, true);
    const legacyDir = videoDir('yt-refuse-legacy');
    fs.writeFileSync(path.join(legacyDir, 'youtube-upload.json'), JSON.stringify({ video_id: 'old1', url: 'https://youtu.be/old1' }));
    const r2 = await youtube.publish({ video: legacyDir, env: YT_ENV, log: quiet });
    assert.ok(/already uploaded/.test(r2.refused));
    assert.strictEqual(calls.length, 0);
  });

  await test('upload (stubbed): refresh → resumable session → PUT → verify → publish/youtube.json', async () => {
    const dir = videoDir('yt-upload');
    reset([
      [(u) => u.startsWith('https://oauth2.googleapis.com/token'), () => json({ access_token: 'ya29.testaccess', expires_in: 3600 })],
      [(u, i) => u.startsWith('https://www.googleapis.com/upload/youtube/v3/videos') && i.method === 'POST',
        () => new Response('', { status: 200, headers: { location: 'https://upload.test/session?upload_id=s3cret-session' } })],
      [(u, i) => u.startsWith('https://upload.test/session') && i.method === 'PUT', () => json({ id: 'vid123', status: { privacyStatus: 'private' } })],
      [(u) => u.startsWith('https://www.googleapis.com/youtube/v3/videos?'), () => json({ items: [{ status: { privacyStatus: 'private', uploadStatus: 'uploaded' }, snippet: { title: 'Reelsmith in 60 seconds', categoryId: '22' } }] })],
    ]);
    const r = await youtube.publish({ video: dir, env: YT_ENV, log: quiet });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.id, 'vid123');
    const insert = calls.find((c) => c.url.includes('/upload/youtube/v3/videos'));
    assert.strictEqual(insert.headers.Authorization, 'Bearer ya29.testaccess');
    assert.strictEqual(JSON.parse(insert.body).snippet.title, 'Reelsmith in 60 seconds');
    const rec = JSON.parse(fs.readFileSync(path.join(dir, 'publish', 'youtube.json'), 'utf8'));
    assert.strictEqual(rec.id, 'vid123');
    assert.strictEqual(rec.privacy, 'private');
    assert.ok(!JSON.stringify(rec).includes('s3cret-session'));
  });

  await test('check(): ok with client + token; not ok (optional) when the config dir is empty', async () => {
    assert.strictEqual((await youtube.check({ env: YT_ENV })).ok, true);
    const empty = path.join(TMP, 'empty-config');
    fs.mkdirSync(empty, { recursive: true });
    const c = await youtube.check({ env: { REELSMITH_CONFIG_DIR: empty } });
    assert.strictEqual(c.ok, false);
    assert.strictEqual(c.optional, true);
    assert.ok(/OAuth client file not found/.test(c.message));
  });

  console.log('publish-meta');

  await test('dry run: no fetch, FB multipart request, IG skipped without publicUrl', async () => {
    reset();
    const dir = videoDir('meta-dry');
    const r = await meta.publish({ video: dir, dryRun: true, env: META_ENV, log: quiet });
    assert.strictEqual(calls.length, 0);
    assert.strictEqual(r.ok, true, JSON.stringify(r.problems));
    assert.deepStrictEqual(r.ig, { skipped: 'needs publicUrl' });
    assert.ok(r.requests.fb.multipart && /^@/.test(r.requests.fb.multipart.source));
    assert.ok(/#shorts/.test(r.requests.fb.multipart.description), 'caption carries the hashtags');
    assert.ok(!r.requests.igContainer);
    assert.ok(!JSON.stringify(r).includes(META_ENV.META_SYSTEM_TOKEN));
  });

  await test('dry run with a public URL (publish.md frontmatter): FB file_url + IG container/publish planned', async () => {
    reset();
    const dir = videoDir('meta-url', { extra: { publicUrl: 'https://cdn.test/output.mp4' } });
    const r = await meta.publish({ video: dir, dryRun: true, env: META_ENV, log: quiet });
    assert.strictEqual(calls.length, 0);
    assert.strictEqual(r.requests.fb.form.file_url, 'https://cdn.test/output.mp4');
    assert.strictEqual(r.requests.igContainer.form.media_type, 'REELS');
    assert.strictEqual(r.requests.igContainer.form.video_url, 'https://cdn.test/output.mp4');
    assert.ok(r.requests.igPublish);
  });

  await test('post (stubbed): FB multipart upload, IG skipped, result written; a re-run refuses FB', async () => {
    const dir = videoDir('meta-post');
    reset([
      [(u) => u.includes('/1234567890?fields=access_token'), () => json({ access_token: 'EAApagetoken1234567890abcdefgh', id: '1234567890' })],
      [(u, i) => u.includes('graph-video.facebook.com/v21.0/1234567890/videos') && i.method === 'POST', () => json({ id: 'fbvid1' })],
      [(u) => u.includes('/fbvid1?fields=status,permalink_url'), () => json({ status: { video_status: 'ready' }, permalink_url: '/reel/fbvid1/' })],
    ]);
    const r = await meta.publish({ video: dir, env: META_ENV, log: quiet });
    assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
    assert.strictEqual(r.fb.id, 'fbvid1');
    assert.strictEqual(r.fb.permalink, 'https://www.facebook.com/reel/fbvid1/');
    assert.deepStrictEqual(r.ig, { skipped: 'needs publicUrl' });
    const up = calls.find((c) => c.url.includes('/videos'));
    assert.ok(up.body instanceof FormData && up.body.get('source') instanceof Blob);
    assert.strictEqual(up.headers.Authorization, 'Bearer EAApagetoken1234567890abcdefgh', 'posts with the page token');
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'publish', 'meta.json'), 'utf8')).fb.id, 'fbvid1');
    reset();
    const again = await meta.publish({ video: dir, env: META_ENV, log: quiet });
    assert.strictEqual(again.ok, false);
    assert.ok(/Facebook already posted/.test(again.refused));
    assert.strictEqual(calls.length, 0);
  });

  console.log('publish-discord');

  await test('dry run: no fetch, message from publish.md title + first description line, no transcode under the limit', async () => {
    reset();
    const dir = videoDir('discord-dry');
    const r = await discord.publish({ video: dir, dryRun: true, env: DISCORD_ENV, log: quiet });
    assert.strictEqual(calls.length, 0);
    assert.strictEqual(r.ok, true, JSON.stringify(r.problems));
    assert.strictEqual(r.message, '**Reelsmith in 60 seconds**\nScript in, short out.');
    assert.strictEqual(r.transcoded, false);
    assert.strictEqual(r.channelId, DISCORD_ENV.DISCORD_CHANNEL_ID);
    const renamed = await discord.publish({ video: dir, dryRun: true, log: quiet, env: { DISCORD_BOT_TOKEN: 'x'.repeat(30), TEAM_CHANNEL: '1111111111111111111' },
      config: { publish: { targets: { discord: { channelIdEnv: 'TEAM_CHANNEL' } } } } });
    assert.strictEqual(renamed.channelId, '1111111111111111111', 'channelIdEnv renames the env var');
    const flag = await discord.publish({ video: dir, dryRun: true, channel: '2222222222222222222', env: DISCORD_ENV, log: quiet });
    assert.strictEqual(flag.channelId, '2222222222222222222', '--channel wins');
    const fallback = await discord.publish({ video: videoDir('discord-fallback', { publish: false }), dryRun: true, env: DISCORD_ENV, log: quiet });
    assert.strictEqual(fallback.message, '**Script title fallback**');
  });

  await test('over the limit: transcodes output-discord.mp4 (two-pass, 720×1280) under the limit, still no fetch', async () => {
    if (!HAVE_FFMPEG || !ffprobe) { console.log('    (skipped: ffmpeg/ffprobe not found)'); return; }
    reset();
    const dir = videoDir('discord-big');
    const src = fs.statSync(path.join(dir, 'output.mp4')).size;
    const limit = Math.floor(src / 3); // a fake, small upload limit
    const r = await discord.publish({ video: dir, dryRun: true, env: DISCORD_ENV, limitBytes: limit, log: quiet });
    assert.strictEqual(calls.length, 0);
    assert.strictEqual(r.transcoded, true);
    assert.strictEqual(path.basename(r.file), 'output-discord.mp4');
    assert.ok(r.bytes <= limit, `${r.bytes} > ${limit}`);
    const dims = spawnSync(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', r.file], { encoding: 'utf8' }).stdout.trim();
    assert.ok(dims === '720,1280' || dims === '540,960', dims);
    const again = await discord.publish({ video: dir, dryRun: true, env: DISCORD_ENV, limitBytes: limit, log: quiet });
    assert.strictEqual(again.transcoded, true);
    assert.strictEqual(again.bytes, r.bytes, 'a fresh transcode is reused');
  });

  await test('post (stubbed): multipart payload_json + files[0], result written; a re-run refuses', async () => {
    const dir = videoDir('discord-post');
    reset([
      [(u, i) => /\/channels\/\d+$/.test(u) && (i.method || 'GET') === 'GET', () => json({ id: DISCORD_ENV.DISCORD_CHANNEL_ID, guild_id: '999', name: 'review' })],
      [(u, i) => /\/channels\/\d+\/messages$/.test(u) && i.method === 'POST', () => json({ id: 'msg1', channel_id: DISCORD_ENV.DISCORD_CHANNEL_ID })],
    ]);
    const r = await discord.publish({ video: dir, env: DISCORD_ENV, log: quiet });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.url, `https://discord.com/channels/999/${DISCORD_ENV.DISCORD_CHANNEL_ID}/msg1`);
    const post = calls.find((c) => c.method === 'POST');
    assert.strictEqual(post.headers.Authorization, `Bot ${DISCORD_ENV.DISCORD_BOT_TOKEN}`);
    assert.ok(post.body instanceof FormData);
    assert.strictEqual(JSON.parse(post.body.get('payload_json')).content, '**Reelsmith in 60 seconds**\nScript in, short out.');
    assert.ok(post.body.get('files[0]') instanceof Blob);
    const rec = JSON.parse(fs.readFileSync(path.join(dir, 'publish', 'discord.json'), 'utf8'));
    assert.strictEqual(rec.messageId, 'msg1');
    assert.strictEqual(rec.channelId, DISCORD_ENV.DISCORD_CHANNEL_ID);
    reset();
    const again = await discord.publish({ video: dir, env: DISCORD_ENV, log: quiet });
    assert.strictEqual(again.ok, false);
    assert.ok(/already posted/.test(again.refused));
    assert.strictEqual(calls.length, 0);
  });

  await test('check(): meta + discord report missing env as optional failures', async () => {
    const m = await meta.check({ env: {} });
    const d = await discord.check({ env: {} });
    assert.ok(!m.ok && m.optional && /META_SYSTEM_TOKEN/.test(m.message));
    assert.ok(!d.ok && d.optional && /DISCORD_BOT_TOKEN/.test(d.message));
    assert.ok((await meta.check({ env: META_ENV })).ok);
    assert.ok((await discord.check({ env: DISCORD_ENV })).ok);
  });

  globalThis.fetch = realFetch;
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
