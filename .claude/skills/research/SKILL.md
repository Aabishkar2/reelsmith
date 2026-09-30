---
name: research
description: Deeply research a technical topic, release, incident, or URL before a script is written. Use this skill whenever the user shares a topic, URL, or release/incident and wants a video made from it, OR whenever the script-writing skill would be invoked but no `research.md` exists yet in the target video folder. Trigger on: "research this", "dig into this", "find me the angle", "make a video about X", or any topic prompt before scripting. Produces a structured `research.md` that the script-writing skill consumes.
---

# Technical Research Skill

Takes a topic, URL, or release/incident and produces a structured `research.md` that the script-writing skill will consume. This skill is the **evidence gathering** phase — script-writing cannot run until this passes its checklist.

Covers all four channel pillars (see `BIDS.MD`): **AWS & Cloud**, **AI & ML for Engineers**, **Software Engineering Craft**, **Developer Tools & Workflow**. The same rules apply across pillars; only the *type* of source changes.

---

## Why this skill exists

`.claude/skills/script-writing/SKILL.md` demands specific named services, specific numbers, specific code-level details, and concrete tradeoffs. You cannot meet that bar from a single landing-page snapshot or a 2-source scan. Shallow research forces either fabrication or vagueness ("makes things faster", "it scales"). This skill prevents both.

---

## Minimum bar — every research.md must contain

A research.md that fails any of these is **not done**. Go back and dig more.

### 1. ≥5 primary sources, mixed types

At minimum one from each category below where relevant to the pillar:

| Category | Examples |
|---|---|
| Official primary | AWS docs / What's New, model provider docs (Anthropic/OpenAI/Google), language/runtime release notes, RFCs |
| Engineering deep-dive | Company engineering blogs (Netflix, Stripe, Cloudflare, Discord), SRE/postmortem writeups |
| Practitioner / community | Hacker News top thread, lobste.rs, well-regarded individual blogs (Brendan Gregg, Hillel Wayne, Julia Evans, Simon Willison), conference talks |
| Reference / spec | API reference, SDK source on GitHub, architecture diagrams, pricing pages, IAM policy docs |
| Comparative / analytical | SemiAnalysis, LWN, BIS-style technical analyses, benchmarks (with methodology), arXiv for AI/ML |

For AWS swap "engineering deep-dive" for "service-team blog or re:Invent talk". For AI/ML swap for "model card / paper / SDK changelog". For Software Engineering swap for "a real production postmortem". For Developer Tools swap for "release notes + a credible practitioner workflow writeup".

### 2. ≥1 concrete usage example

A real, runnable example or a real production scenario where this applies. Not "developers use it for various tasks" — *Stripe uses idempotency keys on every POST that mutates state; the key is a UUID generated client-side, stored in Redis for 24h, and short-circuits duplicate requests with the original response.* If you can't find or construct one, the topic isn't ready.

### 3. ≥3 specific numbers, each with source and date

Not "fast", not "cheap", not vague claims. Format:

> `Lambda cold start for a Node 20 function: ~250ms p50, ~900ms p99 [AWS Lambda Power Tuning, 2025]`
> `S3 GET request: $0.0004 per 1k requests in us-east-1 [AWS Pricing, 2026-04]`
> `Claude prompt caching: 90% input cost reduction on cache hit [Anthropic docs, 2025-08]`

If the research produces zero ratios, zero benchmarks, or zero pricing/latency anchors, it's not done.

### 4. ≥1 tradeoff or counterintuitive truth

The channel's analytical lens is *"mental model + tradeoff + concrete example"* (BIDS.md). Every technical choice has a cost. Find the non-obvious one. Examples:

- Single-table DynamoDB → faster reads, but query patterns must be locked at design time
- Lambda over containers → simpler ops, but cold starts and concurrency limits become your problem
- RAG over fine-tuning → cheaper to update, but retrieval quality becomes your ceiling
- Cursor pagination → consistent under writes, but you can't jump to page 50
- gRPC over REST → faster + typed, but every browser/curl/proxy story gets harder

If you can't name the tradeoff, you haven't understood the topic yet.

### 5. 2–3 angle options from evidence

Offer the script-writer **2–3 angles**. Each angle is a different Core Question with **exactly one villain** (one cause of the failure). Fill every field (see `## Angle options` below) from evidence already in this file.

- **No pre-written hook line.** The script-writing skill writes ten hooks and tests them; a hook written here anchors it on one untested line.
- **No compound thesis.** "It pays only when X *and* Y" is two villains, so make it two angles. The script picks one and defers the other.
- The angles must differ in Core Question or villain, not just in wording.

---

## Output artifact — `videos/<name>/research.md`

Exact structure below. Keep it this shape — the script-writing skill relies on the section headers.

```markdown
# Research: <Topic title>

Pillar: aws | ai-ml | swe | devtools   (same value as script.md `topic`, e.g. `ai-ml`)
Date researched: YYYY-MM-DD
Status: DRAFT   (this skill always writes DRAFT; only the user's "approved" flips it to APPROVED)

## TL;DR
<3-5 line summary: what the topic is, why it matters to a working engineer, what the channel angle is>

## Angle options
<2–3 angles. One villain each. No hook line, no compound thesis.>

### Angle A — <short name>
- Promise: "After this you'll know why <X> and how to <Y>."
- Core Question: <the one question the viewer holds all video>
- Misconception: <what the viewer believes now, which the turn will break>
- Villain: <exactly one cause of the failure>
- Receipt: <something the viewer can check on their own system: a field, metric, log line, console value>
- Rule: <the fix, ≤12 spoken words>
- Callback-word candidates: <2–3 words the hook can plant and the last line can reuse>
- Evidence: <the Sources / Specific numbers / gotcha lines above that back each field>
- Surprise / Monday relevance / provability: <1–5 each, a clause of why>

### Angle B — <short name>
...

## Sources
- [Outlet/Doc, YYYY-MM-DD] <url> — <1-line summary of what this source gives us>
- [Outlet/Doc, YYYY-MM-DD] <url> — ...
- (minimum 5)

## Specific numbers
- <stat> [source, date]
- <stat> [source, date]
- <stat> [source, date]
- (minimum 3)

## Named entities
### Services / tools / libraries
- <Name, what it does, why it matters here>
### People (optional — practitioners, authors, speakers)
- <Name, role, relevance>
### Companies / projects
- <Entity, role>

## Concrete usage example
<A real runnable example, code snippet, or production scenario. Full paragraph or fenced code block. Cite the source.>

## Tradeoff / counterintuitive truth
<One paragraph: what the topic costs you, what it buys you, when the simple alternative wins.>

## Common mistakes / gotchas
<Bullet list of anti-patterns, footguns, or "the docs don't tell you this" facts.>

## Visual targets
<2–4 visual ideas per beat — feeds the image/diagram pipeline. For technical content, prefer
self-authored visuals: code screenshots, architecture diagrams, console screenshots, terminal
output, flow diagrams. Use stock only for generic backdrops. Group by beat, not by scene
number — scene boundaries don't exist yet; the script-writer maps beats to scenes.>

Hook: code snippet (Lambda handler with cold-start log), latency spike on the first request
Stakes: latency graph (p50 vs p99), AWS console screenshot (Lambda Init Duration metric)
Mechanism: architecture diagram (S3 event → Lambda → new execution environment)
Turn: side-by-side: burst of 50 uploads = 50 cold starts
Proof & Rule: the metric to check, provisioned concurrency vs on-demand cost calculation
Callback: ...

Rules:
- At least 2 visuals per beat (a scene >3s always needs ≥2 to support visual cuts).
- First visual: the concept (diagram or screenshot). Second: the evidence (number, log line, benchmark).
- Prefer self-authored diagrams and screenshots. Stock photos only for generic backdrops.
- Label each visual with its beat (the script-writing skill's Question Arc: Hook / Stakes / Mechanism / Turn / Proof & Rule / Callback) so the script-writer can carry it into whichever scene holds that beat.

## Why an engineer should care
<1-2 sentences — what does the viewer do differently on Monday morning after watching this? If "nothing", the topic isn't ready.>

## Open questions
<Anything still uncertain, conflicting across sources, or worth flagging to the user.>
```

---

## Workflow

### 1. Triage the input

- If the user gave a **URL** (release notes, blog post, doc): open it with camoufox or WebFetch, snapshot. Extract the core claim, version/date, named services/APIs. This is source #1 of ≥5 — do not stop here.
- If the user gave a **topic**: scan official docs, recent release notes, and 1–2 high-signal practitioner sources. Pick the freshest angle.
- If the user gave **pasted notes/code**: treat it as one source among many, then verify each claim against an official source.

### 2. Expand sources (parallel, aggressive)

Use the Agent tool (general agent) or parallel tool calls to fetch ≥5 sources across the categories table. Don't do this serially — fire them off in parallel.

For each source, capture:
- Outlet/doc, date, URL
- The single most useful fact it contributes (number, API name, code pattern, benchmark, gotcha)

### 3. Hunt for the specific

Most research fails on specificity. After the initial source pass, **do a second pass** explicitly looking for:
- A real production usage example (search `"<topic>" production` / `"<topic>" postmortem` / `"<topic>" at <CompanyName>`)
- Three specific numbers with sources (latency, cost, throughput, accuracy, token count, error rate)
- The tradeoff (search `"<topic>" vs <alternative>` / `"<topic>" downsides` / `"<topic>" gotchas`)

If the first pass didn't find them, the second pass is not optional.

### 4. Draft 2–3 angle options from evidence

Re-read what you gathered. List every distinct thing that can go wrong (each is a candidate villain), then build 2–3 angles, one villain each, and fill every field in `## Angle options` from evidence in the file. If a field can't be filled (no receipt the viewer can check, no misconception anyone holds), that angle isn't ready: dig more or drop it. The script-writing skill (or the user) picks one; the others become deferred notes or future videos.

### 5. Write `videos/<name>/research.md`

Use the exact template above. Keep section headers verbatim. Write `Status: DRAFT` — never APPROVED.

### 6. Run the pre-flight checklist

Before returning to the user, verify every answer is YES. If any is NO, go back to step 2.

### 7. Present summary + request approval

In chat, show the user:
- 3-line TL;DR
- Angle options, one line each (Core Question · villain)
- Any open questions or gaps

Wait for approval (or "dig deeper on X") before handing off to the script-writing skill. Only the user approves: when they say "approved", flip the line to `Status: APPROVED`, then hand off. Never set APPROVED on your own judgment.

---

## Pre-flight checklist

Before presenting research.md (still `Status: DRAFT`) to the user for approval:

1. ≥5 primary sources, mixed types?
2. ≥3 specific numbers, each with source + date?
3. ≥1 concrete usage example (real or constructed from a real source)?
4. ≥1 tradeoff or counterintuitive truth named?
5. 2–3 angle options, each with Promise, Core Question, Misconception, exactly one Villain, Receipt, Rule (≤12 words) and callback-word candidates, all backed by evidence in the file?
6. No pre-written hook line and no compound thesis (no "X *and* Y" villain)?
7. "Why an engineer should care" answered concretely (Monday-morning behavior change)?
8. Visual targets: **2–4 per beat** (≥2 per beat), grouped by beat (Hook / Stakes / Mechanism / Turn / Proof & Rule / Callback)?

If any answer is NO, keep researching. Do not hand off weak research — the script that comes out of it will fail SKILL.md's specificity rule and the video will feel generic.

---

## Tone of the research itself

Research notes are **not** the script. Write plainly, keep context, preserve nuance. The script distills; the research preserves. Don't over-condense during research — you will lose the specificity the script needs.

Never fabricate. If a fact isn't confirmed, mark it as such (`UNCONFIRMED`, `per one outlet only`, `from a single benchmark — methodology unclear`). The script will never claim something the research didn't verify.

---

## Handoff to script-writing

Once the user has approved `research.md` (and you've flipped it to `Status: APPROVED`), the script-writing skill is invoked with this file as input. It starts from `## Angle options`: it picks one angle, writes the hooks itself, and defers the other villains. The script cannot include any specific fact not traceable to a line in research.md. If the script writer needs something missing, control comes back here — do another research pass and update research.md before resuming.
