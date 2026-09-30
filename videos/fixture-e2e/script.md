---
title: Why Lambda cold starts hurt
topic: aws
date: 2026-09-27
wpm: 150            # teleprompter speed
---

## Script

### Scene 1
S3 is the oldest and most widely used AWS service.
> say "S3" as "ess three"
It stores objects like files, logs, and backups.

### Scene 2
Lambda runs your code without any servers to manage.
But a cold start can add 900ms before your function even begins.
That delay happens every time a new container spins up.

### Scene 3
Provisioned concurrency keeps containers warm and ready.
It costs about $0.30 per hour for each warm instance.
For busy APIs, the price is worth paying.

### Scene 4
Measure your cold starts before you pay to remove them.
Follow for more AWS tips every week.
