

---

## Problem Statement

Dealers buy and sell watches through **private WhatsApp group chats**  members post things like "WTB Rolex Submariner 116610LN $14k" or "ISO AP Royal Oak 15500, mint, paying well". We want to capture every one of these trade messages so we can act on them (quote, buy, sell).

**The problem: WhatsApp has no official API.**

We use **Wassenger**, a third-party service that connects to WhatsApp and exposes a REST API + webhooks on top of it. This lets us read and send messages without needing an official WhatsApp Business API account.

**Wassenger limitation: there is no endpoint to fetch all historical messages.**

Wassenger does not give us a way to pull the full message history of a group. The only thing it provides is a **webhook** — every time a new message arrives in any group we're listening to, Wassenger fires an HTTP POST to our server with the full message payload.

This means we have **one shot per message**: capture it when it arrives, or lose it. That is the core reason this webhook server exists.

### Sample webhook payload

This is what Wassenger sends us for every new inbound message:

```json
{
    "id": "3EB0CB1EC6CF84F86E7DFA",
    "object": "message",
    "event": "message:in:new",
    "created": 1779185675,
    "device": {
        "id": "6889167b0858142638fd9186",
        "phone": "+13053817705",
        "alias": "Brickell-Watches",
        "plan": "io-professional"
    },
    "data": {
        "id": "3EB0CB1EC6CF84F86E7DFA",
        "type": "image",
        "flow": "inbound",
        "status": "active",
        "ack": "delivered",
        "from": "120363146178687348@g.us",
        "fromNumber": "+85251004758",
        "to": "13053817705@c.us",
        "toNumber": "+13053817705",
        "date": "2026-05-19T10:14:35.000Z",
        "timestamp": 1779185675,
        "body": "Looking for rm30-01 white2026 ",
        "reactions": [],
        "author": "85251004758@c.us",
        "chat": {
            "id": "120363146178687348@g.us",
            "name": "Arkad Timepiece Trading",
            "date": "2026-05-19T10:14:35.000Z",
            "type": "group",
            "status": "pending",
            "waStatus": "active",
            "group": {
                "description": "Group rules\n\n- Only posts regarding watch purchases/sales and reference checks are allowed.",
                "owner": "13055378985@c.us",
                "totalParticipants": 289
            }
        },
        "media": {
            "id": "6a0c380f5695f0b37a00faac",
            "type": "image",
            "caption": "Looking for rm30-01 white2026 ",
            "mime": "image/jpeg",
            "size": 339070
        },
        "meta": {
            "isGroup": true,
            "isNotification": false,
            "isBizNotification": false,
            "isForwarded": false
        }
    }
}
```

Key fields we use:

| Field | Where | What we use it for |
|-------|-------|--------------------|
| `event` | root | filter — only `message:in:new` is processed |
| `data.id` | data | dedup key (same message never processed twice) |
| `data.flow` | data | must be `"inbound"` — we ignore our own outbound messages |
| `data.type` | data | must be `"text"` or `"image"` — we skip audio, stickers, etc. |
| `data.body` | data | the actual message text we classify |
| `data.fromNumber` | data | sender's phone number |
| `data.chat.id` | data | which group the message came from |
| `data.timestamp` | data | when the message was sent |
| `data.meta.isNotification` | data | system messages (group join/leave) — we skip these |

---

## Overview

Every WhatsApp message goes through two phases:

1. **Receive & Queue** — happens immediately, synchronously, while Wassenger is waiting for our HTTP response
2. **Process** — happens in the background, asynchronously, after we've already replied

---

## Phase 1 — Receive & Queue

```
Wassenger → POST /webhook → filter → pg-boss queue
```

When Wassenger sends us a webhook:

1. We check the event type. Only `message:in:new` moves forward — everything else gets a `200 {ok: true}` and is ignored.
2. The message goes into the **pg-boss queue**. If Wassenger sends the same message twice (it retries on failure), pg-boss automatically discards the duplicate using the message ID as a dedup key.
3. We return `200 {ok: true}` to Wassenger immediately.

That's it for Phase 1. Fast, no heavy work.

---

## Phase 2 — Processing (async worker)

The worker picks up jobs from the queue and runs **4 steps in order**:

---

### Step ① — Save the raw message

The full raw message is saved to the **`messages` table** right away — before we do anything else.

We also decide if the message is **relevant**:

| Condition | Result |
|-----------|--------|
| Message is outbound (sent by us) | `is_relevant = false`, `skip_reason = "outbound"` |
| Message is not text or image | `is_relevant = false`, `skip_reason = "non_text_or_image"` |
| Message is a system/notification | `is_relevant = false`, `skip_reason = "notification"` |
| Message body is empty | `is_relevant = false`, `skip_reason = "empty_body"` |
| Everything else | `is_relevant = true` |

If `is_relevant = false` → **stop here.** The message is saved but no further processing.

---

### Step ② — Clean the text

WhatsApp inserts invisible formatting characters into messages and appends things like `image omitted` at the end. We strip all of that so the next step works on clean text.

If nothing is left after cleaning → **stop here.**

---

### Step ③ — Classify intent + extract fields

We read the cleaned message and figure out what the sender wants:

| Intent | Meaning | How it's detected |
|--------|---------|------------------|
| `WTB`  | Want to Buy | keyword: `wtb`, `want to buy`, `ltb` |
| `ISO`  | In Search Of | keyword: `iso`, `looking for`, `in search of` |
| `NTQ`  | Need to Quote | keyword: `ntq`, `need to quote` |
| `WTT`  | Want to Trade | keyword: `wtt`, `want to trade`, `swap` |
| `WTS`  | Want to Sell | inferred from price + ref/brand in the message |
| `SKIP` | Can't classify | nothing matched |

We also pull out:
- **Price** — `$15,000`, `15k`, `15,000` → stored as a number
- **Watch reference** — e.g. `116610LN`, `5711/1A`
- **Condition** — `BNIB`, `unworn`, `mint`, `used`, `preowned`, etc.

---

### Step ④ — Atomic write

Three things get saved in a single database transaction (all succeed or all fail):

| Write | Table | When |
|-------|-------|------|
| Cleaned + classified message | `cleaned_messages` | Always |
| Trade lead | `deals` | Only if intent ≠ `SKIP` |
| Timestamp stamp | `messages.processed_at` | Always |

If anything fails, the entire transaction rolls back and the worker retries the job (up to 3 times with a 5-second delay between attempts).

---

## Database tables

| Table | What it stores |
|-------|---------------|
| `messages` | Every raw inbound message, the full original payload |
| `cleaned_messages` | Cleaned text, intent, confidence, extracted fields |
| `deals` | Actionable trade leads (WTB / WTS / ISO / NTQ / WTT) |
| `groups` | WhatsApp groups synced from Wassenger |
| `users` | Group members |

---

![[Pasted image 20260519151904.png]]

Admin portal to get idea of data being saved:

https://wassenger-save-message-frontend.vercel.app/login

name: admin
password: admin@12 