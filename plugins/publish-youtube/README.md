# publish-youtube

Uploads a finished video to YouTube with the Data API v3 (resumable upload, retried and resumed on network errors). A vertical video of 3 minutes or less becomes a Short. Full setup: `docs/publishing.md`.

```bash
reelsmith publish videos/my-video --to=youtube --auth           # one-time Google sign-in (again every 7 days in Testing mode)
reelsmith publish videos/my-video --to=youtube --auth --check   # verify the stored token (refresh + channels.list)
reelsmith publish videos/my-video --to=youtube --dry-run        # build + print the request, send nothing
reelsmith publish videos/my-video --to=youtube [--privacy=unlisted] [--file=output.mp4] [--force]
```

`--auth` takes a video argument like every `publish` command; any video of the project works.

## Setup

1. Google Cloud Console: create a project, enable **YouTube Data API v3**, configure the OAuth consent screen (External, add yourself as a test user), create an **OAuth client ID** of type **Desktop app**, download the JSON.
2. Save it as `~/.config/reelsmith/youtube-client.json` (`chmod 600`). `REELSMITH_CONFIG_DIR` moves the whole folder; `YOUTUBE_CLIENT_FILE` points at the client JSON alone.
3. `reelsmith publish <video> --to=youtube --auth`: a loopback sign-in on `127.0.0.1` with PKCE. You pick the account and channel and click Allow. The refresh token lands in `~/.config/reelsmith/yt-token.json` (mode 0600).

**Older installs:** when `REELSMITH_CONFIG_DIR` is unset and a file is missing from `~/.config/reelsmith/`, the plugin also looks in the config folder of the pipeline Reelsmith grew out of, uses the file from there and says so (`check()`, the dry run), with the command that moves it. New tokens are always written to `~/.config/reelsmith/`.

## Metadata

From `videos/<name>/publish.md` (`core/publishNotes.js`): `## Title` (1–100 characters), `## Description` (≤ 5000 bytes), `## Tags` (≤ 500 characters in total, a tag with a space counts 2 more). `<` and `>` are rejected anywhere. Optional frontmatter: `privacy`, `categoryId` (default 22), `madeForKids` (default false), `file`.

Precedence: `--privacy` / `--file` (relative to the video folder) > publish.md frontmatter > a legacy `youtube.json` in the video folder (its `title`, `description`, `tags`, `categoryId`, `privacy`, `madeForKids`, `file`) > `publish.targets.youtube` in `reelsmith.config.json` > defaults (private, `output.mp4`). With no publish.md title, the script.md title is used and the dry run says so.

## Results and re-runs

`videos/<name>/publish/youtube.json`: `{ id, url, studioUrl, requestedPrivacy, privacy (what YouTube actually applied), status, title, categoryId, file, bytes, at }`. A second run refuses when that file, or a legacy `youtube-upload.json`, already has an id. `--force` uploads a duplicate.

Unaudited API projects may have uploads locked to private: report the **actual** `privacy` from the result.

## API (for the CLI)

```js
publish({ video, dryRun, force, privacy, file, notes, root, config, env, log })
  → { ok, dryRun, target: 'youtube', request, id?, url?, privacy?, refused?, problems? }
check(ctx) → { ok, optional: true, message }        // no network
auth({ check = false, open = true, env, log })       // sign-in, or verify with check: true
```

The dry run reads the credentials (no token refresh), checks the file and metadata, and prints the full `videos.insert` request with the token redacted. Nothing prints the client secret, tokens, auth codes or the upload session URL.
