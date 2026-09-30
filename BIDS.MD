# BIDS — Channel Strategy & Topic Intelligence

## Agent Workflow: How to Suggest a Topic

When asked to suggest a video topic, follow these steps:

### Step 1 — Check what's happening now
Use the camoufox browser skill (or web search) to scan for recent activity across the channel's beats.
Visit 2–3 sources from the lists under each pillar (release notes, engineering blogs, HN front page, arXiv, AWS What's New, etc.).
Look for items that match a **Timely bid trigger** listed under each pillar.

### Step 2 — Score against the pillars
For each candidate, ask:
- Does it connect to a standing bid or recurring beat in any pillar?
- Can it be explained through the channel's lens (mental model + tradeoff + concrete example)?
- Will a working software engineer or cloud practitioner think *"oh, that's actually useful to know"* — not *"yet another hot take"*?

### Step 3 — Return 3–5 suggestions
Format each suggestion as:

> **[Topic title — sharp, 5–8 words]**
> Pillar: [AWS & Cloud / AI & ML / Software Engineering / Developer Tools]
> Why now: [1 sentence — what just shipped, broke, or got popular]
> Why this channel: [1 sentence — what unique angle/mental model this video brings]

Rules:
- Favor timely topics (something happened in the last 1–2 weeks) — but include 1 evergreen if release news is dry
- Prefer topics where a **tradeoff, gotcha, or counterintuitive truth** is the hook
- Do not suggest topics already covered (check `videos/` folder for existing video names)
- Order by strongest fit first

---

# Channel Identity

**Core promise to viewer:** "I just learned something I can use at work tomorrow."

**Voice:** Senior engineer explaining to a smart junior. Direct, practical, slightly opinionated. The tone is: "here's how this actually works, here's the gotcha, here's what to do." Never hype. Never "in this video we will explore" filler. Just the real picture, fast.

**Analytical lens:** Mental model + tradeoff + concrete example. For every concept: what is it really, what does it cost you, when do you reach for it vs. the alternative.

**Audience:** Software engineers, cloud/devops practitioners, AI/ML engineers, technical leads. Skewed toward people who already write code and are trying to level up — not absolute beginners.

**Content mix:** 50% timely (react to releases, incidents, new patterns within 1–2 weeks), 50% evergreen (mental models and gotchas that don't expire).

**Format:** YouTube Shorts. 45 to 65 seconds. Scripts run 130–170 words at ~170 wpm. First line ≤12 words, concrete. End with a takeaway the viewer can repeat.

---

## Content Pillars and Standing Bids

### 1. AWS & Cloud (Strongest Pillar)

**What this pillar is about:** How AWS services actually behave in production — the pricing traps, the consistency models, the failure modes, the patterns senior engineers reach for. Not the marketing page.

**Recurring beats to monitor:**
- AWS What's New (new services, GA announcements, region launches)
- IAM, networking (VPC, PrivateLink, Transit Gateway), and security primitives
- Serverless (Lambda, Step Functions, EventBridge, SQS/SNS) — cold starts, concurrency, idempotency
- Data services (S3, DynamoDB, Aurora, Redshift) — consistency, throughput, cost
- Cost / FinOps angles
- Outages and incident postmortems (AWS Health Dashboard, Hacker News)

**Standing bids** (always valid — research for the freshest angle):
- Why Lambda cold starts hurt more than you think — and the three real fixes
- DynamoDB single-table design, explained without the cargo cult
- The S3 strong-consistency change nobody fully understood
- VPC endpoints vs NAT gateways — when each one actually saves money
- IAM policy evaluation logic in 60 seconds (the order matters)
- Why your AWS bill doubled and the first three places to look
- ECS vs EKS vs Lambda for the same workload — the real tradeoffs
- Aurora Serverless v2 vs provisioned — when the math flips
- The Step Functions pattern that replaces half your Lambda glue code
- Why most "multi-region" setups aren't actually multi-region

**Timely bid triggers** (research immediately when these happen):
- Major AWS service GA or pricing change
- A widely-felt AWS outage (post-incident, with the postmortem)
- New Bedrock / SageMaker capability
- Security advisory affecting a common service
- re:Invent week (and the months after, as features quietly ship)

---

### 2. AI & ML for Engineers

**What this pillar is about:** What AI/ML tools actually do, how to use them in real systems, and where they break. Aimed at engineers integrating LLMs and ML into products — not researchers, not hype-watchers.

**Analytical lens:** What's the mental model, what does it cost (latency, tokens, accuracy, $), when do you pick this over the boring alternative.

**Standing bids:**
- RAG, explained as "search + prompt" — and why most RAG setups underperform plain search
- Prompt caching: the one optimization that pays for itself in a week
- Why agentic loops fail in production — and the three guardrails that fix them
- Embeddings vs. keyword search — when each one wins
- Fine-tuning vs. prompting vs. RAG — the decision tree
- Tool use / function calling: what actually happens under the hood
- Streaming responses — the UX vs. cost vs. error-handling tradeoff
- Evals: why "vibe checks" are killing your model rollouts
- Context windows are not free — the token-cost mental model
- Local LLMs (Ollama, llama.cpp) — what they're actually good for

**Timely bid triggers:**
- Major model releases (Claude, GPT, Gemini, Llama, Mistral, DeepSeek)
- New SDK features (caching, tools, batch, files, citations)
- Notable agent framework releases (LangGraph, CrewAI, etc.)
- Public eval results or benchmark shake-ups
- An AI feature in a major product that quietly changes the UX bar

---

### 3. Software Engineering Craft

**What this pillar is about:** The patterns, anti-patterns, and mental models that separate a working solution from a maintainable one. Language-agnostic where possible; concrete examples in TypeScript, Python, or Go.

**Analytical lens:** What does this pattern actually cost, what does it actually buy, and when is the simpler version genuinely better.

**Standing bids:**
- Idempotency keys, explained in 60 seconds (and why your retry logic is broken without them)
- The difference between "tested" and "tested at the seams that matter"
- Why feature flags become technical debt — and how to delete them on a schedule
- Database migrations on a live system: the expand–contract pattern
- Pessimistic vs. optimistic locking — the picture that finally makes it click
- Pagination: cursor vs. offset, and why offset is lying to you
- Backpressure: the queue is full, now what
- "Stop using exceptions for control flow" — the actual reason
- Caching is a distributed systems problem (and why your TTL is wrong)
- The difference between latency and throughput, with one diagram

**Timely bid triggers:**
- A widely-discussed outage with a clear engineering lesson
- A high-profile open-source security incident
- A popular language/runtime release with a notable feature (Node, Python, Go, Rust, TypeScript)
- A famous engineering blog post going viral on HN/Twitter

---

### 4. Developer Tools & Workflow

**What this pillar is about:** The tools and workflows that actually make engineers faster — not the ones with the prettiest landing page. Includes terminal, editors, AI coding assistants, CI, observability, and infra-as-code.

**Analytical lens:** What does this tool replace, what does it cost to adopt, and what does the workflow look like once it's wired in.

**Standing bids:**
- Claude Code / Cursor / Copilot — the workflow patterns that actually save time
- Terraform vs. Pulumi vs. CDK — picking the boring winner
- Observability without the vendor lock-in (OTel in 60 seconds)
- Why your CI is slow, ranked by likelihood
- Pre-commit hooks that pay for themselves
- The Git workflow nobody actually documents (rebase, fixup, range-diff)
- Datadog vs. open source: where the line actually is
- Containers in dev: when the dev-loop pain stops being worth it
- The one shell config change that saves five minutes a day
- Profiling > guessing — the cheapest perf wins are always in a flamegraph

**Timely bid triggers:**
- Major release of a developer tool (Cursor, Claude Code, Vercel, GitHub features)
- A widely-shared dev productivity post
- A new model or feature that meaningfully changes the AI-assisted coding workflow
- Tooling acquisitions or pivots (signals where the ecosystem is heading)
