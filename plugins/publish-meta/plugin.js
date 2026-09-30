'use strict';
/**
 * plugins/publish-meta — post a finished video as a Facebook Page video (9:16 is auto-classified as
 * a Reel) and an Instagram Reel, through the Graph API. docs/framework-spec.md §5.5.
 * Node port of the one-off post-reels.py; global fetch + FormData only.
 *
 *   publish({ video, dryRun, force, file, publicUrl, only, notes, root, config, env, log })
 *       → { ok, dryRun, target: 'meta', id?, url?, fb, ig, requests, problems? }
 *     publicUrl  https URL where Meta can download the mp4 (--public-url=, or `publicUrl:` in the
 *                publish.md frontmatter). Instagram requires it; without it IG is
 *                { skipped: 'needs publicUrl' }. Facebook uses it as file_url, else uploads the
 *                file itself (multipart `source`).
 *     only       'fb' | 'ig' to post to one network.
 *   Env: META_SYSTEM_TOKEN (a system-user token with pages_manage_posts, pages_read_engagement,
 *   instagram_basic, instagram_content_publish), META_PAGE_ID, META_IG_USER_ID (optional: resolved
 *   from /{page}?fields=instagram_business_account). The page token comes from
 *   /{page}?fields=access_token (falls back to the system token when the field is absent).
 *   Caption = publish.md description + its hashtags; FB title = frontmatter fbTitle or the title.
 *   Result → videos/<n>/publish/meta.json { id, fb: { id, permalink }, ig: { id, permalink } | { skipped } }.
 *   A network that already has an id there is refused (skipped) unless force. dryRun prints every
 *   request (tokens redacted) and never touches the network.
 */
const fs = require('fs');
const path = require('path');
const notesLib = require('../../core/publishNotes');

const TARGET = 'meta';
const DEFAULT_VERSION = 'v21.0';
const IG_CAPTION_MAX = 2200;
const IG_HASHTAGS_MAX = 30;
const FB_MAX_BYTES = 1024 * 1024 * 1024; // non-resumable /videos upload limit
const POLL_EVERY_MS = 5000;

const logger = (log) => (typeof log === 'function' ? log : log && typeof log.info === 'function' ? (...a) => log.info(...a) : console.log);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmtMB = (b) => `${(b / 1048576).toFixed(1)} MB`;

function videoDirOf(video, root) {
  const v = typeof video === 'string' ? video : video && (video.dir || video.path || video.name);
  if (!v) throw new Error('publish: `video` (a folder or { dir }) is required');
  return path.resolve(root || process.cwd(), v);
}

// ── secrets ─────────────────────────────────────────────────────────────────
const secrets = new Set();
const addSecret = (v) => { if (v && String(v).length >= 8) secrets.add(String(v)); };
function scrub(text) {
  let out = String(text);
  for (const s of secrets) out = out.split(s).join('[redacted]');
  return out.replace(/\bEA[A-Za-z0-9]{20,}/g, '[redacted]');
}

class GraphError extends Error {
  constructor(message, status, code) {
    super(scrub(message));
    this.name = 'GraphError';
    this.status = status;
    this.code = code;
  }
}

/** One Graph API call. body: URLSearchParams | FormData | undefined. Returns parsed JSON. */
async function graph(method, url, token, body) {
  let res;
  try {
    res = await globalThis.fetch(url, { method, headers: { Authorization: `Bearer ${token}` }, body });
  } catch (e) {
    const cause = e && e.cause && e.cause.code ? ` (${e.cause.code})` : '';
    throw new GraphError(`network error contacting the Graph API: ${(e && e.message) || e}${cause}`, 0);
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* not JSON */ }
  if (!res.ok || (json && json.error)) {
    const e = (json && json.error) || {};
    const msg = typeof e.message === 'string' ? e.message : res.statusText || 'request failed';
    throw new GraphError(`Graph API HTTP ${res.status}: ${msg}${e.code ? ` [code ${e.code}${e.error_subcode ? `/${e.error_subcode}` : ''}]` : ''}`, res.status, e.code);
  }
  if (!json) throw new GraphError(`Graph API returned a non-JSON response (HTTP ${res.status})`, res.status);
  return json;
}

async function poll(fn, done, failed, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const body = await fn();
    if (done(body)) return body;
    if (failed(body)) throw new GraphError(`${label} failed: ${JSON.stringify(body).slice(0, 300)}`);
    if (Date.now() > deadline) return null; // timed out: the caller records what it has
    await sleep(POLL_EVERY_MS);
  }
}

// ── plan (no network) ───────────────────────────────────────────────────────
function plan({ dir, notes, env, file, publicUrl, only, config }) {
  const tc = (config && config.publish && config.publish.targets && config.publish.targets.meta) || {};
  const version = String(tc.graphVersion || env.META_GRAPH_VERSION || DEFAULT_VERSION);
  const GRAPH = `https://graph.facebook.com/${version}`;
  const GRAPH_VIDEO = `https://graph-video.facebook.com/${version}`;
  const problems = [];
  const info = [];
  const token = env.META_SYSTEM_TOKEN || '';
  const page = env.META_PAGE_ID || '';
  const igEnv = env.META_IG_USER_ID || '';
  if (!token) problems.push('META_SYSTEM_TOKEN is not set (.env)');
  if (!page) problems.push('META_PAGE_ID is not set (.env)');
  addSecret(token);

  const fm = notes.meta || {};
  const url = publicUrl || fm.publicUrl || fm.public_url || '';
  if (url && !/^https:\/\/\S+$/i.test(url)) problems.push(`publicUrl must be an https URL Meta can download (got "${url}")`);

  const filePath = path.resolve(dir, file || fm.file || 'output.mp4');
  let size = 0;
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) problems.push(`video file not found: ${filePath}`);
  else {
    size = fs.statSync(filePath).size;
    if (!size) problems.push(`video file is empty: ${filePath}`);
    if (size > FB_MAX_BYTES && !url) problems.push(`${fmtMB(size)} is over the 1 GB direct-upload limit — pass --public-url`);
  }

  const title = String(fm.fbTitle || fm.facebookTitle || notes.title || '').trim();
  if (!title) problems.push('no title: write ## Title in publish.md');
  if (notes.titleSource === 'script.md') info.push('title from script.md — write publish.md (reelsmith publish <video> --notes)');
  const caption = notesLib.caption(notes);
  if (!caption) info.push('caption is empty — write ## Description (and ## Hashtags) in publish.md');

  const wantFb = only !== 'ig';
  const wantIg = only !== 'fb';
  let igSkip = null;
  if (wantIg && !url) igSkip = 'needs publicUrl';
  if (wantIg && !igSkip) {
    if ([...caption].length > IG_CAPTION_MAX) problems.push(`caption is ${[...caption].length} characters, Instagram allows ${IG_CAPTION_MAX}`);
    const tags = notesLib.hashtagsFrom(caption).length;
    if (tags > IG_HASHTAGS_MAX) problems.push(`caption has ${tags} hashtags, Instagram allows ${IG_HASHTAGS_MAX}`);
  }

  const R = '[redacted]';
  const requests = {
    resolve: { method: 'GET', url: `${GRAPH}/${page || '{META_PAGE_ID}'}?fields=access_token,instagram_business_account`, auth: `Bearer ${R} (META_SYSTEM_TOKEN)` },
  };
  if (wantFb) {
    const fields = { title, description: caption, published: 'true' };
    requests.fb = url
      ? { method: 'POST', url: `${GRAPH_VIDEO}/${page || '{META_PAGE_ID}'}/videos`, auth: `Bearer ${R} (page token)`, form: { file_url: url, ...fields } }
      : { method: 'POST', url: `${GRAPH_VIDEO}/${page || '{META_PAGE_ID}'}/videos`, auth: `Bearer ${R} (page token)`,
        multipart: { ...fields, source: `@${filePath} (${size} bytes, video/mp4)` } };
    requests.fbStatus = { method: 'GET', url: `${GRAPH}/{video_id}?fields=status,permalink_url`, until: 'status.video_status == "ready"' };
  }
  if (wantIg && !igSkip) {
    const ig = igEnv || '{instagram_business_account.id}';
    requests.igContainer = { method: 'POST', url: `${GRAPH}/${ig}/media`, auth: `Bearer ${R} (page token)`,
      form: { media_type: 'REELS', video_url: url, caption, share_to_feed: 'true' } };
    requests.igStatus = { method: 'GET', url: `${GRAPH}/{container_id}?fields=status_code,status`, until: 'status_code == "FINISHED"' };
    requests.igPublish = { method: 'POST', url: `${GRAPH}/${ig}/media_publish`, auth: `Bearer ${R} (page token)`, form: { creation_id: '{container_id}' } };
  }
  return { GRAPH, GRAPH_VIDEO, version, token, page, igEnv, url, filePath, size, title, caption, wantFb, wantIg, igSkip, problems, info, requests };
}

module.exports = {
  name: 'publish-meta',
  kind: 'publish',
  version: '1.0.0',
  description: 'Facebook Page video (Reel) + Instagram Reel via the Graph API',
  configSchema: {
    META_SYSTEM_TOKEN: { type: 'string', required: true, env: 'META_SYSTEM_TOKEN', secret: true,
      description: 'System-user access token with pages_manage_posts, pages_read_engagement, instagram_basic, instagram_content_publish.' },
    META_PAGE_ID: { type: 'string', required: true, env: 'META_PAGE_ID', description: 'Facebook Page id to post to.' },
    META_IG_USER_ID: { type: 'string', required: false, env: 'META_IG_USER_ID',
      description: 'Instagram business account id; resolved from the page when unset.' },
    graphVersion: { type: 'string', required: false, env: 'META_GRAPH_VERSION', default: DEFAULT_VERSION,
      description: 'Graph API version (publish.targets.meta.graphVersion).' },
  },

  async check(ctx = {}) {
    const env = ctx.env || process.env;
    const missing = ['META_SYSTEM_TOKEN', 'META_PAGE_ID'].filter((k) => !env[k]);
    if (missing.length) return { ok: false, optional: true, message: `${missing.join(', ')} not set (.env)` };
    return { ok: true, optional: true,
      message: `token + page set${env.META_IG_USER_ID ? ' + IG user' : ' (IG user resolved from the page)'}; Instagram also needs --public-url` };
  },

  async publish(args = {}) {
    const { video, dryRun = false, force = false, file, publicUrl, only, root, config, env = process.env } = args;
    const say = logger(args.log);
    const dir = videoDirOf(video, root);
    const notes = args.notes && typeof args.notes === 'object' ? { titleSource: 'publish.md', ...args.notes } : notesLib.load(dir);
    const p = plan({ dir, notes, env, file, publicUrl, only, config });
    const prev = notesLib.readResult(dir, TARGET) || {};
    const doneFb = prev.fb && prev.fb.id && !force ? prev.fb : null;
    const doneIg = prev.ig && prev.ig.id && !force ? prev.ig : null;
    const base = { target: TARGET, dryRun, requests: p.requests };

    if (dryRun) {
      say('DRY RUN — nothing was sent to Meta.\n');
      say(`  Video    : ${p.filePath} (${fmtMB(p.size)}, ${p.size} bytes)`);
      say(`  FB title : ${p.title}`);
      say(`  Caption  : ${[...p.caption].length} chars, ${notesLib.hashtagsFrom(p.caption).length} hashtags`);
      say(`  Facebook : ${!p.wantFb ? 'not requested' : doneFb ? `refused: already posted (${doneFb.permalink || doneFb.id}); --force to post again` : p.url ? 'file_url upload' : 'multipart upload of the file'}`);
      say(`  Instagram: ${!p.wantIg ? 'not requested' : p.igSkip ? `skipped: ${p.igSkip} (pass --public-url=https://…/output.mp4 or publicUrl: in publish.md)` : doneIg ? `refused: already posted (${doneIg.permalink || doneIg.id})` : 'Reel container → poll → media_publish'}`);
      for (const n of p.info) say(`  Note     : ${n}`);
      say('\n  requests:');
      say(JSON.stringify(p.requests, null, 2).replace(/^/gm, '  '));
      if (p.problems.length) { say('\n✗ would fail:'); for (const x of p.problems) say(`  - ${x}`); }
      return {
        ...base, ok: p.problems.length === 0, problems: p.problems,
        fb: !p.wantFb ? { skipped: 'not requested' } : doneFb ? { refused: 'already posted', id: doneFb.id } : { planned: true },
        ig: !p.wantIg ? { skipped: 'not requested' } : p.igSkip ? { skipped: p.igSkip } : doneIg ? { refused: 'already posted', id: doneIg.id } : { planned: true },
      };
    }

    if (p.problems.length) throw new Error(`Meta publish has ${p.problems.length} problem(s):\n  - ${p.problems.join('\n  - ')}`);
    const needFb = p.wantFb && !doneFb;
    const needIg = p.wantIg && !p.igSkip && !doneIg;
    if (!needFb && !needIg) {
      const reasons = [];
      if (p.wantFb && doneFb) reasons.push('Facebook already posted');
      if (p.wantIg && doneIg) reasons.push('Instagram already posted');
      if (p.wantIg && p.igSkip && !doneIg) reasons.push(`Instagram ${p.igSkip}`);
      const why = `${reasons.join('; ')}${doneFb || doneIg ? ' — re-run with --force to post again' : ''}`;
      return { ...base, ok: false, refused: why, id: prev.id, fb: doneFb || { skipped: 'not requested' }, ig: doneIg || { skipped: p.igSkip || 'not requested' } };
    }
    for (const n of p.info) say(`  Note: ${n}`);

    const result = { target: TARGET, ...prev, at: new Date().toISOString(), title: p.title, caption: p.caption, file: path.relative(dir, p.filePath), bytes: p.size };
    const errors = [];
    try {
      // Page token + IG account.
      const info = await graph('GET', `${p.GRAPH}/${p.page}?fields=access_token,instagram_business_account`, p.token);
      const pageToken = info.access_token || p.token;
      addSecret(pageToken);
      const ig = p.igEnv || (info.instagram_business_account && info.instagram_business_account.id) || '';

      if (needFb) {
        say(`→ Facebook: ${p.url ? 'file_url' : `uploading ${fmtMB(p.size)}`} …`);
        let body;
        if (p.url) {
          body = new URLSearchParams({ file_url: p.url, title: p.title, description: p.caption, published: 'true' });
        } else {
          body = new FormData();
          body.append('title', p.title);
          body.append('description', p.caption);
          body.append('published', 'true');
          body.append('source', new Blob([fs.readFileSync(p.filePath)], { type: 'video/mp4' }), path.basename(p.filePath));
        }
        try {
          const up = await graph('POST', `${p.GRAPH_VIDEO}/${p.page}/videos`, pageToken, body);
          const vid = up.id;
          const st = await poll(() => graph('GET', `${p.GRAPH}/${vid}?fields=status,permalink_url`, pageToken),
            (b) => (b.status || {}).video_status === 'ready', (b) => (b.status || {}).video_status === 'error', 600000, 'Facebook processing');
          const link = st && st.permalink_url ? (st.permalink_url.startsWith('/') ? `https://www.facebook.com${st.permalink_url}` : st.permalink_url) : null;
          result.fb = { id: vid, permalink: link, status: st ? 'ready' : 'processing' };
          say(`✓ Facebook: ${link || vid}${st ? '' : ' (still processing)'}`);
        } catch (e) {
          errors.push(`facebook: ${e.message}`);
          result.fb = { error: scrub(e.message) };
        }
      }

      if (needIg) {
        if (!ig) {
          errors.push('instagram: no Instagram business account on the page (set META_IG_USER_ID)');
          result.ig = { error: 'no Instagram business account' };
        } else {
          say('→ Instagram: Reel container …');
          try {
            const c = await graph('POST', `${p.GRAPH}/${ig}/media`, pageToken,
              new URLSearchParams({ media_type: 'REELS', video_url: p.url, caption: p.caption, share_to_feed: 'true' }));
            const ready = await poll(() => graph('GET', `${p.GRAPH}/${c.id}?fields=status_code,status`, pageToken),
              (b) => b.status_code === 'FINISHED', (b) => ['ERROR', 'EXPIRED'].includes(b.status_code), 900000, 'Instagram processing');
            if (!ready) throw new GraphError('Instagram container still processing after 15 minutes');
            const pub = await graph('POST', `${p.GRAPH}/${ig}/media_publish`, pageToken, new URLSearchParams({ creation_id: c.id }));
            let link = null;
            try { link = (await graph('GET', `${p.GRAPH}/${pub.id}?fields=permalink`, pageToken)).permalink || null; } catch (_) { /* optional */ }
            result.ig = { id: pub.id, permalink: link };
            say(`✓ Instagram: ${link || pub.id}`);
          } catch (e) {
            errors.push(`instagram: ${e.message}`);
            result.ig = { error: scrub(e.message) };
          }
        }
      } else if (p.wantIg && p.igSkip && !(prev.ig && prev.ig.id)) {
        result.ig = { skipped: p.igSkip };
      }
    } catch (e) {
      throw new Error(scrub(e.message));
    }

    result.id = (result.fb && result.fb.id) || (result.ig && result.ig.id) || prev.id || null;
    result.url = (result.fb && result.fb.permalink) || (result.ig && result.ig.permalink) || null;
    if (result.id) notesLib.writeResult(dir, TARGET, result);
    return { ...base, ok: errors.length === 0, id: result.id, url: result.url, fb: result.fb, ig: result.ig,
      ...(errors.length ? { errors: errors.map(scrub) } : {}), sent: { title: p.title, caption: p.caption, bytes: p.size } };
  },

  _plan: plan,
};
