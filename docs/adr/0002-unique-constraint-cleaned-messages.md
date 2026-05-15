# ADR 0002 — UNIQUE constraint on cleaned_messages.message_id

**Status:** Accepted

## Context

The cleaning writes (INSERT cleaned_messages → INSERT deals → UPDATE processed_at) are wrapped in an explicit transaction. If the transaction commits but pg-boss fails to acknowledge the job completion, pg-boss retries. On retry, the `messages` INSERT is idempotent via `ON CONFLICT DO NOTHING`. Without a uniqueness guarantee on `cleaned_messages`, the cleaning INSERT would produce a duplicate row.

Two options considered:
1. `SELECT processed_at FROM messages` guard check before cleaning — extra round-trip per message
2. `UNIQUE (message_id)` on `cleaned_messages` + `ON CONFLICT DO NOTHING` on the INSERT — database enforces it

## Decision

Add `CREATE UNIQUE INDEX IF NOT EXISTS` on `cleaned_messages (message_id)` and `deals (message_id, source)`.

Use `ON CONFLICT (message_id) DO NOTHING RETURNING id` on the `cleaned_messages` INSERT. If no row is returned, the message was already cleaned — skip remaining writes and return.

`deals` uses `(message_id, source)` rather than `(message_id)` alone to allow a future `source='ai'` deal alongside the existing `source='rules'` deal for the same message.

## Trade-off

The UNIQUE constraint prevents ever having two rule-based cleaned records for one message. This is the correct invariant; the constraint makes it explicit and removes a class of subtle bugs.
