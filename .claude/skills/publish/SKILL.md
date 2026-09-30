---
name: publish
description: Write videos/<name>/publish.md — title, description, hashtags, tags, and pinned-comment suggestion for a finished video. Use when the user says "write the publish notes", "get this ready to post", "write the title and description", or once a video's output.mp4 is rendered and ready to go out.
---

# Publish Skill

Takes a finished (or near-finished) video — its `script.md`, `research.md`, and the rendered `output.mp4` — and writes `videos/<name>/publish.md`: everything needed to post it, formatted from `config/market.md`'s rules. This skill writes the metadata file; uploading is a separate step (`scripts/upload-youtube.js`, see Upload below) done only when the user asks.

---

## Output: `videos/<name>/publish.md`

```markdown
# Publish — <video-name>

## Title (≤45 chars preferred, 60 hard max)
<title>

## Description
<line 1: the takeaway, with the keyword phrase>
<line 2: source link>

<hashtags>

## Hashtags
#tag1 #tag2 #tag3

## Tags
tag one, tag two, tag three, ...

## Pinned comment
<suggestion>

## Posting notes
<from market.md §9>
```

### Title — ≤45 characters preferred (market.md §7), 60 hard max, from market.md §7 patterns

- Named tech in the first 3 words (market.md §7: "ByteByteGo's top titles run 17–38 [chars]").
- Use one of the within-channel winning shapes market.md documents: "Why is X so Y", "How [Company] does X", "[Company] Tech Stack"-style scale/case-study framing, "X vs Y" — pick whichever matches this video's actual content (don't force a shape that doesn't fit the script).
- Keep the title **distinct from the spoken hook line** (market.md §7: "Keep the title distinct from the spoken hook").
- No emoji-stuffing, no ALL CAPS beyond a named acronym.

### Description — first 2 lines matter

- **Line 1:** the takeaway with one keyword phrase baked in naturally (market.md §7: "line 1 = the takeaway with keywords"). Pull this from the script's final beat / takeaway line, reworded for text rather than speech.
- **Line 2:** a source link — pull the single most authoritative source from `research.md`'s Sources list (prefer official docs/announcement over secondary coverage).
- Then hashtags (see below).
- Do not repeat the full script — the description supports search and context, not a transcript.

### Hashtags — 3–5, from market.md §7/§9

- 2–3 **accurate** hashtags naming the actual tech (market.md §7: "the first 3 display; >60 and all are ignored; misleading tags risk removal"). Avoid the anti-pattern market.md calls out: don't tag `#python` on a Kafka video just because it's popular — tag what the video is actually about.
- Up to 5 total if a genuinely relevant broader tag helps (e.g. `#aws` + `#s3` + `#cloudcomputing`).

### Tags list

A slightly longer plain list (not hashtags) for YouTube's tags field: named services/tools from the script, the script's `topic` value (`aws` / `ai-ml` / `swe` / `devtools` — e.g. `ai-ml` for a prompt-caching video), and 2–3 broader synonyms a viewer might search.

### Pinned comment suggestion

One short comment the creator can pin — typically a correction/caveat preempted, a source link repeated, or an invitation for the specific follow-up question this topic tends to raise. Market.md §9: "Reply early; pin corrections" — if research.md's Open Questions section flags anything uncertain, consider pinning a caveat about it rather than waiting for someone to point it out in comments.

### Posting notes — from market.md §9

Summarize what applies to this specific video:
- Cadence: target 12–20 uploads/month, batch-scripted; note whether this video fits a recognizable series (market.md §9: a named recurring series gives viewers a reason to return) and if so suggest a series tag/title convention.
- Rotate template/hook type — if the last few videos in `videos/` used the same opening pattern, flag that and suggest this one lean on a different one.
- No specific "best time to post" claim — market.md is explicit that YouTube says posting time matters little; don't invent a recommendation here.

---

## Upload

Upload is implemented in `scripts/upload-youtube.js` (YouTube Data API v3, resumable `videos.insert`, Node built-ins only). **Only run it when the user asks** — never as an automatic last step of publishing.

### One-time auth (the human does this)

```bash
node scripts/youtube-auth.js          # opens Google sign-in; the human picks the account + channel and clicks Allow
node scripts/youtube-auth.js --check  # verifies the stored token, prints channel + token age (exit 1 if expired/revoked)
```

- Never run the sign-in flow on the agent's own judgment — it needs the human to click Allow. Run `--check` before an upload if unsure the token is alive.
- The OAuth client JSON (Google "Desktop app") lives at `$YOUTUBE_CLIENT_FILE`, default `~/.config/video-gen-v2/youtube-client.json`. The token is stored at `~/.config/video-gen-v2/yt-token.json` (mode 0600). Both are outside the repo; never print, copy or commit them.
- The Google project is in Testing mode: **the refresh token expires 7 days after it is issued**. On `refresh token expired or revoked — run node scripts/youtube-auth.js`, ask the human to re-run the sign-in.

### Upload

```bash
node scripts/upload-youtube.js videos/<name> --dry-run                    # validate + print the request, no network
node scripts/upload-youtube.js videos/<name>                              # upload output.mp4 as private
node scripts/upload-youtube.js videos/<name> --privacy=unlisted           # CLI overrides youtube.json
node scripts/upload-youtube.js videos/<name> --file=draft.mp4             # other file, relative to the video folder
```

**Input — `videos/<name>/youtube.json`** (write it from `publish.md`: title from `## Title`, description from `## Description` including the hashtag line, tags from `## Tags`):

```json
{
  "title": "…",
  "description": "…",
  "tags": ["…"],
  "categoryId": "28",
  "privacy": "private",
  "madeForKids": false
}
```

- Validated before anything is sent: title 1–100 chars; no `<` or `>` in title, description or tags (YouTube rejects them); description ≤ 5000 bytes; tags total ≤ 500 chars (a tag containing a space counts +2); `categoryId` numeric (default `22`); `privacy` one of `private|unlisted|public`.
- `madeForKids` is a legal self-declaration — set it deliberately. If omitted the script declares `false` and says so.
- Always `--dry-run` first and show the user the resolved title/description/privacy.

**Output — `videos/<name>/youtube-upload.json`:** `{uploaded_at, video_id, url, studio_url, requested_privacy, status, snippet:{title,categoryId}}`. If it already exists the script refuses to upload a duplicate; `--force` overrides (only when the user wants a second copy).

**Flow:** refresh the access token from the stored refresh token → open a resumable session → PUT the bytes (on a 5xx or dropped connection it asks the session how much it received and resumes, up to 3 retries) → re-read the video with `videos.list` → print the id, `https://youtu.be/<id>`, the Studio edit link, requested vs actual privacy, and the full `status` object. HTTP errors print the status plus Google's message and reason (`quotaExceeded`, `uploadLimitExceeded`, `youtubeSignupRequired`, …).

### Privacy behaviour

- **Default is `private`.** Never pass `--privacy=public` (or put `public` in youtube.json) unless the user explicitly said to publish publicly; the creator normally reviews and flips visibility in YouTube Studio.
- **The requested privacy is not guaranteed.** Google documents that unaudited API projects are forced to private. That did not happen on our first upload (2026-09-30, it stayed public; see `docs/youtube.md`), but it could still kick in. The script prints REQUESTED vs ACTUAL `status.privacyStatus` and, if they differ, "YouTube overrode privacy — …". Always report the ACTUAL value to the user, not the requested one.
- The script never prints secrets: no client secret, tokens, auth codes or the upload-session URL.

---

## Workflow

1. Read `videos/<name>/script.md` (final beat = takeaway line), `videos/<name>/research.md` (Sources, Open questions), and confirm `output.mp4` exists (or at least that `scenes.json`/`voiceover.mp3` are finalized) — publish.md describes a video that's actually done or nearly done.
2. Re-read `config/market.md` §7 and §9 — don't rely on memory for the exact rules.
3. Draft title, description, hashtags, tags, pinned comment, posting notes per the templates above.
4. Write `videos/<name>/publish.md`.
5. Present it to the user for approval — this is metadata a human will actually post, so don't skip review.
6. Upload via `scripts/upload-youtube.js` only when the user asks (see the Upload section above).
