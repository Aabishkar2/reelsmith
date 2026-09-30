'use strict';
/**
 * plugins/publish-youtube/lib/upload.js — YouTube Data API v3 resumable upload (videos.insert).
 * Ported from the pre-framework scripts/upload-youtube.js. Global fetch only.
 *
 *   startSession(accessToken, { snippet, status, size, mime }) → session URL (registered as a secret)
 *   sendBytes(sessionUrl, buffer, mime, log) → the inserted video resource
 *       PUTs the bytes; on 5xx / network errors / 308 asks the session for its offset and resumes
 *       from there, up to MAX_RETRIES times.
 */
const yt = require('./oauth');

const INSERT_URL = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
const VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos';
const MAX_RETRIES = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmtMB = (bytes) => (bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`);

/** fetch that turns network failures into { status: 0 } so the resume loop can retry them. */
async function tryFetch(url, opts) {
  try {
    const res = await globalThis.fetch(url, { redirect: 'manual', ...opts }); // 308 = "resume incomplete"
    return { status: res.status, res };
  } catch (e) {
    return { status: 0, note: yt.netMessage('YouTube upload', e) };
  }
}

async function failFrom(res) {
  return yt.apiErrorFrom(res.status, await res.text().catch(() => ''), res.statusText);
}

/** How many bytes does the session have? → { status, offset?, res? } */
async function queryProgress(sessionUrl, size) {
  const r = await tryFetch(sessionUrl, { method: 'PUT', headers: { 'Content-Length': '0', 'Content-Range': `bytes */${size}` } });
  if (r.status === 308) {
    const m = /bytes=\d+-(\d+)/.exec(r.res.headers.get('range') || '');
    r.offset = m ? Number(m[1]) + 1 : 0; // no Range header = nothing received yet
  }
  return r;
}

function insertRequest(accessToken, meta) {
  return {
    method: 'POST',
    url: INSERT_URL,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(meta.size),
      'X-Upload-Content-Type': meta.mime,
    },
    body: { snippet: meta.snippet, status: meta.status },
  };
}

async function startSession(accessToken, meta) {
  const req = insertRequest(accessToken, meta);
  let res;
  try {
    res = await globalThis.fetch(req.url, { method: req.method, headers: req.headers, body: JSON.stringify(req.body) });
  } catch (e) {
    throw new Error(yt.netMessage('YouTube upload', e));
  }
  if (!res.ok) throw await failFrom(res);
  const location = res.headers.get('location');
  if (!location) throw new Error('YouTube did not return an upload session URL (no Location header)');
  yt.addSecret(location); // the session URL is a capability: never print it
  return location;
}

async function sendBytes(sessionUrl, buf, mime, log = () => {}) {
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
    log(`  … ${why}; checking upload status and resuming (retry ${retries}/${MAX_RETRIES})`);
    await sleep(retries * 2000);

    const q = await queryProgress(sessionUrl, size);
    if (q.status >= 400 && q.status < 500) throw await failFrom(q.res);
    if (done(q)) { r = q; break; }
    if (q.status === 308) offset = q.offset;
    else { r = q; continue; } // the status query itself failed (5xx / network): burn a retry, ask again
    log(`  … server has ${fmtMB(offset)} of ${fmtMB(size)}; resuming from there`);
    r = await put(offset);
  }
  return r.res.json();
}

module.exports = { INSERT_URL, VIDEOS_URL, MAX_RETRIES, insertRequest, startSession, sendBytes, queryProgress, fmtMB };
