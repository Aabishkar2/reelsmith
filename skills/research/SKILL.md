---
name: research
description: Deeply research a topic, release, incident or URL before a script is written. Use whenever the user shares a topic, URL or release/incident and wants a video made from it, OR whenever the script-writing skill would run but no approved `research.md` exists in the target video folder. Trigger on "research this", "dig into this", "find me the angle", "make a video about X", or any topic prompt before scripting. Produces `videos/<name>/research.md` with `Status: DRAFT`; only the user's "approved" flips it to APPROVED.
---

# Research skill

Takes a topic, URL, or release/incident and produces a structured `videos/<name>/research.md` that the script-writing skill consumes. This is the **evidence** phase. Script writing does not start until this file passes its checklist and the user has approved it.

The project's content pillars, audience and lens live in `config/strategy.md`. Read it first. The rules below apply to every pillar; only the type of source changes.

If the video folder does not exist yet, create it with `reelsmith new <name>` (it also writes the `script.md` template).

---

## Why this skill exists

The script-writing skill needs specific names, specific numbers and concrete tradeoffs. You cannot meet that bar from one landing page or a two-source scan. Shallow research forces either fabrication or vagueness ("makes things faster", "it scales"). This skill prevents both.

---

## Minimum bar: every research.md contains

A research.md that fails any of these is **not done**. Go back and dig.

### 1. Five or more primary sources, mixed types

At least one from each category that fits the pillar:

| Category | Examples |
|---|---|
| Official primary | Vendor docs and changelogs, model provider docs, language/runtime release notes, RFCs |
| Engineering deep-dive | Company engineering blogs, SRE and postmortem writeups |
| Practitioner / community | A top Hacker News thread, lobste.rs, respected individual blogs, conference talks |
| Reference / spec | API reference, SDK source on GitHub, architecture diagrams, pricing pages |
| Comparative / analytical | Independent analyses, benchmarks with methodology, arXiv papers |

Swap categories to fit the pillar: a model card or SDK changelog for AI topics, a real production postmortem for engineering craft, release notes plus a credible workflow writeup for tools.

### 2. One or more concrete usage examples

A real, runnable example or a real production scenario. Not "developers use it for various tasks", but: *Stripe puts an idempotency key on every mutating POST; the key is a client-generated UUID stored for 24 h, and a duplicate request gets the original response.* If you cannot find or construct one, the topic is not ready.

### 3. Three or more specific numbers, each with source and date

Not "fast", not "cheap". Format:

> `Lambda cold start for a Node 20 function: ~250 ms p50, ~900 ms p99 [AWS Lambda Power Tuning, 2025]`
> `S3 GET request: $0.0004 per 1k requests in us-east-1 [AWS Pricing, 2026-04]`

Zero ratios, benchmarks, prices or latencies means the research is not done.

### 4. One or more tradeoffs or counterintuitive truths

Every choice has a cost. Find the non-obvious one:

- Single-table DynamoDB: faster reads, but query patterns are locked at design time
- RAG over fine-tuning: cheaper to update, but retrieval quality becomes your ceiling
- Cursor pagination: consistent under writes, but you cannot jump to page 50

If you cannot name the tradeoff, you have not understood the topic yet.

### 5. Two or three angle options from evidence

Offer the script writer **2 to 3 angles**. Each angle is a different Core Question with **exactly one villain** (one cause of the failure or confusion). Fill every field of `## Angle options` from evidence already in the file.

- **No pre-written hook line.** The script-writing skill writes the hook itself.
- **No compound thesis.** "It pays only when X *and* Y" is two villains, so make it two angles.
- Angles differ in Core Question or villain, not just in wording.

---

## Output: `videos/<name>/research.md`

Keep this exact structure. The script-writing skill relies on the section headers.

```markdown
# Research: <Topic title>

Pillar: <slug from config/strategy.md>   (same value as script.md `topic`)
Date researched: YYYY-MM-DD
Status: DRAFT   (this skill always writes DRAFT; only the user's "approved" flips it to APPROVED)

## TL;DR
<3 to 5 lines: what the topic is, why it matters to the viewer, which angle looks strongest>

## Angle options
<2 to 3 angles. One villain each. No hook line, no compound thesis.>

### Angle A: <short name>
- Promise: "After this you'll know why <X> and how to <Y>."
- Core Question: <the one question the viewer holds all video>
- Misconception: <what the viewer believes now>
- Villain: <exactly one cause>
- Receipt: <something the viewer can check themselves: a field, metric, log line, setting>
- Rule: <the fix, 12 spoken words or fewer>
- Callback-word candidates: <2 to 3 words the hook can plant and the last line can reuse>
- Evidence: <the Sources / Specific numbers / gotcha lines that back each field>
- Surprise / relevance / provability: <1 to 5 each, with a clause of why>

### Angle B: <short name>
...

## Sources
- [Outlet/Doc, YYYY-MM-DD] <url> — <1-line summary of what this source gives us>
- (minimum 5)

## Specific numbers
- <stat> [source, date]
- (minimum 3)

## Named entities
### Services / tools / libraries
- <Name, what it does, why it matters here>
### People (optional)
- <Name, role, relevance>
### Companies / projects
- <Entity, role>

## Concrete usage example
<A real runnable example, code snippet or production scenario. Cite the source.>

## Tradeoff / counterintuitive truth
<One paragraph: what it costs, what it buys, when the simple alternative wins.>

## Common mistakes / gotchas
<Bullets: anti-patterns, footguns, "the docs don't tell you this".>

## Visual targets
<2 to 4 visual ideas per beat, grouped by beat (not by scene: scenes don't exist yet).
Prefer self-authored visuals: code, diagrams, terminal output, console screenshots.>

Hook: ...
What it is: ...
How it works: ...
Why it matters: ...
What to do: ...
Close: ...

## Why the viewer should care
<1 to 2 sentences: what the viewer does differently after watching. If "nothing", the topic isn't ready.>

## Open questions
<Anything uncertain, conflicting across sources, or worth flagging to the user.>
```

Visual target rules:

- At least 2 visuals per beat (a scene longer than 3 s needs 2 or more for cuts).
- First visual: the concept (diagram or screenshot). Second: the evidence (number, log line, benchmark).
- Label each visual with its beat. The beats are the script-writing skill's shape: Hook, What it is, How it works, Why it matters, What to do, Close.

---

## Workflow

### 1. Triage the input

- **URL** (release notes, blog post, doc): open it with WebFetch, or a browser tool if one is available. Extract the core claim, version/date and named APIs. This is source 1 of 5 or more. Do not stop here.
- **Topic:** scan official docs, recent release notes and 1 to 2 high-signal practitioner sources. Pick the freshest angle.
- **Pasted notes or code:** one source among many. Verify each claim against an official source.

### 2. Expand sources in parallel

Fetch 5 or more sources across the categories table with parallel tool calls or a subagent. For each source capture: outlet, date, URL, and the single most useful fact it contributes.

### 3. Hunt for the specific

After the first pass, do a second pass for what is still missing:

- A real production example (`"<topic>" production`, `"<topic>" postmortem`)
- Three specific numbers with sources
- The tradeoff (`"<topic>" vs <alternative>`, `"<topic>" gotchas`)

The second pass is not optional when the first one missed these.

### 4. Draft 2 to 3 angles from evidence

List every distinct thing that can go wrong (each is a candidate villain). Build 2 to 3 angles, one villain each. If a field cannot be filled (no receipt, no misconception anyone holds), drop that angle or dig more.

### 5. Write `videos/<name>/research.md`

Use the template above. Keep the headers verbatim. Write `Status: DRAFT`, never APPROVED.

### 6. Run the checklist

Every answer must be YES. Otherwise go back to step 2.

### 7. Present and ask for approval

Show the user in chat:

- The 3-line TL;DR
- The angle options, one line each (Core Question and villain)
- Open questions or gaps

**Gate:** wait for approval or "dig deeper on X". Only the user approves. When they say "approved", change the line to `Status: APPROVED`, then hand off. Never set APPROVED on your own judgment.

---

## Checklist

1. Five or more primary sources, mixed types?
2. Three or more specific numbers, each with source and date?
3. One or more concrete usage examples?
4. One or more tradeoffs or counterintuitive truths?
5. Two or three angles, each with Promise, Core Question, Misconception, exactly one Villain, Receipt, Rule (12 words or fewer) and callback-word candidates, all backed by evidence in the file?
6. No pre-written hook line and no compound thesis?
7. "Why the viewer should care" answered concretely?
8. Visual targets: 2 to 4 per beat, grouped by beat?

---

## Tone of the research

Research notes are not the script. Write plainly, keep context and nuance. The script distills; the research preserves.

Never fabricate. Mark unconfirmed facts (`UNCONFIRMED`, `per one outlet only`, `single benchmark, methodology unclear`). The script never claims something the research did not verify.

---

## Handoff to script-writing

Once the user has approved `research.md` and you have set `Status: APPROVED`, run the script-writing skill with this file as input. It picks one angle and defers the others. The script cannot include a fact that does not trace to a line in research.md. If the writer needs something missing, come back here, do another pass and update research.md before resuming.
