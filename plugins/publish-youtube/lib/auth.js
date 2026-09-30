'use strict';
/**
 * plugins/publish-youtube/lib/auth.js — the one-time (and every-7-days) Google sign-in.
 * Ported from the pre-framework scripts/youtube-auth.js.
 *
 *   signIn({ loc, log, open = true }) → { tokenFile, channel }
 *       Installed-app loopback OAuth with PKCE (S256) and a random `state`: a server on
 *       127.0.0.1 (random port) receives Google's redirect. The human picks the account and the
 *       YouTube channel and clicks Allow; nothing is pre-selected (no login_hint). The refresh token
 *       is saved to <config dir>/yt-token.json (0600).
 *   verify({ loc, log }) → { channel, ageDays }
 *       Refreshes an access token and calls channels.list?mine=true (network). Warns when a
 *       Testing-mode token nears its 7-day expiry.
 *
 * Google projects in "Testing" mode issue refresh tokens that expire 7 days after issue: run the
 * sign-in again then. Secrets, tokens and codes are never printed.
 */
const crypto = require('crypto');
const http = require('http');
const { spawn } = require('child_process');
const yt = require('./oauth');

const TIMEOUT_MS = 5 * 60 * 1000;
const WARN_AGE_DAYS = 6;

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const htmlEscape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Query values come from the network; strip anything odd before echoing them to a terminal.
const plain = (s) => String(s).replace(/[^\w .:,/-]/g, '').slice(0, 120);

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function openBrowser(url) {
  const [cmd, cmdArgs] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
      : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, cmdArgs, { detached: true, stdio: 'ignore' });
    child.on('error', () => {}); // no opener available: the URL is printed anyway
    child.unref();
  } catch (_) { /* printed anyway */ }
}

function page(title, message) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${htmlEscape(title)}</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0B0F19;color:#F5F7FF;font-family:system-ui,sans-serif;text-align:center}main{padding:24px}p{color:rgba(245,247,255,.62)}</style>
</head><body><main><h1>${htmlEscape(title)}</h1><p>${htmlEscape(message)}</p></main></body></html>`;
}

function respond(res, status, html) {
  return new Promise((resolve) => {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(html), 'Cache-Control': 'no-store', Connection: 'close' });
    res.end(html, resolve);
  });
}

/**
 * Loopback server → { port, callback, close }. `callback` resolves on the first request that
 * carries our `state` plus a code or an error: { code, res } | { error, res }. Strays are ignored.
 */
async function startLoopback(state) {
  let settle;
  const callback = new Promise((resolve, reject) => { settle = { resolve, reject }; });
  let handled = false;

  const server = http.createServer((req, res) => {
    let u;
    try { u = new URL(req.url, 'http://127.0.0.1'); } catch (_) { return respond(res, 400, page('Bad request', '')); }
    const q = u.searchParams;
    if (req.method !== 'GET' || u.pathname !== '/' || !q.has('state') || !safeEqual(q.get('state'), state)) {
      return respond(res, 404, page('Not found', 'This address is only used by the YouTube sign-in.'));
    }
    if (handled) return respond(res, 409, page('Already handled', 'You can close this tab.'));
    if (q.has('error')) {
      handled = true;
      return settle.resolve({ error: plain(q.get('error')), res });
    }
    if (q.has('code')) {
      handled = true;
      yt.addSecret(q.get('code'));
      return settle.resolve({ code: q.get('code'), res });
    }
    return respond(res, 400, page('Bad request', 'Missing authorization code.'));
  });

  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const timer = setTimeout(() => {
    settle.reject(new Error(`timed out after 5 minutes waiting for the Google sign-in — run: ${yt.AUTH_COMMAND}`));
  }, TIMEOUT_MS);

  return {
    port: server.address().port,
    callback,
    close() {
      clearTimeout(timer);
      server.close();
      if (server.closeAllConnections) server.closeAllConnections();
    },
  };
}

async function authorize(loc, log, open) {
  const client = yt.loadClient(loc);
  const verifier = b64url(crypto.randomBytes(64));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(24));

  const loopback = await startLoopback(state);
  try {
    const redirectUri = `http://127.0.0.1:${loopback.port}/`;
    const authUrl = `${yt.AUTH_URL}?${new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: yt.SCOPES,
      access_type: 'offline',
      prompt: 'consent',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
    })}`;

    log('\n  Sign in with Google to authorize YouTube uploads.');
    log('  Pick the Google account and the YouTube channel yourself, then click Allow.\n');
    log(`  ${authUrl}\n`);
    log('  (opening it in your browser — if nothing opens, paste the URL above; waiting up to 5 minutes)\n');
    if (open) openBrowser(authUrl);

    const cb = await loopback.callback;
    if (cb.error) {
      await respond(cb.res, 400, page('Authorization failed', `Google returned: ${cb.error}. See the terminal.`));
      throw new Error(`authorization was not granted (Google returned: ${cb.error})`);
    }
    let tokens;
    try {
      tokens = await yt.tokenRequest({ grant_type: 'authorization_code', code: cb.code, code_verifier: verifier, redirect_uri: redirectUri }, loc);
    } catch (e) {
      await respond(cb.res, 500, page('Authorization failed', 'Token exchange failed. See the terminal.'));
      throw e;
    }
    await respond(cb.res, 200, page('Authorized — you can close this tab.', 'Head back to the terminal.'));
    return tokens;
  } finally {
    loopback.close();
  }
}

async function signIn({ loc = yt.locate(), log = console.log, open = true } = {}) {
  const tokens = await authorize(loc, log, open);
  log('✓ Google authorized this app');

  const granted = String(tokens.scope || '').split(/\s+/);
  const missing = yt.SCOPES.split(' ').filter((s) => !granted.includes(s));
  if (missing.length) {
    throw new Error(`Google did not grant every requested permission (missing: ${missing.join(', ')}). Re-run and leave every checkbox ticked on the consent screen.`);
  }
  if (!tokens.refresh_token) {
    throw new Error(`Google returned no refresh token. Revoke the app at https://myaccount.google.com/permissions and run ${yt.AUTH_COMMAND} again.`);
  }

  // A failure here must not lose the single-use consent: the token is stored either way.
  let channel = null;
  try {
    channel = await yt.getChannel(tokens.access_token);
  } catch (e) {
    log(`⚠ could not look up the channel: ${e.message}`);
  }
  const tokenFile = yt.saveToken({ refresh_token: tokens.refresh_token, scope: tokens.scope, obtained_at: new Date().toISOString(), channel }, loc);
  log(`✓ token saved → ${tokenFile} (mode 0600)`);
  if (channel) {
    log(`\n  Channel : ${channel.title}\n  ID      : ${channel.id}\n  Handle  : ${channel.handle || '(none)'}`);
  } else {
    log('\n⚠ No YouTube channel found for the account/channel you picked. Create or switch to one at youtube.com, then sign in again.');
  }
  log('\n  Note: Google projects in Testing mode issue refresh tokens that expire after 7 days — sign in again then.\n');
  return { tokenFile, channel };
}

async function verify({ loc = yt.locate(), log = console.log } = {}) {
  const token = yt.loadToken(loc);
  const { accessToken } = await yt.refreshAccessToken(loc, token);
  log('✓ refresh token is valid (access token refreshed)');
  const channel = await yt.getChannel(accessToken);
  if (!channel) throw new Error(`token works, but the account has no YouTube channel — create one, then run: ${yt.AUTH_COMMAND}`);
  log(`  Channel : ${yt.describeChannel(channel)}`);
  if (token.channel && token.channel.id && token.channel.id !== channel.id) {
    log(`  ⚠ stored channel was ${token.channel.title} (${token.channel.id}) — the token now resolves to a different channel`);
  }
  const ageDays = yt.tokenAgeDays(token);
  if (ageDays == null) log('  Token age: unknown (no obtained_at in the token file)');
  else {
    log(`  Token age: ${ageDays.toFixed(1)} days (issued ${token.obtained_at})`);
    if (ageDays >= WARN_AGE_DAYS) log(`  ⚠ Testing-mode refresh tokens die at 7 days — run ${yt.AUTH_COMMAND} ${ageDays >= 7 ? 'now' : 'soon'}`);
  }
  return { channel, ageDays };
}

module.exports = { signIn, verify, WARN_AGE_DAYS };
