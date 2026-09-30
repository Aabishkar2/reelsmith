---
name: publish
description: Write videos/<name>/publish.md (title, description, hashtags, tags, music credit, pinned comment) for a finished video, and run `reelsmith publish` to YouTube, Meta (Instagram/Facebook Reels) or Discord when the creator asks. Use when the user says "write the publish notes", "get this ready to post", "write the title and description", "upload this", "post it", or once output.mp4 is rendered. Always --dry-run first; never post without the creator saying so; YouTube privacy defaults to private.
---

# Publish skill

Two jobs, in this order:

1. **Notes:** write `videos/<name>/publish.md`, the metadata every publish target reads.
2. **Post:** run `reelsmith publish` for the targets the creator names, dry run first. Only when the creator explicitly says to post.

Setup for each target (keys, tokens, limits) is in `docs/publishing.md`. `reelsmith doctor` shows which targets are ready.

---

## 1. Notes: `videos/<name>/publish.md`

Start from the skeleton:

```bash
reelsmith publish videos/<name> --notes
```

`--notes` only writes the `publish.md` skeleton. It sends nothing. Then fill it in:

```markdown
# Publish — <video-name>

## Title
<title, 45 characters or fewer preferred, 60 hard max>

## Description
<line 1: the takeaway, with the keyword phrase>
<line 2: the best source link>

<music credit line, if the video has a music bed>

<hashtags>

## Hashtags
#tag1 #tag2 #tag3

## Tags
tag one, tag two, tag three

## Pinned comment
<suggestion>

## Posting notes
<cadence, series, anything the creator should know>
```

Keep the section names the skeleton writes; the publish plugins parse them. Optional frontmatter at the top of publish.md sets per-target options: `privacy`, `categoryId`, `madeForKids`, `file` (YouTube), `publicUrl`, `fbTitle` (Meta). See `docs/publishing.md`.

### Title

- 45 characters or fewer preferred, 60 hard max.
- The named thing in the first 3 words.
- A shape that fits the content: "Why is X so Y", "How [company] does X", "X vs Y". Do not force one.
- Different from the spoken hook line.
- No emoji stuffing, no ALL CAPS beyond an acronym, no `<` or `>` (YouTube rejects them).

### Description

- **Line 1:** the takeaway, with one keyword phrase, reworded for reading. Take it from the script's last line.
- **Line 2:** the single most authoritative source from `research.md` (official docs over coverage).
- **Music credit:** if the video has a bed, copy the track's credit line from `music/CREDITS.md` exactly. CC BY tracks require it.
- Then the hashtags. Never paste the whole script.

### Hashtags

3 to 5, accurate: 2 to 3 that name the actual topic, plus up to 2 broader ones. A popular but unrelated tag risks removal.

### Tags

A slightly longer plain list for YouTube's tags field: the named tools and services, the script's `topic`, and 2 to 3 synonyms a viewer might search. Keep the total under 500 characters.

### Pinned comment

One short comment the creator can pin: a caveat from research.md's Open questions, the source link again, or the follow-up question this topic raises.

### Posting notes

- Whether the video fits a recurring series (`series:` / `episode:` in the frontmatter) and a title convention for it.
- If recent videos in `videos/` used the same opening pattern, say so.
- No "best time to post" claim.

If `config/market.md` exists, re-read its §7 (titles, descriptions, hashtags) and §9 (posting) before drafting. Do not rely on memory.

**Gate:** present publish.md to the creator for approval. It is text a human will post.

---

## 2. Post: `reelsmith publish`

**Only when the creator explicitly asks to post, and names the targets.** Never publish as an automatic last step. Never on your own judgment.

Targets are publish plugins:

| Target | Posts to | Needs |
|---|---|---|
| `youtube` | YouTube (vertical and 3 min or shorter becomes a Short) | OAuth client JSON in `~/.config/reelsmith/` and a one-time browser sign-in by the human |
| `meta` | Facebook Page video/Reels and Instagram Reels | `META_SYSTEM_TOKEN`, `META_PAGE_ID` (`META_IG_USER_ID` optional); Instagram also needs a public https URL of the mp4 (`--public-url=` or `publicUrl:` in publish.md) |
| `discord` | A Discord channel, for team review | `DISCORD_BOT_TOKEN`, `DISCORD_CHANNEL_ID`; files over 10 MB are transcoded to fit |

### Always dry-run first

```bash
reelsmith publish videos/<name> --to=youtube --dry-run
reelsmith publish videos/<name> --to=youtube,meta,discord --dry-run
```

A dry run reads the credentials, checks the file and its size, builds the exact request and prints it. It sends nothing. Show the creator the resolved title, description, privacy and file, and ask for a go.

### Then post

```bash
reelsmith publish videos/<name> --to=youtube
```

- Each target writes its result to `videos/<name>/publish/<target>.json` (id, URL, what was sent).
- A second run refuses when that file already has an `id`, so nothing is uploaded twice. `--force` overrides it; use it only when the creator wants a second copy.
- Report the URL and id from the result file to the creator.

### Privacy (YouTube)

- **The default is `private`.** Only set `privacy: public` (in the `publish.md` frontmatter) when the creator explicitly says "public". The creator usually reviews the upload and flips it in YouTube Studio.
- `madeForKids` is a legal self-declaration (default `false`). Set it deliberately if the creator says otherwise.
- The privacy YouTube applies can differ from the one requested (Google may force unaudited API projects to private). Report the **actual** privacy from the result, not the requested one.

### Things that go wrong

- **No YouTube token, or it expired** (Google projects in Testing mode issue refresh tokens that die after 7 days): ask the human to run `reelsmith publish --to=youtube --auth` and click Allow in the browser. Never run the sign-in on your own; it needs the human.
- **Content ID claims:** CC BY tracks (Kevin MacLeod) often get claimed on YouTube, and a claimed Short over 1 minute can be blocked. For YouTube versions prefer a YouTube Audio Library bed or none. See `docs/publishing.md`.
- **Instagram skipped:** no public URL for the mp4. Facebook still uploads directly.
- Never print, copy or commit tokens, client secrets or upload-session URLs.

---

## Workflow

1. Read `videos/<name>/script.md` (the last line is the takeaway), `research.md` (Sources, Open questions), and confirm `output.mp4` exists.
2. `reelsmith publish videos/<name> --notes`, then fill in publish.md per the rules above.
3. **Gate:** show publish.md to the creator and get approval.
4. When the creator asks to post: `reelsmith publish videos/<name> --to=<targets> --dry-run`, show the output.
5. **Gate:** on an explicit go, run the same command without `--dry-run`.
6. Report the ids, URLs and actual privacy from `videos/<name>/publish/<target>.json`.
