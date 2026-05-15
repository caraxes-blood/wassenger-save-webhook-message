# ADR 0001 — Inline cleaning in the pg-boss worker

**Status:** Accepted

## Context

Two candidate architectures for running the cleaning pipeline:
1. A separate Python service (or Node.js service) that polls `messages` every N seconds
2. A second pg-boss queue fed by the existing worker
3. Inline in the existing worker — after inserting into `messages`, immediately clean and write to `cleaned_messages` + `deals`

## Decision

Run cleaning inline in the existing pg-boss worker (option 3).

## Reasons

- The cleaning pipeline is pure in-memory regex — it adds ~1ms per message, no I/O.
- Eliminates a polling service entirely: no second process, no deployment, no 90-second latency window.
- pg-boss already provides retry (up to 3 attempts, 5s delay) and `ON CONFLICT DO NOTHING` on `messages` makes the full job idempotent.
- The existing worker processes one message per job — inline cleaning preserves that unit of work cleanly.

## Trade-off

If cleaning logic grows complex (e.g. external API calls, slow ML inference), inline becomes a bottleneck. At that point, promote to a second pg-boss queue. For pure-regex classification this is not a concern.
