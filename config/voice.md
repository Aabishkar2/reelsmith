# On-Screen Text Guidelines

This file governs **on-screen text** — headlines, labels, and body copy rendered visually in the video.
For the **spoken script** (what the narrator says), see `.claude/skills/script-writing/SKILL.md`.

---

## Headlines (large display text)

- **Max 8 words.** Cut ruthlessly.
- Verb-forward. Lead with the action.
- Fragment-friendly: `Lambda cold start — 900ms.` not `Lambda Has a Cold Start of Approximately 900 Milliseconds.`
- Use em-dash (—) for dramatic pause or context break.
- Service / API names are fine on screen — they're the thing. Don't paraphrase `S3` to "object storage" if the video is about S3.
- Avoid acronym soup; expand obscure ones once, then use them.

Good: `Lambda cold start — 900ms.`
Bad: `AWS Lambda's First Invocation Latency Is Approximately 900 Milliseconds at the 99th Percentile`

Good: `One config line. 90% off.`
Bad: `Enabling Prompt Caching Reduces Input Token Costs by Approximately 90 Percent on Cache Hits`

Good: `RAG isn't an LLM problem.`
Bad: `Retrieval-Augmented Generation Performance Is Often Bottlenecked by the Underlying Search Pipeline`

---

## Section Labels (small uppercase tags)

- Single word or short phrase.
- Always render uppercase in CSS — write in title case in the source.
- Examples: `Background`, `What is it?`, `The Tradeoff`, `In Production`, `Pricing`, `Key Numbers`, `The Mechanism`, `Common Mistake`, `The Fix`

---

## On-Screen Body Copy

- Max 2 sentences per scene. Tight.
- Subject → verb → object. No passive voice.
- Numbers: spell out under ten, use digits for 10+. Percentages always digits: `20%`, not "twenty percent".
- The spoken script.md may use digits with `> say:` cues for the human reader; on-screen text uses digits because they read faster.

---

## Statistics & Numbers (on screen)

- Round to a meaningful precision: `~250ms` is fine, `247.3ms` is noise.
- Always pair a stat with context: `90%` + `cheaper on cache hit`.
- Latency: prefer `ms` over fractional seconds. Cost: include the unit (`/req`, `/GB`, `/1k tokens`).

---

## Dates & Times

- Release dates: `Released April 2026` is usually enough.
- Version numbers: `Node 20`, `Postgres 17`, `Claude 4.7` — keep them.
- "Since X" framings work for trend claims: `since the GA in re:Invent 2025`.

---

## What to Avoid

- Clickbait framing (`You won't believe…`)
- Sensationalism (`SHOCKING`, `EXPLOSIVE`)
- Hedging when the fact is confirmed
- Padding text to fill time on screen
- Repeating the same information across scenes — each scene should show new information
