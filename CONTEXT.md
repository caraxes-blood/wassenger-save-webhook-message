# Domain Context — Wassenger Webhook Server

## Core Terms

**Message**
A WhatsApp message received via the Wassenger webhook. Persisted to the `messages` table. Carries the raw Wassenger payload as JSONB.

**Relevant Message**
A Message that passes the relevance filter: inbound, text or image type, not a system notification, non-empty body. Stored with `is_relevant = true`. Only Relevant Messages enter the cleaning pipeline.

**Cleaned Message**
A Relevant Message after the cleaning pipeline runs. Stored in `cleaned_messages`. Every Relevant Message with a non-empty body after cleaning produces exactly one Cleaned Message (enforced by `UNIQUE (message_id)`).

**Intent**
The trading purpose inferred from a Cleaned Message body. One of:
- `WTS` — want to sell (explicit keyword or inferred from price + ref signals)
- `WTB` — want to buy
- `ISO` — in search of
- `NTQ` — need to quote (sourcing for a client)
- `SOLD_ORDER` — already sold, urgently sourcing
- `WTT` — want to trade/swap
- `SKIP` — system event, greeting, or unclassifiable noise

**Deal**
A Cleaned Message whose Intent is not SKIP. Stored in `deals`. Represents an actionable trading signal. One Deal per (message, source) pair — currently `source = 'rules'`; future AI pipeline uses `source = 'ai'`.

**Cleaning Pipeline**
The in-process step that runs inside the pg-boss worker after a Message is inserted. Cleans the body text (invisible chars, emoji numbers, media placeholders), detects system messages, classifies Intent, and extracts structured fields (price, watch ref, condition). Pure regex — no external services.

**Source**
Which pipeline produced a Deal. `'rules'` = the regex-based cleaning pipeline. `'ai'` = reserved for a future AI classification pass.
