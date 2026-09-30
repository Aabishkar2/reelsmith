# Publishing

`reelsmith publish` sends a finished `output.mp4` to one or more targets. Each target is a publish plugin. Three are built in:

| Target | Posts to | Credentials |
|---|---|---|
| `youtube` | YouTube (vertical and 3 min or shorter becomes a Short automatically) | OAuth client JSON and a stored refresh token in `~/.config/reelsmith/` |
| `meta` | a Facebook Page (video/Reels) and Instagram Reels | `META_SYSTEM_TOKEN`, `META_PAGE_ID`, optional `META_IG_USER_ID` |
| `discord` | a Discord channel, for team review | `DISCORD_BOT_TOKEN`, `DISCORD_CHANNEL_ID` |

`reelsmith doctor` shows which targets are ready.

## The flow

```bash
reelsmith publish videos/<name> --notes                          # 1. write the publish.md skeleton
# 2. fill in publish.md (the publish skill does this) and review it
reelsmith publish videos/<name> --to=youtube,discord --dry-run   # 3. see exactly what would be sent
reelsmith publish videos/<name> --to=youtube,discord             # 4. send
```

### `publish.md`

Every target reads its metadata from `videos/<name>/publish.md`: title, description, tags and hashtags. `--notes` writes the skeleton and sends nothing. Keep the section names it writes.

- Title: 60 characters at most (45 or fewer reads best on a phone). No `<` or `>`.
- Description: line 1 is the takeaway, line 2 the main source link, then the music credit line if the video has a bed (copy it from `music/CREDITS.md`), then the hashtags.
- Tags: a plain comma-separated list, under 500 characters in total.
- Optional frontmatter at the top sets per-target options: `privacy`, `categoryId`, `madeForKids`, `file` (YouTube), `publicUrl`, `fbTitle` (Meta).

### Dry run everywhere

`--dry-run` does everything except the network write: it reads the credentials, checks the file and its size, builds the request and prints it. Always run it first and read the output.

### Results

Each target writes `videos/<name>/publish/<target>.json` with the id, the URL and what was sent. A second run for the same target refuses when that file already has an `id`, so nothing is uploaded twice by accident. Pass `--force` only when you want a second copy.

The `publish/` folder is gitignored.

## Credentials live outside the repo

| Where | What |
|---|---|
| `.env` in the project root | tokens and ids for Meta and Discord (gitignored) |
| `~/.config/reelsmith/` | the YouTube OAuth client (`youtube-client.json`) and refresh token (`yt-token.json`, mode 0600). `REELSMITH_CONFIG_DIR` points it elsewhere |

Never commit either. Tools never print tokens, client secrets or upload-session URLs.

## YouTube

### One-time setup

1. **Create a Google Cloud project** at [console.cloud.google.com](https://console.cloud.google.com). Any Google account can own it; it does not have to be the channel owner.
2. **Enable the YouTube Data API v3** for the project (APIs & Services → Library).
3. **Configure the OAuth consent screen** (Google Auth Platform): user type External, publishing status Testing, and add the Google account that owns the channel as a **test user**.
4. **Create an OAuth client** of type **Desktop app**. Download its JSON and save it:

   ```bash
   mkdir -p ~/.config/reelsmith
   mv ~/Downloads/client_secret_*.json ~/.config/reelsmith/youtube-client.json
   chmod 600 ~/.config/reelsmith/youtube-client.json
   ```

   The console never shows the secret again. If you lose the file, create a new client. To keep the client JSON elsewhere, set `YOUTUBE_CLIENT_FILE` to its path.
5. **Sign in once:**

   ```bash
   reelsmith publish --to=youtube --auth
   ```

   It opens a Google consent page in the browser (a local loopback flow with PKCE; nothing is pre-selected). Pick the account and the channel and click Allow. The refresh token is saved as `~/.config/reelsmith/yt-token.json` (mode 0600).

### Metadata and privacy

The title, description and tags come from `publish.md`. Optional frontmatter at the top of `publish.md` sets the rest:

```markdown
---
privacy: unlisted        # private (default) | unlisted | public
categoryId: 28           # YouTube category, default 22 (People & Blogs)
madeForKids: false       # a legal self-declaration; default false
file: output.mp4         # relative to the video folder
---
# Publish — my-video
```

`publish.targets.youtube.categoryId` in `reelsmith.config.json` sets a project-wide category.

- Uploads are **private by default**. Make a video public only when you mean it; usually you review it in YouTube Studio and flip it there.
- Google documents that uploads from unaudited API projects can be locked to private. It may not happen, or may happen later. Always read the **actual** privacy in the result, not the one you asked for. If uploads do get locked, submit the [YouTube API Services audit form](https://support.google.com/youtube/contact/yt_api_form) and describe the project as an internal tool uploading your own videos to your own channel.
- Metadata YouTube rejects: a title over 100 characters, `<` or `>` anywhere, a description over 5000 bytes, tags over 500 characters in total. The dry run checks these.

### Limits

- **The refresh token expires 7 days after it is issued** while the consent screen is in Testing. When a publish fails with an expired or revoked token, sign in again with `reelsmith publish --to=youtube --auth`. To remove the expiry, publish the consent screen: add a home page and a privacy policy page and your domain on the Branding page, then Audience → Publish app. It can stay unverified for your own channel (under 100 users); sign in once more afterwards.
- **Quota:** 10,000 units per day by default. An upload has historically cost 1,600 units, so about 6 uploads a day. Check the Quotas page in the Cloud Console.
- **Shorts:** a vertical video of 3 minutes or less is classified as a Short. No `#Shorts` tag is needed.

### Music claims can block a Short

Content ID often matches CC BY tracks (including Kevin MacLeod's) to third-party claims. YouTube blocks Shorts longer than 1 minute that carry such a claim, and the API status does not show it. Check Studio → Content → the video's notices, or open the watch page logged out.

- For YouTube versions, use a YouTube Audio Library track or no bed.
- Studio offers Erase song, Replace song, Trim or Dispute, but Erase song is not always available for Shorts.
- To fix it without re-rendering, remix with another track and swap the audio into the existing video (the picture is copied, not re-encoded), then upload the new file as a new video and delete the blocked one in Studio:

  ```bash
  reelsmith mix videos/<name> --track=music/<audio-library-track>.mp3
  ffmpeg -i videos/<name>/output.mp4 -i videos/<name>/voiceover-mix.mp3 \
    -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest videos/<name>/output-youtube.mp4
  ```

## Meta: Facebook Page and Instagram Reels

### Setup

1. You need a Facebook Page and an Instagram professional account connected to it, both in a Meta Business portfolio.
2. In Business Settings, create a **system user**, give it access to the Page and the Instagram account, and generate a token for your Meta app with the page and Instagram publishing permissions (`pages_manage_posts`, `pages_read_engagement`, `instagram_basic`, `instagram_content_publish`).
3. Put the ids in `.env`:

   ```bash
   META_SYSTEM_TOKEN=...
   META_PAGE_ID=...          # the Facebook Page id
   META_IG_USER_ID=...       # optional: the Instagram professional account id (looked up from the Page when empty)
   ```

The caption is the `publish.md` description plus its hashtags. The Facebook title is `fbTitle` from the `publish.md` frontmatter, else the title. On a 9:16 video Facebook classifies the upload as a Reel.

### The public URL requirement

**Instagram fetches the video from a URL**, so it needs `output.mp4` reachable on the public internet over https (an object store, a CDN, your own server). Give it with `--public-url=<url>` or `publicUrl:` in the `publish.md` frontmatter. Without one, the Instagram part is **skipped** with the reason in the result, and the Facebook part still runs: it uploads the file itself (up to 1 GB), or uses the public URL when there is one.

```bash
reelsmith publish videos/<name> --to=meta --public-url=https://cdn.example.com/my-video.mp4 --dry-run
```

## Discord

### Setup

1. Create an application at the [Discord developer portal](https://discord.com/developers/applications), add a **bot**, and copy its token.
2. Invite the bot to your server with the permissions to view the channel, send messages and attach files.
3. In Discord, turn on Developer Mode (Settings → Advanced), right-click the review channel, and Copy Channel ID.
4. Put both in `.env`:

   ```bash
   DISCORD_BOT_TOKEN=...
   DISCORD_CHANNEL_ID=...
   ```

To read the channel id from a different variable, name it in the config: `"publish": { "targets": { "discord": { "channelIdEnv": "MY_REVIEW_CHANNEL" } } }`.

### The 10 MB limit

Bots can upload files up to 10 MB on servers without boosts. When `output.mp4` is larger, the plugin first transcodes `output-discord.mp4` (H.264, 720×1280, a two-pass bitrate computed from the duration so the file lands under the limit, 540×960 if it is still too big) and sends that. The transcode is reused while it is newer than the source. A server with a higher limit can raise it with `publish.targets.discord.limitBytes` or `DISCORD_MAX_BYTES`.

The message is the `publish.md` title plus the first line of the description. The dry run prints the channel, the message, the file and its size, and runs the transcode if one is needed, so you can check the size. It never calls Discord.

## Your own target

A publish target is a plugin with `publish()` and `check()`. See [Plugins](plugins.md#publish) for the contract and a Slack example.
