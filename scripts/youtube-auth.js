#!/usr/bin/env node
/**
 * youtube-auth.js — one-time (and every-7-days) Google sign-in for YouTube uploads.
 *
 * Usage:
 *   node scripts/youtube-auth.js            run the browser sign-in, store the refresh token
 *   node scripts/youtube-auth.js --check    verify the stored token still works (exit 1 if not)
 *
 * Installed-app loopback OAuth with PKCE (S256) and a random `state`: starts a
 * server on 127.0.0.1 (random port), prints + opens the Google consent URL, and
 * waits for the redirect. The human picks the Google account + YouTube channel
 * and clicks Allow; nothing is pre-selected (no login_hint).
 *
 * Reads   the OAuth client JSON: $YOUTUBE_CLIENT_FILE, default ~/.config/video-gen-v2/youtube-client.json
 * Writes  ~/.config/video-gen-v2/yt-token.json (0600): { refresh_token, scope, obtained_at, channel }
 *
 * The app is in Google's Testing mode: refresh tokens expire 7 days after they
 * are issued, so re-run this then. Secrets/tokens/codes are never printed.
 */
const crypto = require('crypto');
const http = require('http');
const { spawn } = require('child_process');
const yt = require('./lib/youtube-oauth');

const TIMEOUT_MS = 5 * 60 * 1000;
const WARN_AGE_DAYS = 6;

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node scripts/youtube-auth.js [--check]');
  console.log('  (no flag)  browser sign-in → writes ' + yt.TOKEN_FILE);
  console.log('  --check    refresh an access token and call channels.list; exit 1 if the token is bad');
  process.exit(0);
}
const unknown = args.filter(a => a !== '--check');
if (unknown.length) {
  console.error(`Unknown argument: ${unknown.join(' ')}\nUsage: node scripts/youtube-auth.js [--check]`);
  process.exit(2);
}

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const htmlEscape = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Query values come from the network; strip anything odd before echoing to a terminal.
const plain = (s) => String(s).replace(/[^\w .:,/-]/g, '').slice(0, 120);

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function openBrowser(url) {
  const [cmd, cmdArgs] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, cmdArgs, { detached: true, stdio: 'ignore' });
    child.on('error', () => {}); // no opener available — the URL is printed anyway
    child.unref();
  } catch {}
}

function page(title, message) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${htmlEscape(title)}</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0906;color:#f5efe6;font-family:system-ui,sans-serif;text-align:center}main{padding:24px}p{color:rgba(245,239,230,.6)}</style>
</head><body><main><h1>${htmlEscape(title)}</h1><p>${htmlEscape(message)}</p></main></body></html>`;
}

function respond(res, status, html) {
  return new Promise(resolve => {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(html), 'Cache-Control': 'no-store', Connection: 'close' });
    res.end(html, resolve);
  });
}

/**
 * Start the loopback server. Resolves { port, callback, close } where `callback` is a
 * promise for the first request that carries our `state` plus a code or an error —
 * { code, res } | { error, res }. Strays (favicon, wrong/missing state) are ignored.
 */
async function startLoopback(state) {
  let settle;
  const callback = new Promise((resolve, reject) => { settle = { resolve, reject }; });
  let handled = false;

  const server = http.createServer((req, res) => {
    let u;
    try { u = new URL(req.url, 'http://127.0.0.1'); } catch { return respond(res, 400, page('Bad request', '')); }
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
    settle.reject(new Error('timed out after 5 minutes waiting for the Google sign-in — run node scripts/youtube-auth.js again'));
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

// ── Sign-in ────────────────────────────────────────────────────────────────────

async function authorize() {
  const client = yt.loadClient();
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

    console.log('\n  Sign in with Google to authorize YouTube uploads.');
    console.log('  Pick the Google account and the YouTube channel yourself, then click Allow.\n');
    console.log(`  ${authUrl}\n`);
    console.log('  (opening it in your browser — if nothing opens, paste the URL above; waiting up to 5 minutes)\n');
    openBrowser(authUrl);

    const cb = await loopback.callback;
    if (cb.error) {
      await respond(cb.res, 400, page('Authorization failed', `Google returned: ${cb.error}. See the terminal.`));
      throw new Error(`authorization was not granted (Google returned: ${cb.error})`);
    }

    let tokens;
    try {
      tokens = await yt.tokenRequest({
        grant_type: 'authorization_code',
        code: cb.code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
      });
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

async function main() {
  const tokens = await authorize();
  console.log('✓ Google authorized this app');

  const granted = String(tokens.scope || '').split(/\s+/);
  const missing = yt.SCOPES.split(' ').filter(s => !granted.includes(s));
  if (missing.length) {
    throw new Error(`Google did not grant every requested permission (missing: ${missing.join(', ')}). Re-run and leave every checkbox ticked on the consent screen.`);
  }
  if (!tokens.refresh_token) {
    throw new Error('Google returned no refresh token. This flow sends prompt=consent to force one, so this is unexpected — revoke the app at https://myaccount.google.com/permissions and run node scripts/youtube-auth.js again.');
  }

  // A failure here must not lose the single-use consent: the token is stored either way.
  let channel = null;
  try {
    channel = await yt.getChannel(tokens.access_token);
  } catch (e) {
    console.error(`⚠ could not look up the channel: ${e.message}`);
  }

  yt.saveToken({ refresh_token: tokens.refresh_token, scope: tokens.scope, obtained_at: new Date().toISOString(), channel });
  console.log(`✓ token saved → ${yt.TOKEN_FILE} (mode 0600)`);

  if (channel) {
    console.log(`\n  Channel : ${channel.title}`);
    console.log(`  ID      : ${channel.id}`);
    console.log(`  Handle  : ${channel.handle || '(none)'}`);
  } else {
    console.log('\n⚠ No YouTube channel found for the account/channel you picked. Create or switch to one at youtube.com, then run this again.');
  }
  console.log('\n  Note: App is in Testing mode: this refresh token expires 7 days after it was issued — re-run this script then.\n');
  if (!channel) process.exit(1);
}

// ── --check ────────────────────────────────────────────────────────────────────

async function check() {
  const token = yt.loadToken();
  const { accessToken } = await yt.refreshAccessToken(token);
  console.log('✓ refresh token is valid (access token refreshed)');

  const channel = await yt.getChannel(accessToken);
  if (!channel) {
    console.error('✗ token works, but the account has no YouTube channel — create one, then run node scripts/youtube-auth.js');
    process.exit(1);
  }
  console.log(`  Channel : ${yt.describeChannel(channel)}`);
  if (token.channel && token.channel.id && token.channel.id !== channel.id) {
    console.log(`  ⚠ stored channel was ${token.channel.title} (${token.channel.id}) — the token now resolves to a different channel`);
  }

  const age = yt.tokenAgeDays(token);
  if (age === null) {
    console.log('  Token age: unknown (no obtained_at in the token file)');
  } else {
    console.log(`  Token age: ${age.toFixed(1)} days (issued ${token.obtained_at})`);
    if (age >= WARN_AGE_DAYS) {
      console.log(`  ⚠ Testing-mode refresh tokens die at 7 days — run node scripts/youtube-auth.js ${age >= 7 ? 'now' : 'soon'}`);
    }
  }
}

// ── Run ────────────────────────────────────────────────────────────────────────

(args.includes('--check') ? check() : main()).catch(err => {
  console.error(`✗ ${yt.scrub(err.message)}`);
  process.exit(1);
});
