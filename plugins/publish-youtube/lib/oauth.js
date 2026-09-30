'use strict';
/**
 * plugins/publish-youtube/lib/oauth.js — OAuth + YouTube Data API helpers (Node built-ins and
 * global fetch only). Ported from the pre-framework scripts/lib/youtube-oauth.js.
 *
 * Files (outside any repo, never committed), resolved per call from `env`:
 *   dir     $REELSMITH_CONFIG_DIR, default ~/.config/reelsmith
 *   client  $YOUTUBE_CLIENT_FILE, default <dir>/youtube-client.json
 *           (a Google "Desktop app" OAuth client JSON: { installed: { client_id, client_secret } })
 *   token   <dir>/yt-token.json (0600): { refresh_token, scope, obtained_at, channel }
 * Migration: when REELSMITH_CONFIG_DIR is not set and a file is missing from ~/.config/reelsmith
 * but exists in the old ~/.config/video-gen-v2, the old file is read (and `legacy` says so);
 * new tokens are always saved to the new dir.
 *
 * SECURITY: nothing here prints the client secret, access/refresh tokens, auth codes or the
 * resumable-upload session URL. Every message that can carry a server response goes through
 * scrub(); Google token-endpoint errors are reduced to their error / error_description fields.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URI = 'https://oauth2.googleapis.com/token';
const CHANNELS_URL = 'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true';
const SCOPES = 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly';
const AUTH_COMMAND = 'reelsmith publish --to=youtube --auth';
const REAUTH_MESSAGE = `refresh token expired or revoked — run: ${AUTH_COMMAND}`;

const expandHome = (p) => (p === '~' || String(p).startsWith('~/') ? path.join(os.homedir(), String(p).slice(1)) : p);
const exists = (f) => { try { return fs.statSync(f).isFile(); } catch (_) { return false; } };

/** → { dir, clientFile, tokenFile, saveTokenFile, legacyDir, legacy: { client, token } } */
function locate(env = process.env) {
  const explicitDir = env.REELSMITH_CONFIG_DIR ? path.resolve(expandHome(env.REELSMITH_CONFIG_DIR)) : null;
  const dir = explicitDir || path.join(os.homedir(), '.config', 'reelsmith');
  const legacyDir = path.join(os.homedir(), '.config', 'video-gen-v2');
  const useLegacy = (name) => !explicitDir && !exists(path.join(dir, name)) && exists(path.join(legacyDir, name));
  const legacy = { client: false, token: false };
  let clientFile;
  if (env.YOUTUBE_CLIENT_FILE) clientFile = path.resolve(expandHome(env.YOUTUBE_CLIENT_FILE));
  else if (useLegacy('youtube-client.json')) { clientFile = path.join(legacyDir, 'youtube-client.json'); legacy.client = true; }
  else clientFile = path.join(dir, 'youtube-client.json');
  const saveTokenFile = path.join(dir, 'yt-token.json');
  let tokenFile = saveTokenFile;
  if (useLegacy('yt-token.json')) { tokenFile = path.join(legacyDir, 'yt-token.json'); legacy.token = true; }
  return { dir, clientFile, tokenFile, saveTokenFile, legacyDir, legacy };
}

function migrationNote(loc) {
  const files = [loc.legacy.client && 'youtube-client.json', loc.legacy.token && 'yt-token.json'].filter(Boolean);
  if (!files.length) return null;
  return `using ${files.join(' + ')} from the old ${loc.legacyDir}; move ${files.length > 1 ? 'them' : 'it'}: ` +
    `mkdir -p ${loc.dir} && mv ${files.map((f) => path.join(loc.legacyDir, f)).join(' ')} ${loc.dir}/`;
}

// ── Redaction ────────────────────────────────────────────────────────────────

const secrets = new Set();

/** Register a value that must never appear in output (also caught by the patterns below). */
function addSecret(value) {
  if (value && String(value).length >= 6) secrets.add(String(value));
}

function scrub(text) {
  let out = String(text);
  for (const s of secrets) out = out.split(s).join('[redacted]');
  return out
    .replace(/ya29\.[\w.-]+/g, '[redacted]') // access tokens
    .replace(/\b1\/\/[\w-]{20,}/g, '[redacted]') // refresh tokens
    .replace(/\b4\/[\w-]{20,}/g, '[redacted]') // auth codes
    .replace(/GOCSPX-[\w-]+/g, '[redacted]'); // client secrets
}

// ── Errors ───────────────────────────────────────────────────────────────────

class OAuthError extends Error {
  constructor(message, code) {
    super(scrub(message));
    this.name = 'OAuthError';
    this.code = code;
  }
}

/** A YouTube Data API HTTP failure: status + Google's message + reason codes. */
class ApiError extends Error {
  constructor(status, message, reasons) {
    super(scrub(message));
    this.name = 'ApiError';
    this.status = status;
    this.reasons = reasons;
  }
}

/** "network error contacting X: fetch failed (ECONNREFUSED)" — never the URL or a stack. */
function netMessage(what, err) {
  const cause = err && err.cause && err.cause.code ? ` (${err.cause.code})` : '';
  return scrub(`network error contacting ${what}: ${(err && err.message) || err}${cause}`);
}

/** ApiError from a non-2xx body: `HTTP 403: <error.message> [reason, ...]`. HTML bodies are not echoed. */
function apiErrorFrom(status, bodyText, statusText = '') {
  let message = '';
  let reasons = [];
  try {
    const e = JSON.parse(bodyText).error || {};
    message = typeof e.message === 'string' ? e.message : '';
    reasons = (Array.isArray(e.errors) ? e.errors : []).map((x) => x && x.reason).filter(Boolean);
  } catch (_) { /* not JSON */ }
  const text = `HTTP ${status}${message ? `: ${message}` : statusText ? ` ${statusText}` : ''}${reasons.length ? ` [${reasons.join(', ')}]` : ''}`;
  return new ApiError(status, text, reasons);
}

// ── Files ────────────────────────────────────────────────────────────────────

// JSON.parse errors can quote file contents, so they are never surfaced.
function readJsonFile(file, what, hint) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') throw Object.assign(new Error(`${what} not found: ${file}${hint ? `\n  ${hint}` : ''}`), { code: 'ENOENT' });
    throw new Error(`cannot read ${what} ${file}: ${e.code || 'read error'}`);
  }
  try {
    return JSON.parse(text);
  } catch (_) {
    throw new Error(`${what} ${file} is not valid JSON`);
  }
}

function loadClient(loc = locate()) {
  const raw = readJsonFile(loc.clientFile, 'OAuth client file',
    'Create a "Desktop app" OAuth client in Google Cloud Console and save its JSON there (or set YOUTUBE_CLIENT_FILE). See plugins/publish-youtube/README.md.');
  const c = raw && (raw.installed || raw.web);
  if (!c || !c.client_id || !c.client_secret) {
    throw new Error(`${loc.clientFile} must be a Google "Desktop app" client JSON: { "installed": { "client_id", "client_secret", ... } }`);
  }
  addSecret(c.client_secret);
  return { client_id: c.client_id, client_secret: c.client_secret };
}

function loadToken(loc = locate()) {
  let t;
  try {
    t = readJsonFile(loc.tokenFile, 'YouTube token file');
  } catch (e) {
    if (e.code === 'ENOENT') throw new OAuthError(`no YouTube token at ${loc.tokenFile} — run: ${AUTH_COMMAND}`, 'no_token');
    throw e;
  }
  if (!t || !t.refresh_token) throw new OAuthError(`${loc.tokenFile} has no refresh_token — run: ${AUTH_COMMAND}`, 'no_token');
  addSecret(t.refresh_token);
  return t;
}

/** Atomic write, mode 0600 (dir 0700 when created). Always to the new config dir. */
function saveToken(record, loc = locate()) {
  fs.mkdirSync(path.dirname(loc.saveTokenFile), { recursive: true, mode: 0o700 });
  const tmp = `${loc.saveTokenFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, loc.saveTokenFile);
  return loc.saveTokenFile;
}

function tokenAgeDays(token) {
  const t = Date.parse(token && token.obtained_at);
  return Number.isNaN(t) ? null : (Date.now() - t) / 86400000;
}

// ── OAuth token endpoint ─────────────────────────────────────────────────────

/** POST to the token endpoint with client credentials + `params`. Returns the JSON body. */
async function tokenRequest(params, loc = locate()) {
  const client = loadClient(loc);
  let res;
  try {
    res = await globalThis.fetch(TOKEN_URI, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: client.client_id, client_secret: client.client_secret, ...params }),
    });
  } catch (e) {
    throw new OAuthError(netMessage('Google token endpoint', e), 'network');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    const code = typeof body.error === 'string' ? body.error : `http_${res.status}`;
    const desc = typeof body.error_description === 'string' ? ` — ${body.error_description}` : '';
    throw new OAuthError(`Google token endpoint returned ${res.status}: ${code}${desc}`, code);
  }
  addSecret(body.access_token);
  addSecret(body.refresh_token);
  return body;
}

/** Refresh token → { accessToken, expiresAt (ms epoch) }. invalid_grant gets the re-auth message. */
async function refreshAccessToken(loc = locate(), token = loadToken(loc)) {
  try {
    const body = await tokenRequest({ grant_type: 'refresh_token', refresh_token: token.refresh_token }, loc);
    return { accessToken: body.access_token, expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000 };
  } catch (e) {
    if (e.code === 'invalid_grant') throw new OAuthError(REAUTH_MESSAGE, 'invalid_grant');
    throw e;
  }
}

// ── YouTube Data API ─────────────────────────────────────────────────────────

/** Authorized GET → parsed JSON; throws ApiError (status + Google's message/reasons). */
async function apiGet(url, accessToken) {
  let res;
  try {
    res = await globalThis.fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
  } catch (e) {
    throw new Error(netMessage('the YouTube API', e));
  }
  const text = await res.text();
  if (!res.ok) throw apiErrorFrom(res.status, text, res.statusText);
  try {
    return JSON.parse(text);
  } catch (_) {
    throw new Error(`YouTube API returned a non-JSON response (HTTP ${res.status})`);
  }
}

/** channels.list?mine=true → { id, title, handle } or null when the account has no channel. */
async function getChannel(accessToken) {
  const data = await apiGet(CHANNELS_URL, accessToken);
  const c = data.items && data.items[0];
  if (!c) return null;
  return { id: c.id, title: c.snippet && c.snippet.title, handle: (c.snippet && c.snippet.customUrl) || null };
}

const describeChannel = (c) => `${c.title} (${c.handle || 'no handle'}) — id ${c.id}`;

module.exports = {
  AUTH_URL, TOKEN_URI, SCOPES, AUTH_COMMAND, REAUTH_MESSAGE,
  locate, migrationNote, OAuthError, ApiError, addSecret, scrub, netMessage, apiErrorFrom,
  loadClient, loadToken, saveToken, tokenAgeDays, tokenRequest, refreshAccessToken, apiGet, getChannel, describeChannel,
};
