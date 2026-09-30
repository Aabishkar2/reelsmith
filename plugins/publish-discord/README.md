# publish-discord

Posts a finished video to a Discord channel with a bot, for team review. Setup details: `docs/publishing.md`.

```bash
reelsmith publish videos/my-video --to=discord --dry-run
reelsmith publish videos/my-video --to=discord [--channel=<id>] [--file=output.mp4] [--force]
```

## Setup

1. Discord developer portal → New Application → Bot → Reset Token. Invite it (OAuth2 → URL Generator, scope `bot`) with **View Channel**, **Send Messages** and **Attach Files**.
2. `.env`: `DISCORD_BOT_TOKEN=…` and `DISCORD_CHANNEL_ID=…` (right-click the channel → Copy Channel ID, with Developer Mode on).

`publish.targets.discord.channelIdEnv` in `reelsmith.config.json` names a different variable for the channel id; `--channel=` beats both.

## Message and file

The message is the `publish.md` title in bold (the script.md title when there is no publish.md) plus the first line of the description. The file is `output.mp4` (or `--file`).

**The 10 MB limit.** Bots can upload 10 MiB on servers without boosts. A larger file is first transcoded to `output-discord.mp4`: H.264 (`libx264 -preset slow`, two-pass), 720×1280, AAC 96 kbps, the video bitrate computed from the duration so the file lands at ≤ 9.3 MB; if it is still over, 540×960. The transcode is reused while it is newer than the source and under the limit. Servers with a higher limit: `publish.targets.discord.limitBytes` or `DISCORD_MAX_BYTES`. Needs ffmpeg + ffprobe, found like every other tool (`core/env.js`): `FFMPEG_PATH` / `FFPROBE_PATH`, then `PATH`, then `/opt/homebrew/bin`, `/usr/local/bin` and `~/.local/bin`.

The dry run prints the channel, the message, the file, its size and whether a transcode is needed, and **runs the transcode** so the size is verifiable. It never calls Discord.

## Results and re-runs

`videos/<name>/publish/discord.json`: `{ id, messageId, channelId, guildId, url, file, bytes, transcoded, at }`. A second run refuses when it has an id; `--force` posts again.

## API

```js
publish({ video, dryRun, force, file, channel, limitBytes, notes, root, config, env, paths, log })
  → { ok, dryRun, target: 'discord', channelId, message, file, bytes, transcoded, request, id?, url?, refused?, problems? }
check(ctx) → { ok, optional: true, message }
```

Upload: `POST https://discord.com/api/v10/channels/{id}/messages`, multipart `payload_json` + `files[0]`, `Authorization: Bot …` (one retry on a 429). The token never appears in output or result files.
