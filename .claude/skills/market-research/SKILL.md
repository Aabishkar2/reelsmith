---
name: market-research
description: Score a script or topic against the channel's YouTube Shorts market research. Use whenever the user asks "what gets views", "score this script", "is this topic worth it", "will this do numbers", or wants the scoring rubric run against a draft. Also invoked automatically by the script-writing skill as its mandatory final step before presenting a script to the user.
---

# Market Research Skill

Reads `config/market.md` — a one-time deep dive into what makes YouTube Shorts explainers perform (2026) — and applies it in two ways: (1) score a written script against the §11 rubric, (2) use the §8 topic-selection signals when suggesting or evaluating topics, working alongside `BIDS.MD`'s topic workflow.

`config/market.md` is the source of truth. Don't paraphrase its rules from memory — re-read it each time; it may be updated.

---

## Mode 1 — Score a script

Trigger: "score this script", the script-writing skill's final step, or any request to check a script against the market rules.

### Steps

1. Read `config/market.md` §11 (Scoring rubric) and the TL;DR at the top.
2. Read the target `videos/<name>/script.md`: `## Script`, `## Scene Hints` and `## Blueprint`. Read the video's `research.md` too (for G17).
3. Compute the spoken word count and the spoken-word position where each line starts. Count digits and acronyms as read aloud (market.md §11 preamble), use only the lines inside `### Scene N` blocks, and never count `>` cues. Rough duration is `words / 2.9 ≈ seconds`; compare it to the 45–65 s / 130–170 word target. You need the positions for word 25 (rows 1, 5, 6) and the 40–55% turn window (row 8).
4. Score every rubric row 1–18 as yes/no. **Every "yes" cites the line ids (or the section) it relies on**; a "yes" without ids is a "no". Be literal, don't round up, and when a check is ambiguous, mark it no and say why.
   - **[H] rows** (#3 frame-0 overlay, #14 visuals) are scored against `## Scene Hints`. Missing hints, or no frame-0 overlay on scene 1, means no.
   - **[B] rows** (#2 hook tournament, #4 through-line, #6 loop ledger, #7 tagged transitions, #12 blind read) are scored against `## Blueprint` **and** the lines. Missing Blueprint means no. A Blueprint claim the lines contradict is also no: a declared single villain with a second cause in s5.2 fails #4.
   - **#12:** compare the final blind-read round's lines with `## Script` word for word. Any drift means the read is stale, so the row is no. Check that the log says the reader was a fresh subagent given only the title and lines.
5. Sum the weights of every "yes" to get the score out of 100.
6. Check the five hard gates independently. They are pass/fail regardless of the total:
   - **G1** (row 1, hook): s1.1 ≤12 spoken words, a specific claim (cost/contradiction/number/failure) about a named tech. s1.1 or s1.2 addresses the viewer's system, money or belief. The hook confirms the title. No greeting, "in this video", "let's dive in" or generic question ("have you ever wondered…", "did you know…"); no acronym the viewer wouldn't recognize instantly (market.md §10).
   - **G4** (row 4, through-line): one Core Question and exactly one villain in the Angle block; every scene advances it; no line adds a second cause of the failure. The "when not to bother" line (row 10) passes only if it follows from the same villain or mechanism.
   - **G12** (row 12, blind read): a fresh-subagent log whose lines match `## Script`, with zero LEAK rows and no swipe line in the final round.
   - **G16** (row 16, bans): zero banned phrases. That's market.md §10 ("delve", "underscore", "showcase", "crucial", "landscape", "unlock", "in today's fast-paced", "whether you're X or Y", "it's important to note", "not just X but Y", tidy triads, hype words like "game-changer"/"insane") plus the script-writing skill's `references/line-craft.md` §6 (label transitions, "it's not just X, it's Y", wrap-ups, "follow for more", "It launched [date], so…").
   - **G17** (row 17): every fact traces to a line in `research.md`; timely claims are dated in the overlay or inside a line that does other work.
7. Print the score table (check # · description · yes/no with line ids · weight earned) and the total. When the script-writing skill invokes you, it also writes this table under `## Score` in script.md.
8. Verdict:
   - **Score ≥80 AND all 5 gates pass → PASS.**
   - **70–79 → FIX:** list exactly which failed checks to address, in priority order (gates first, then the highest-weight failures).
   - **<70 → REWRITE:** the script needs restructuring, not patching. Say which beats are missing or misordered (Question Arc: Hook → Stakes → Mechanism → Turn → Proof & Rule → Callback).
   - **Any gate fails → FAIL regardless of total score.** State which gate and why, even if the sum is ≥80.

### Output format

```
## Market score — <video-name>

Words: <N> spoken (~<Nsec>s at 2.9 wps) — target 130–170 words / 45–65s. Turn starts at word <n> (<pct>%).

| # | Check | Y/N (line ids) | Wt | Earned |
|---|---|---|---|---|
| 1 G | Hook: s1.1 ≤12, specific, named tech; you/your in s1.1–s1.2; confirms title | Y: s1.1 "…" (11 words), "your" in s1.1 | 8 | 8 |
...
| 18 | Judgment line that carries weight | ... | 3 | ... |
|   | **Total** | | **100** | **<score>** |

Gates: G1 <pass/fail> · G4 <pass/fail> · G12 <pass/fail> · G16 <pass/fail> · G17 <pass/fail>

**Verdict: PASS / FIX / REWRITE / FAIL** — <one line why>
<if not PASS: bullet list of what to change, worst offenders first>
```

---

## Mode 2 — Topic signals (works with BIDS.MD)

Trigger: "what gets views", "is this topic worth it", or when `BIDS.MD`'s Step 2 ("Score against the pillars") is running and you want the market lens alongside the pillar lens.

Apply `config/market.md` §8 (Topic selection signals) on top of BIDS.MD's pillar fit:

- **News peg, evergreen payload** — favor topics tied to something that shipped/broke/trended in the last 1–2 weeks, but built so the underlying lesson doesn't expire (§8, §9).
- **Format ranking** (§8, weakest to strongest last-first as listed): "what is X" is the weakest opener; scale/case-study ("how Netflix does X"), "why is X so fast/expensive", incident+number, and X-vs-Y rank higher. Prefer higher-ranked formats when multiple candidate topics are otherwise equal.
- **Niche ceiling** — a topic framed as AWS-only (or tool-only) trivia caps low; reframe through universal pain (the bill, an outage, latency) and lead with the consequence.
- **Freshness window** — a news explainer has roughly a 1–2 week shelf life before impressions drop off; don't suggest topics already stale by more than ~2 weeks unless framed as evergreen.
- When presenting topic suggestions (BIDS.MD Step 3 format), add a one-line "Market fit" note per suggestion citing which format-ranking tier it hits and whether it's news-pegged or evergreen.

---

## Phase 2 (not implemented): per-topic YouTube Data API pull

**Do not attempt this yet.** This section documents the planned design only, per `docs/spec.md` (market research is a one-time deep dive; per-topic API research is a later phase, stub only).

Planned flow, once built:

- **APIs:** YouTube Data API v3 `search.list` (find candidate videos for a topic/query) + `videos.list` (fetch details for those video IDs: `title`, `contentDetails.duration`, `statistics.viewCount`, `snippet.publishedAt`, `snippet.channelId`) + a follow-up `channels.list` call for `statistics.subscriberCount` per channel.
- **Derived metric:** `views / days-since-published` (views/day) as the primary comparability signal across videos of different ages, rather than raw view count.
- **Clustering:** group returned titles by pattern (ordinal-led, "why is X", "X vs Y", scale-number, incident+number — the same buckets market.md §2/§8 already name) to see which title shapes are currently working for this specific topic, not just historically.
- **Output:** `videos/<name>/market-topic.md` — a per-topic supplement to `config/market.md`, with the pulled videos, views/day, channel subscriber counts, and the title-pattern cluster this topic should imitate.
- **Requirements:** `YOUTUBE_API_KEY` env var. YouTube Data API v3 default quota is 10,000 units/day; `search.list` costs 100 units/call, so budget queries carefully (a handful of topic pulls per day, not a bulk crawl).
- **Status:** stub only. Do not write `scripts/`, call the API, or fabricate a `market-topic.md` output. If a user asks for this, tell them it's a documented but unimplemented Phase 2 and point them at this section.
