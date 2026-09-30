# YouTube upload — setup and open work

Channel: **The Subtext**, `@findthesubtext` (https://www.youtube.com/@findthesubtext), owned by `wagleaabishkar@gmail.com`.

## What exists (2026-09-30)

| Piece | Where |
|---|---|
| Google Cloud project | `findthesubtext-yt`, owned by `aabishkar2@gmail.com` (a different account from the channel owner, which is fine) |
| API | YouTube Data API v3 enabled |
| OAuth consent screen | Google Auth Platform: External, **Testing**, app name "findthesubtext", test user `wagleaabishkar@gmail.com` |
| OAuth client | `youtube-uploader`, type Desktop app. JSON at `~/.config/video-gen-v2/youtube-client.json` (0600, outside the repo). The secret can't be viewed again in the console, so a lost file means creating a new client. |
| Refresh token | `~/.config/video-gen-v2/yt-token.json` (0600), written by `scripts/youtube-auth.js` |
| Scripts | `scripts/youtube-auth.js` (one-time consent, `--check`), `scripts/upload-youtube.js videos/<name>` |
| Per-video metadata | `videos/<name>/youtube.json`, and the upload result in `videos/<name>/youtube-upload.json` |

## Limits while things stay as they are

1. **Refresh token dies 7 days after it was issued** because the consent screen is in Testing. Run `node scripts/youtube-auth.js --check` before uploading. On `invalid_grant`, re-run `node scripts/youtube-auth.js` and click Allow.
2. **Private lock did NOT happen (2026-09-30).** The docs say unaudited projects created after 2020-07-28 are forced to private. But the first upload (`Hpzurgnbaek`, OpenAI DevDay) requested `public` and stayed public: the API said `public` after processing, anonymous oEmbed returned 200, and Studio showed Visibility: Public. Google may still lock it later after a review, so re-check a few days after an upload. If the lock does appear, the fix is the audit below. Until then, `--privacy=public` works.
3. **Quota**: 10,000 units/day by default. An upload has historically cost 1,600 units (about 6 uploads/day), though some sources say the published table now lists 100. Check the Quotas page in Cloud Console.

## To do: remove the 7-day token expiry (publish the consent screen)

The "Publish app" button on Audience is disabled with "complete your configuration on the Branding page". Most likely it needs these:

- [ ] Home page, e.g. `https://mountain.aabishkar.info.np/subtext/` (nginx on the the.subtext box already serves `/var/www/subtext`)
- [ ] Privacy policy page, e.g. `https://mountain.aabishkar.info.np/subtext/privacy.html` (say what the app does: uploads our own videos to our own channel and stores no user data)
- [ ] Terms page (optional, but cheap to add alongside)
- [ ] Authorized domain `aabishkar.info.np` on the Branding page
- [ ] Audience → **Publish app** → In production. Leave it unverified: the "Google hasn't verified this app" warning is fine for our own channel, and we stay under the 100-user cap.
- [ ] Re-run `node scripts/youtube-auth.js` once after publishing, so the new token no longer carries the 7-day expiry

## If uploads ever get locked to private: compliance audit

- [ ] Submit the YouTube API Services audit / quota extension form (https://support.google.com/youtube/contact/yt_api_form) for project `findthesubtext-yt`. Describe it as an internal tool uploading our own content to our own channel. Expect them to ask for the home and privacy pages above, a screencast of the flow, and the channel URL.
- [ ] While applying, also ask for more quota if we plan more than a few uploads a day.
- [ ] Once approved, `--privacy=public` (or `"privacy": "public"` in `youtube.json`) takes effect directly and the manual Studio flip goes away.

## Gotcha: music claims block long Shorts

The first upload (`Hpzurgnbaek`) came back from the API as `public` but was **blocked globally**. Content ID matched the bed "Voxel Revolution" (Kevin MacLeod, CC-BY) to a claim by **Audiam (Publishing)** covering 0:00–2:06. YouTube blocks Shorts longer than 1 min that carry a Content ID claim over the claimant's length limit. The API status doesn't show this. Check Studio → Content → Notices, or an anonymous watch-page fetch (`playabilityStatus` = `UNPLAYABLE`).

- For YouTube versions, use YouTube Audio Library music or no bed. CC-BY Kevin MacLeod tracks get claimed anyway.
- Studio fixes: Erase song (keeps speech), Replace song (Audio Library), Trim, or Dispute (up to 30 days, blocked meanwhile). On `Hpzurgnbaek`, **Erase song was greyed out** and only "mute all sound" was offered, which would have silenced the voice too.
- What fixed it: re-mixed with `music/intergalactic.mp3` (Audio Library), swapped the audio into `output.mp4` with `ffmpeg -c:v copy` (no re-render needed), and re-uploaded as `oXRFm7yXwog`. No notices, and it plays for anonymous viewers. The blocked `Hpzurgnbaek` still needs deleting by hand in Studio.

## Also open

- [ ] Copy `youtube-client.json` to the the.subtext box (EC2 in the manzeel-dai VPC) if uploads should run from there. The auth consent needs a browser, so run `youtube-auth.js` on the Mac and copy `yt-token.json` over too.
- [ ] Shorts: vertical and ≤ 3 min are classified as Shorts automatically. No `#Shorts` needed.
