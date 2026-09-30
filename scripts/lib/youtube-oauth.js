/**
 * youtube-oauth.js — shared OAuth + YouTube Data API helpers for
 * scripts/youtube-auth.js and scripts/upload-youtube.js. Node built-ins only.
 *
 * Files (all outside the repo, never committed):
 *   client  $YOUTUBE_CLIENT_FILE, default ~/.config/video-gen-v2/youtube-client.json
 *           (Google "Desktop app" OAuth client JSON: { installed: { client_id, client_secret, ... } })
 *   token   ~/.config/video-gen-v2/yt-token.json  (0600)
 *           { refresh_token, scope, obtained_at, channel: { id, title, handle } | null }
 *
 * SECURITY: nothing in here prints the client secret, access/refresh tokens,
 * auth codes or the resumable-upload session URL. Every message that can carry
 * a server response goes through scrub(), and Google token-endpoint errors are
 * reduced to their `error` / `error_description` fields.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const CONFIG_DIR = path.join(os.homedir(), '.config', 'video-gen-v2');
const TOKEN_FILE = path.join(CONFIG_DIR, 'yt-token.json');

const expandHome = (p) => (p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p);
const CLIENT_FILE = path.resolve(expandHome(process.env.YOUTUBE_CLIENT_FILE || path.join(CONFIG_DIR, 'youtube-client.json')));

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URI = 'https://oauth2.googleapis.com/token';
const CHANNELS_URL = 'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true';
const SCOPES = 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly';

const REAUTH_MESSAGE = 'refresh token expired or revoked — run node scripts/youtube-auth.js';

// ── Redaction ──────────────────────────────────────────────────────────────────

const secrets = new Set();

/** Register a value that must never appear in output (also caught by pattern below). */
function addSecret(value) {
  if (value && String(value).length >= 6) secrets.add(String(value));
}

function scrub(text) {
  let out = String(text);
  for (const s of secrets) out = out.split(s).join('[redacted]');
  return out
    .replace(/ya29\.[\w.-]+/g, '[redacted]')       // access tokens
    .replace(/\b1\/\/[\w-]{20,}/g, '[redacted]')   // refresh tokens
    .replace(/\b4\/[\w-]{20,}/g, '[redacted]')     // auth codes
    .replace(/GOCSPX-[\w-]+/g, '[redacted]');      // client secrets
}

// ── Errors ─────────────────────────────────────────────────────────────────────

class OAuthError extends Error {
  constructor(message, code) {
    super(scrub(message));
    this.name = 'OAuthError';
    this.code = code;
  }
}

/** Error for a YouTube Data API HTTP failure: status + Google's message + reason codes. */
class ApiError extends Error {
  constructor(status, message, reasons) {
    super(scrub(message));
    this.name = 'ApiError';
    this.status = status;
    this.reasons = reasons;
  }
}

/** "fetch failed (ECONNREFUSED)" — message and cause code only, never the URL or a stack. */
function netMessage(what, err) {
  const cause = err && err.cause && err.cause.code ? ` (${err.cause.code})` : '';
  return scrub(`network error contacting ${what}: ${(err && err.message) || err}${cause}`);
}

/**
 * Build an ApiError from a non-2xx response body: `HTTP 403: <error.message> [reason, ...]`.
 * Non-JSON bodies (HTML error pages) are not echoed.
 */
function apiErrorFrom(status, bodyText, statusText = '') {
  let message = '';
  let reasons = [];
  try {
    const e = JSON.parse(bodyText).error || {};
    message = typeof e.message === 'string' ? e.message : '';
    reasons = (Array.isArray(e.errors) ? e.errors : []).map(x => x && x.reason).filter(Boolean);
  } catch {}
  const text = `HTTP ${status}${message ? `: ${message}` : statusText ? ` ${statusText}` : ''}${reasons.length ? ` [${reasons.join(', ')}]` : ''}`;
  return new ApiError(status, text, reasons);
}

// ── Files ──────────────────────────────────────────────────────────────────────

// JSON.parse errors can quote the file contents, so never surface them.
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
  } catch {
    throw new Error(`${what} ${file} is not valid JSON`);
  }
}

function loadClient() {
  const raw = readJsonFile(
    CLIENT_FILE,
    'OAuth client file',
    'Create a "Desktop app" OAuth client in Google Cloud Console, save its JSON there (or set YOUTUBE_CLIENT_FILE).'
  );
  const c = raw && raw.installed;
  if (!c || !c.client_id || !c.client_secret) {
    throw new Error(`${CLIENT_FILE} must be a Google "Desktop app" client JSON: { "installed": { "client_id", "client_secret", ... } }`);
  }
  addSecret(c.client_secret);
  return { client_id: c.client_id, client_secret: c.client_secret };
}

function loadToken() {
  let t;
  try {
    t = readJsonFile(TOKEN_FILE, 'YouTube token file');
  } catch (e) {
    if (e.code === 'ENOENT') throw new OAuthError(`no YouTube token at ${TOKEN_FILE} — run node scripts/youtube-auth.js`, 'no_token');
    throw e;
  }
  if (!t || !t.refresh_token) throw new OAuthError(`${TOKEN_FILE} has no refresh_token — run node scripts/youtube-auth.js`, 'no_token');
  addSecret(t.refresh_token);
  return t;
}

/** Atomic write, mode 0600 (dir 0700 if we have to create it). */
function saveToken(record) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const tmp = `${TOKEN_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, TOKEN_FILE);
}

function tokenAgeDays(token) {
  const t = Date.parse(token.obtained_at);
  return Number.isNaN(t) ? null : (Date.now() - t) / 86400000;
}

// ── OAuth token endpoint ───────────────────────────────────────────────────────

/** POST to the token endpoint with client credentials + `params`. Returns the JSON body. */
async function tokenRequest(params) {
  const client = loadClient();
  let res;
  try {
    res = await fetch(TOKEN_URI, {
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
async function refreshAccessToken(token = loadToken()) {
  try {
    const body = await tokenRequest({ grant_type: 'refresh_token', refresh_token: token.refresh_token });
    return { accessToken: body.access_token, expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000 };
  } catch (e) {
    if (e.code === 'invalid_grant') throw new OAuthError(REAUTH_MESSAGE, 'invalid_grant');
    throw e;
  }
}

// ── YouTube Data API ───────────────────────────────────────────────────────────

/** Authorized GET returning parsed JSON; throws ApiError (status + Google's message/reasons). */
async function apiGet(url, accessToken) {
  let res;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
  } catch (e) {
    throw new Error(netMessage('the YouTube API', e));
  }
  const text = await res.text();
  if (!res.ok) throw apiErrorFrom(res.status, text, res.statusText);
  try {
    return JSON.parse(text);
  } catch {
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
  CONFIG_DIR, TOKEN_FILE, CLIENT_FILE, AUTH_URL, TOKEN_URI, SCOPES, REAUTH_MESSAGE,
  OAuthError, ApiError, addSecret, scrub, netMessage, apiErrorFrom,
  loadClient, loadToken, saveToken, tokenAgeDays,
  tokenRequest, refreshAccessToken, apiGet, getChannel, describeChannel,
};
