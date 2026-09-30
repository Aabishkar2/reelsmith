# publish-meta

Posts a finished video to a **Facebook Page** (a 9:16 video is classified as a Reel) and as an **Instagram Reel**, through the Graph API (`v21.0`). Setup details: `docs/publishing.md`.

```bash
reelsmith publish videos/my-video --to=meta --dry-run
reelsmith publish videos/my-video --to=meta --public-url=https://cdn.example.com/my-video.mp4
```

## Setup

`.env`:

```bash
META_SYSTEM_TOKEN=...   # system-user token: pages_manage_posts, pages_read_engagement, instagram_basic, instagram_content_publish
META_PAGE_ID=...        # the Facebook Page id
META_IG_USER_ID=...     # optional: the Instagram professional account id (looked up from the Page when empty)
```

The plugin asks the Page for its access token (`/{page}?fields=access_token,instagram_business_account`) and posts with it; when the field is absent it posts with the system token.

## The public URL

Instagram downloads the video from a URL, so it needs the mp4 reachable over https: `--public-url=…` or `publicUrl:` in the `publish.md` frontmatter. Without one, Instagram is `{ skipped: 'needs publicUrl' }` and Facebook still uploads the file itself (multipart `source`). With one, Facebook uses it too (`file_url`).

## What is sent

| Step | Request |
|---|---|
| Page token + IG id | `GET graph.facebook.com/v21.0/{page}?fields=access_token,instagram_business_account` |
| Facebook | `POST graph-video.facebook.com/v21.0/{page}/videos` with `title`, `description`, `published=true` and `file_url` or `source`; then `GET /{video}?fields=status,permalink_url` until `video_status` is `ready` (10 min) |
| Instagram | `POST /{ig}/media` `media_type=REELS`, `video_url`, `caption`, `share_to_feed=true`; `GET /{container}?fields=status_code` until `FINISHED` (15 min); `POST /{ig}/media_publish creation_id=…`; `GET /{media}?fields=permalink` |

Caption = the `publish.md` description plus any `## Hashtags` it doesn't already contain (Instagram: ≤ 2200 characters, ≤ 30 hashtags). Facebook title = `fbTitle:` frontmatter or the title. The Graph version can be set with `publish.targets.meta.graphVersion` or `META_GRAPH_VERSION`.

## Results and re-runs

`videos/<name>/publish/meta.json`: `{ id, url, fb: { id, permalink, status }, ig: { id, permalink } | { skipped }, title, caption, file, bytes, at }`. Each network is refused on a re-run once it has an id there (so a later run with `--public-url` posts only Instagram); `--force` posts again. `only: 'fb' | 'ig'` limits a run to one network.

## API

```js
publish({ video, dryRun, force, file, publicUrl, only, notes, root, config, env, log })
  → { ok, dryRun, target: 'meta', requests, id?, url?, fb, ig, refused?, problems?, errors? }
check(ctx) → { ok, optional: true, message }
```

The dry run prints every request with tokens redacted and makes no network call. Tokens never appear in output or result files.
