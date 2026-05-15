# Inline Cleaning Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the regex-based WhatsApp message cleaning pipeline from the Python `deals-message-cleaning` repo into `wassenger-webhook-server/src/`, running it inline inside the existing pg-boss worker — eliminating the Python service entirely.

**Architecture:** After inserting each raw message into `messages`, the pg-boss worker immediately runs the cleaning pipeline (pure regex, no I/O) and writes the result to `cleaned_messages` + `deals` in one atomic transaction. A single `pg` client is held per job to avoid pool exhaustion at `teamSize: 5 / teamConcurrency: 5`. UNIQUE indexes on `cleaned_messages(message_id)` and `deals(message_id, source)` make all writes idempotent on pg-boss retry.

**Tech Stack:** Node.js 20 (ESM), Fastify 5, pg-boss 10, pg 8, Vitest 4, PostgreSQL

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/db/migrate.js` | Modify | Add two `CREATE UNIQUE INDEX IF NOT EXISTS` statements |
| `src/cleaning/pipeline.js` | Create | Pure cleaning functions: `cleanText`, `isSystem`, `classify`, `extractPrice`, `extractRef`, `extractCondition` |
| `src/db/cleaning.js` | Create | Three SQL helpers: `insertCleanedMessage`, `insertDeal`, `markProcessed` — all take `client`, not `pool` |
| `src/queue/worker.js` | Modify | Rewrite `processMessage` to use single client + inline cleaning transaction |
| `test/migrate.test.js` | Modify | Assert UNIQUE indexes exist in migration SQL |
| `test/cleaning/pipeline.test.js` | Create | Unit tests for every exported pipeline function |
| `test/db/cleaning.test.js` | Create | Unit tests for all three DB helpers |
| `test/worker.test.js` | Modify | Extend to cover cleaning integration, ROLLBACK paths, and client lifecycle |

---

### Task 1: UNIQUE Indexes in Migration

**Files:**
- Modify: `src/db/migrate.js`
- Modify: `test/migrate.test.js`

The existing migration creates `cleaned_messages` and `deals` without uniqueness guarantees. On a pg-boss retry, without UNIQUE constraints the cleaning writes produce duplicate rows. Fix this with two idempotent index creations.

- [ ] **Step 1: Update `test/migrate.test.js` to assert the UNIQUE indexes**

Read the current file first, then replace it entirely:

```js
import { describe, it, expect, vi } from 'vitest'

describe('runMigrations', () => {
  it('creates messages table with payload JSONB', async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rows: [] })
    const { runMigrations } = await import('../src/db/migrate.js')
    await runMigrations({ query: mockQuery })
    const allSql = mockQuery.mock.calls.map(c => c[0]).join('\n')
    expect(allSql).toContain('CREATE TABLE IF NOT EXISTS messages')
    expect(allSql).toContain('payload JSONB')
  })

  it('creates UNIQUE index on cleaned_messages(message_id)', async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rows: [] })
    const { runMigrations } = await import('../src/db/migrate.js')
    await runMigrations({ query: mockQuery })
    const allSql = mockQuery.mock.calls.map(c => c[0]).join('\n')
    expect(allSql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uniq_cleaned_messages_message_id')
  })

  it('creates UNIQUE index on deals(message_id, source)', async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rows: [] })
    const { runMigrations } = await import('../src/db/migrate.js')
    await runMigrations({ query: mockQuery })
    const allSql = mockQuery.mock.calls.map(c => c[0]).join('\n')
    expect(allSql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uniq_deals_message_id_source')
  })
})
```

- [ ] **Step 2: Run tests to verify new assertions fail**

```bash
cd /Users/abdullahsalman/Desktop/wassenger-webhook-server
npx vitest run test/migrate.test.js
```

Expected: 2 of 3 tests FAIL — the UNIQUE index assertions don't exist yet.

- [ ] **Step 3: Add UNIQUE indexes to `src/db/migrate.js`**

Open `src/db/migrate.js`. Append these two lines inside the `cleaned_messages` query block (after the existing indexes) and inside the `deals` query block respectively.

In the `cleaned_messages` pool.query block, add before the closing backtick:
```sql
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_cleaned_messages_message_id
      ON cleaned_messages (message_id);
```

In the `deals` pool.query block, add before the closing backtick:
```sql
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_deals_message_id_source
      ON deals (message_id, source);
```

- [ ] **Step 4: Run tests to verify all pass**

```bash
npx vitest run test/migrate.test.js
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git -C /Users/abdullahsalman/Desktop/wassenger-webhook-server add src/db/migrate.js test/migrate.test.js
git -C /Users/abdullahsalman/Desktop/wassenger-webhook-server commit -m "feat: add UNIQUE indexes on cleaned_messages(message_id) and deals(message_id, source)"
```

---

### Task 2: `src/cleaning/pipeline.js`

**Files:**
- Create: `test/cleaning/pipeline.test.js`
- Create: `src/cleaning/pipeline.js`

Pure regex functions ported from `clean_chat.py`. Zero npm dependencies. Zero I/O.

- [ ] **Step 1: Write the failing tests**

Create `test/cleaning/pipeline.test.js`:

```js
import { describe, it, expect } from 'vitest'
import {
  cleanText, isSystem, classify,
  extractPrice, extractRef, extractCondition,
} from '../../src/cleaning/pipeline.js'

describe('cleanText', () => {
  it('decodes keycap emoji digits', () => {
    // 3️⃣7️⃣0️⃣0️⃣ → 3700
    expect(cleanText('3️⃣7️⃣0️⃣0️⃣')).toBe('3700')
  })
  it('strips invisible unicode chars', () => {
    expect(cleanText('‎Hello‏ world')).toBe('Hello world')
  })
  it('removes media placeholder suffix', () => {
    expect(cleanText('Check this image omitted')).toBe('Check this')
  })
  it('collapses multiple spaces', () => {
    expect(cleanText('WTS  Rolex   Daytona')).toBe('WTS Rolex Daytona')
  })
  it('returns empty string for body containing only invisible chars', () => {
    expect(cleanText('‎‏')).toBe('')
  })
  it('strips media placeholder with invisible char prefix', () => {
    expect(cleanText('pic ‎image omitted')).toBe('pic')
  })
})

describe('isSystem', () => {
  it('returns true for WhatsApp sender', () => {
    expect(isSystem('WhatsApp', 'Your messages are secure')).toBe(true)
  })
  it('returns true for Luxury Watch Consortium sender', () => {
    expect(isSystem('Luxury Watch Consortium', 'Welcome')).toBe(true)
  })
  it('returns true when body contains "was added"', () => {
    expect(isSystem('John', 'John was added')).toBe(true)
  })
  it('returns true when body contains "security code changed"', () => {
    expect(isSystem('Jane', 'Your security code changed')).toBe(true)
  })
  it('returns true for "Messages and calls" phrase', () => {
    expect(isSystem('System', 'Messages and calls are end-to-end encrypted')).toBe(true)
  })
  it('returns false for regular dealer message', () => {
    expect(isSystem('John Doe', 'WTS Rolex Daytona $14k')).toBe(false)
  })
})

describe('classify', () => {
  it('returns WTB for "wtb" keyword', () => {
    const [intent, conf, signal] = classify('WTB Rolex Sub')
    expect(intent).toBe('WTB')
    expect(conf).toBe(1.0)
    expect(signal.toLowerCase()).toContain('wtb')
  })
  it('returns WTB for "want to buy"', () => {
    const [intent] = classify('want to buy a Daytona')
    expect(intent).toBe('WTB')
  })
  it('returns ISO for "looking for"', () => {
    const [intent] = classify('looking for a Daytona')
    expect(intent).toBe('ISO')
  })
  it('returns ISO for "in search of"', () => {
    const [intent] = classify('In search of 126710BLNR')
    expect(intent).toBe('ISO')
  })
  it('returns NTQ for "need to quote"', () => {
    const [intent] = classify('need to quote 126710 for client')
    expect(intent).toBe('NTQ')
  })
  it('returns WTT for "swap"', () => {
    const [intent] = classify('open to swap Submariner')
    expect(intent).toBe('WTT')
  })
  it('returns WTT for "want to trade"', () => {
    const [intent] = classify('want to trade my Daytona')
    expect(intent).toBe('WTT')
  })
  it('returns SOLD_ORDER for "sold order"', () => {
    const [intent] = classify('sold order 126710BLNR needed asap')
    expect(intent).toBe('SOLD_ORDER')
  })
  it('infers WTS at 0.92 from price + ref', () => {
    const [intent, conf, signal] = classify('126710BLNR $14,000')
    expect(intent).toBe('WTS')
    expect(conf).toBe(0.92)
    expect(signal).toBe('inferred:price+ref')
  })
  it('infers WTS at 0.80 from price + brand', () => {
    const [intent, conf, signal] = classify('Rolex available $14k')
    expect(intent).toBe('WTS')
    expect(conf).toBe(0.80)
    expect(signal).toBe('inferred:price+brand')
  })
  it('infers WTS at 0.70 from ref + condition', () => {
    const [intent, conf, signal] = classify('126710BLNR BNIB')
    expect(intent).toBe('WTS')
    expect(conf).toBe(0.70)
    expect(signal).toBe('inferred:ref+condition')
  })
  it('infers WTS at 0.60 from ref + brand', () => {
    const [intent, conf, signal] = classify('Rolex 126710BLNR')
    expect(intent).toBe('WTS')
    expect(conf).toBe(0.60)
    expect(signal).toBe('inferred:ref+brand')
  })
  it('returns SKIP for unclassifiable greeting', () => {
    const [intent, conf] = classify('Good morning everyone!')
    expect(intent).toBe('SKIP')
    expect(conf).toBe(0.50)
  })
})

describe('extractPrice', () => {
  it('extracts dollar sign amount', () => {
    expect(extractPrice('asking $14,750')).toBe(14750)
  })
  it('extracts dollar with space', () => {
    expect(extractPrice('$ 8,100 firm')).toBe(8100)
  })
  it('extracts k-suffix', () => {
    expect(extractPrice('price 14.5k')).toBe(14500)
  })
  it('extracts whole k-suffix', () => {
    expect(extractPrice('200k')).toBe(200000)
  })
  it('extracts comma-formatted number without dollar sign', () => {
    expect(extractPrice('117,500 firm')).toBe(117500)
  })
  it('returns null when no price found', () => {
    expect(extractPrice('WTB Rolex Sub')).toBeNull()
  })
  it('prefers dollar-sign price over k-suffix when both present', () => {
    expect(extractPrice('$14,000 or 14k')).toBe(14000)
  })
})

describe('extractRef', () => {
  it('extracts 6-digit Rolex ref', () => {
    expect(extractRef('WTS 126710BLNR')).toBe('126710BLNR')
  })
  it('extracts Panerai PAM ref', () => {
    expect(extractRef('WTS PAM00512 BNIB')).toBe('PAM00512')
  })
  it('extracts Patek slash ref', () => {
    expect(extractRef('WTS 5712/1A')).toBe('5712/1A')
  })
  it('extracts Patek 4-digit + letter ref', () => {
    expect(extractRef('WTS 5164R')).toBe('5164R')
  })
  it('returns null for plain text with no ref', () => {
    expect(extractRef('WTB Rolex please')).toBeNull()
  })
  it('returns null for 3-digit numbers', () => {
    expect(extractRef('WTS watch for 500')).toBeNull()
  })
})

describe('extractCondition', () => {
  it('returns BNIB for "brand new in box"', () => {
    expect(extractCondition('WTS 126710 brand new in box')).toBe('BNIB')
  })
  it('returns BNIB for "bnib"', () => {
    expect(extractCondition('bnib 126710BLNR')).toBe('BNIB')
  })
  it('BNIB takes priority over "new"', () => {
    expect(extractCondition('bnib never worn brand new')).toBe('BNIB')
  })
  it('returns unworn for "unworn"', () => {
    expect(extractCondition('126710 unworn $14k')).toBe('unworn')
  })
  it('returns preowned for "pre-owned"', () => {
    expect(extractCondition('WTS sub pre-owned $12k')).toBe('preowned')
  })
  it('returns mint for "mint"', () => {
    expect(extractCondition('WTS Daytona mint $22k')).toBe('mint')
  })
  it('returns null when no condition found', () => {
    expect(extractCondition('WTS Rolex $14k')).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/abdullahsalman/Desktop/wassenger-webhook-server
npx vitest run test/cleaning/pipeline.test.js
```

Expected: FAIL with `Cannot find module '../../src/cleaning/pipeline.js'`

- [ ] **Step 3: Create `src/cleaning/pipeline.js`**

Create `src/cleaning/pipeline.js`:

```js
// Invisible / directional formatting characters WhatsApp inserts
const _INVISIBLE = /[‎‏‪‫‬‭‮⁦⁧⁨⁩⁠﻿]/g

// Keycap emoji: digit + optional variation-selector-16 + combining enclosing keycap
const _KEYCAP = /([0-9])️?⃣/g

// Media placeholder appended at end of message lines
const _MEDIA_OMIT = /\s*‎?\s*(?:image|video|audio|sticker|GIF|document|Contact card|<Media) omitted\s*$/gi

export function cleanText(body) {
  let text = body.replace(_INVISIBLE, '')
  text = text.replace(_KEYCAP, '$1')
  const lines = text.split('\n').map(ln => {
    ln = ln.replace(_MEDIA_OMIT, '')
    return ln.replace(/\s+/g, ' ').trim()
  })
  return lines.filter(ln => ln).join('\n').trim()
}

// ── System-message detection ─────────────────────────────────────────────────

const _SYSTEM_SENDERS = new Set(['Luxury Watch Consortium', 'WhatsApp'])

const _SYSTEM_BODY = /\b(was added|was removed|changed the subject|changed this group|added you|security code changed|turned on disappearing|turned off disappearing|end-to-end encrypted|Messages and calls)\b/i

export function isSystem(sender, cleanBody) {
  return _SYSTEM_SENDERS.has(sender) || _SYSTEM_BODY.test(cleanBody)
}

// ── Intent classification ────────────────────────────────────────────────────

const _INTENT_RULES = [
  ['SOLD_ORDER', /\bsold[\s_-]*order\b/i],
  ['WTB', /\b(wtb|w\.t\.b\.?|want\s+to\s+buy|looking\s+to\s+buy|ltb|l\.t\.b\.?|wtb\/ntq|wtb\/iso)\b/i],
  ['ISO', /\b(iso|i\.s\.o\.?|in\s+search\s+of|looking\s+for|need\s+asap|iso\/ntq|ntq\/iso)\b/i],
  ['NTQ', /\b(ntq|n\.t\.q\.?|need\s+to\s+quote|needed\s+to\s+quote)\b/i],
  ['WTT', /\b(wtt|w\.t\.t\.?|want\s+to\s+trade|for\s+trade|will\s+trade|open\s+to\s+trade|swap)\b/i],
]

const _BRANDS = /\b(rolex|rlx|submariner|daytona|datejust|gmt.master|sky.dweller|sea.dweller|oyster.perpetual|day.date|yacht.master|milgauss|air.king|explorer|ap|audemars\s*piguet|audemars|royal\s*oak|patek|pp|nautilus|aquanaut|calatrava|cubitus|vacheron|vc|overseas|cartier|santos|omega|seamaster|speedmaster|tudor|hublot|iwc|breitling|navitimer|panerai|luminor|lange|richard\s*mille|rm|tag\s*heuer|zenith|breguet|jaeger|jlc|chopard|girard.perregaux|piaget|franck\s*muller|ulysse\s*nardin|f\.?\s*p\.?\s*journe|fp\s*journe)\b/i

const _CONDITIONS = [
  ['BNIB',         /\b(bnib|brand\s+new\s+in\s+box)\b/i],
  ['unworn',       /\b(brand\s+new\s+unworn|true\s+new|unworn)\b/i],
  ['NOS',          /\bnos\b|new\s+old\s+stock/i],
  ['slider',       /\bslider\b/i],
  ['new',          /\b(brand\s+new|new)\b/i],
  ['retail_ready', /\bretail\s+ready\b/i],
  ['mint',         /\bmint\b/i],
  ['NFC',          /\bnfc\b/i],
  ['light_wear',   /\blight\s+(?:wear|touch)\b/i],
  ['used',         /\bused\b/i],
  ['preowned',     /\b(preowned|pre-owned|pre\s+owned)\b/i],
]

const _PRICE_DETECT = /\$\s*[0-9][0-9,\.]*[0-9]|[0-9]{1,3}(?:,[0-9]{3})+|\b[0-9]{1,4}(?:\.[0-9]{1,2})?k\b/i

// Ref pattern source — reused for _hasRef and extractRef with fresh RegExp each call
const _REF_SRC = String.raw`(?:ref\.?\s*#?\s*)?\b([A-Z]{0,3}[0-9]{5,6}[A-Z0-9]{0,8}|[0-9]{4}\/[0-9A-Z\-]+|[0-9]{4}[A-Z][A-Z0-9\-]{0,8})\b`

function _hasPrice(text) { return _PRICE_DETECT.test(text) }

function _hasRef(text) {
  for (const m of text.matchAll(new RegExp(_REF_SRC, 'gi'))) {
    if (/[0-9]{4,}/.test(m[1])) return true
  }
  return false
}

function _hasBrand(text) { return _BRANDS.test(text) }

function _hasCondition(text) {
  return _CONDITIONS.some(([, pat]) => pat.test(text))
}

export function classify(cleanBody) {
  for (const [intent, pat] of _INTENT_RULES) {
    const m = cleanBody.match(pat)
    if (m) return [intent, 1.0, m[0].trim()]
  }

  const price = _hasPrice(cleanBody)
  const ref   = _hasRef(cleanBody)
  const brand = _hasBrand(cleanBody)
  const cond  = _hasCondition(cleanBody)

  if (price && ref)   return ['WTS', 0.92, 'inferred:price+ref']
  if (price && brand) return ['WTS', 0.80, 'inferred:price+brand']
  if (ref   && cond)  return ['WTS', 0.70, 'inferred:ref+condition']
  if (ref   && brand) return ['WTS', 0.60, 'inferred:ref+brand']

  return ['SKIP', 0.50, '']
}

// ── Field extractors ─────────────────────────────────────────────────────────

const _DOLLAR_PRICE = /\$\s*([0-9][0-9,\.]*[0-9])/
const _K_PRICE      = /\b([0-9]{1,4}(?:\.[0-9]{1,2})?)[kK]\b/
const _COMMA_PRICE  = /\b([0-9]{1,3}(?:,[0-9]{3})+)\b/

export function extractPrice(cleanBody) {
  let m = cleanBody.match(_DOLLAR_PRICE)
  if (m) {
    const n = parseFloat(m[1].replace(/,/g, ''))
    if (!isNaN(n)) return n
  }
  m = cleanBody.match(_K_PRICE)
  if (m) {
    const n = parseFloat(m[1]) * 1000
    if (!isNaN(n)) return n
  }
  m = cleanBody.match(_COMMA_PRICE)
  if (m) {
    const n = parseFloat(m[1].replace(/,/g, ''))
    if (!isNaN(n)) return n
  }
  return null
}

export function extractRef(cleanBody) {
  for (const m of cleanBody.matchAll(new RegExp(_REF_SRC, 'gi'))) {
    if (/[0-9]{4,}/.test(m[1])) return m[1]
  }
  return null
}

export function extractCondition(cleanBody) {
  for (const [name, pat] of _CONDITIONS) {
    if (pat.test(cleanBody)) return name
  }
  return null
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run test/cleaning/pipeline.test.js
```

Expected: PASS (all tests in the file)

- [ ] **Step 5: Commit**

```bash
git -C /Users/abdullahsalman/Desktop/wassenger-webhook-server add src/cleaning/pipeline.js test/cleaning/pipeline.test.js
git -C /Users/abdullahsalman/Desktop/wassenger-webhook-server commit -m "feat: cleaning pipeline — intent classification and field extraction"
```

---

### Task 3: `src/db/cleaning.js`

**Files:**
- Create: `test/db/cleaning.test.js`
- Create: `src/db/cleaning.js`

Three SQL helpers. All accept a `pg` client (not pool) so they participate in the caller's transaction.

- [ ] **Step 1: Write the failing tests**

Create `test/db/cleaning.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { insertCleanedMessage, insertDeal, markProcessed } from '../../src/db/cleaning.js'

function makeClient(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) }
}

const BASE_FIELDS = {
  messageId: 'msg-1',
  sender: '+1234567890',
  conversationId: 'conv-1',
  timestamp: new Date('2026-01-01T00:00:00Z'),
  rawBody: 'raw text',
  cleanBody: 'clean text',
  intent: 'WTS',
  confidence: 0.92,
  intentSignal: 'inferred:price+ref',
  priceUsd: 14000,
  watchRef: '126710BLNR',
  condition: 'BNIB',
  isSystem: false,
}

describe('insertCleanedMessage', () => {
  it('returns the new UUID on success', async () => {
    const client = makeClient([{ id: 'uuid-abc' }])
    const id = await insertCleanedMessage(client, BASE_FIELDS)
    expect(id).toBe('uuid-abc')
  })

  it('executes INSERT INTO cleaned_messages with ON CONFLICT DO NOTHING RETURNING id', async () => {
    const client = makeClient([{ id: 'uuid-abc' }])
    await insertCleanedMessage(client, BASE_FIELDS)
    const [sql] = client.query.mock.calls[0]
    expect(sql).toContain('INSERT INTO cleaned_messages')
    expect(sql).toContain('ON CONFLICT (message_id) DO NOTHING')
    expect(sql).toContain('RETURNING id')
  })

  it('passes message_id as first parameter', async () => {
    const client = makeClient([{ id: 'uuid-abc' }])
    await insertCleanedMessage(client, BASE_FIELDS)
    const [, params] = client.query.mock.calls[0]
    expect(params[0]).toBe('msg-1')
  })

  it('writes null for language column', async () => {
    const client = makeClient([{ id: 'uuid-abc' }])
    await insertCleanedMessage(client, BASE_FIELDS)
    const [, params] = client.query.mock.calls[0]
    const langIndex = params.indexOf(null)
    expect(langIndex).toBeGreaterThanOrEqual(0)
  })

  it('returns null when UNIQUE conflict fires (empty RETURNING)', async () => {
    const client = makeClient([]) // no rows → conflict
    const id = await insertCleanedMessage(client, BASE_FIELDS)
    expect(id).toBeNull()
  })

  it('passes null for optional fields when undefined', async () => {
    const client = makeClient([{ id: 'uuid-abc' }])
    await insertCleanedMessage(client, {
      ...BASE_FIELDS,
      priceUsd: undefined,
      watchRef: undefined,
      condition: undefined,
    })
    const [, params] = client.query.mock.calls[0]
    // priceUsd, watchRef, condition should all be null
    expect(params.filter(p => p === null).length).toBeGreaterThanOrEqual(3)
  })
})

describe('insertDeal', () => {
  const DEAL_FIELDS = {
    messageId: 'msg-1',
    cleanedMessageId: 'uuid-abc',
    sender: '+1234567890',
    conversationId: 'conv-1',
    timestamp: new Date('2026-01-01T00:00:00Z'),
    intent: 'WTS',
    confidence: 0.92,
    intentSignal: 'inferred:price+ref',
    priceUsd: 14000,
    watchRef: '126710BLNR',
    condition: 'BNIB',
    cleanBody: 'clean text',
    source: 'rules',
  }

  it('executes INSERT INTO deals with ON CONFLICT (message_id, source) DO NOTHING', async () => {
    const client = makeClient()
    await insertDeal(client, DEAL_FIELDS)
    const [sql] = client.query.mock.calls[0]
    expect(sql).toContain('INSERT INTO deals')
    expect(sql).toContain('ON CONFLICT (message_id, source) DO NOTHING')
  })

  it('passes message_id as first parameter', async () => {
    const client = makeClient()
    await insertDeal(client, DEAL_FIELDS)
    const [, params] = client.query.mock.calls[0]
    expect(params[0]).toBe('msg-1')
  })

  it('passes source as last parameter with value "rules"', async () => {
    const client = makeClient()
    await insertDeal(client, DEAL_FIELDS)
    const [, params] = client.query.mock.calls[0]
    expect(params[params.length - 1]).toBe('rules')
  })
})

describe('markProcessed', () => {
  it('updates processed_at for the given message_id', async () => {
    const client = makeClient()
    await markProcessed(client, 'msg-1')
    const [sql, params] = client.query.mock.calls[0]
    expect(sql).toContain('UPDATE messages')
    expect(sql).toContain('processed_at')
    expect(params[0]).toBe('msg-1')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/db/cleaning.test.js
```

Expected: FAIL with `Cannot find module '../../src/db/cleaning.js'`

- [ ] **Step 3: Create `src/db/cleaning.js`**

Create `src/db/cleaning.js`:

```js
const INSERT_CLEANED_SQL = `
  INSERT INTO cleaned_messages (
    message_id, sender, conversation_id, timestamp,
    raw_body, clean_body, intent, confidence, intent_signal,
    price_usd, watch_ref, condition, language, is_system
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
  ON CONFLICT (message_id) DO NOTHING
  RETURNING id
`

export async function insertCleanedMessage(client, f) {
  const { rows } = await client.query(INSERT_CLEANED_SQL, [
    f.messageId,
    f.sender,
    f.conversationId,
    f.timestamp,
    f.rawBody,
    f.cleanBody,
    f.intent,
    f.confidence,
    f.intentSignal,
    f.priceUsd ?? null,
    f.watchRef ?? null,
    f.condition ?? null,
    null,           // language — not used
    f.isSystem,
  ])
  return rows[0]?.id ?? null
}

const INSERT_DEAL_SQL = `
  INSERT INTO deals (
    message_id, cleaned_message_id, sender, conversation_id, timestamp,
    intent, confidence, intent_signal,
    price_usd, watch_ref, condition, language,
    clean_body, source
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
  ON CONFLICT (message_id, source) DO NOTHING
`

export async function insertDeal(client, f) {
  await client.query(INSERT_DEAL_SQL, [
    f.messageId,
    f.cleanedMessageId,
    f.sender,
    f.conversationId,
    f.timestamp,
    f.intent,
    f.confidence,
    f.intentSignal,
    f.priceUsd ?? null,
    f.watchRef ?? null,
    f.condition ?? null,
    null,           // language — not used
    f.cleanBody,
    f.source,
  ])
}

export async function markProcessed(client, messageId) {
  await client.query(
    'UPDATE messages SET processed_at = NOW() WHERE message_id = $1',
    [messageId],
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run test/db/cleaning.test.js
```

Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git -C /Users/abdullahsalman/Desktop/wassenger-webhook-server add src/db/cleaning.js test/db/cleaning.test.js
git -C /Users/abdullahsalman/Desktop/wassenger-webhook-server commit -m "feat: DB helpers for cleaned_messages, deals, and processed_at stamp"
```

---

### Task 4: Rewrite `src/queue/worker.js`

**Files:**
- Modify: `test/worker.test.js`
- Modify: `src/queue/worker.js`

The worker now acquires a single `pg` client per job, runs the messages INSERT (auto-commit), then the cleaning pipeline, then an atomic transaction for the cleaning writes.

- [ ] **Step 1: Replace `test/worker.test.js` with the updated version**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/cleaning/pipeline.js', () => ({
  cleanText:        vi.fn().mockReturnValue('WTS Rolex 126710BLNR $14k BNIB'),
  isSystem:         vi.fn().mockReturnValue(false),
  classify:         vi.fn().mockReturnValue(['WTS', 0.92, 'inferred:price+ref']),
  extractPrice:     vi.fn().mockReturnValue(14000),
  extractRef:       vi.fn().mockReturnValue('126710BLNR'),
  extractCondition: vi.fn().mockReturnValue('BNIB'),
}))

vi.mock('../src/db/cleaning.js', () => ({
  insertCleanedMessage: vi.fn().mockResolvedValue('uuid-1'),
  insertDeal:           vi.fn().mockResolvedValue(undefined),
  markProcessed:        vi.fn().mockResolvedValue(undefined),
}))

import { classifyRelevance, processMessage } from '../src/queue/worker.js'
import {
  cleanText, isSystem, classify,
  extractPrice, extractRef, extractCondition,
} from '../src/cleaning/pipeline.js'
import { insertCleanedMessage, insertDeal, markProcessed } from '../src/db/cleaning.js'

function makeClient() {
  return {
    query:   vi.fn().mockResolvedValue({ rows: [] }),
    release: vi.fn(),
  }
}

function makePool(client) {
  return { connect: vi.fn().mockResolvedValue(client) }
}

function makeJob(dataOverrides = {}) {
  return {
    data: {
      data: {
        id:         'msg-1',
        flow:       'inbound',
        type:       'text',
        body:       'WTS Rolex 126710BLNR $14k BNIB',
        fromNumber: '+1234567890',
        chat:       { id: 'conv-1' },
        timestamp:  1700000000,
        meta:       {},
        ...dataOverrides,
      },
      rawPayload: { event: 'message:in:new' },
    },
  }
}

describe('classifyRelevance', () => {
  it('returns is_relevant true for inbound text with body', () => {
    expect(classifyRelevance({ flow: 'inbound', type: 'text', body: 'hello', meta: {} }))
      .toEqual({ is_relevant: true, skip_reason: null })
  })
  it('returns false skip_reason "outbound" for outbound messages', () => {
    const r = classifyRelevance({ flow: 'outbound', type: 'text', body: 'hi', meta: {} })
    expect(r.is_relevant).toBe(false)
    expect(r.skip_reason).toBe('outbound')
  })
  it('returns false skip_reason "non_text_or_image" for document type', () => {
    const r = classifyRelevance({ flow: 'inbound', type: 'document', body: 'x', meta: {} })
    expect(r.is_relevant).toBe(false)
    expect(r.skip_reason).toBe('non_text_or_image')
  })
  it('returns false for notification', () => {
    const r = classifyRelevance({ flow: 'inbound', type: 'text', body: 'x', meta: { isNotification: true } })
    expect(r.is_relevant).toBe(false)
    expect(r.skip_reason).toBe('notification')
  })
  it('returns false for empty body', () => {
    const r = classifyRelevance({ flow: 'inbound', type: 'text', body: '', meta: {} })
    expect(r.is_relevant).toBe(false)
    expect(r.skip_reason).toBe('empty_body')
  })
})

describe('processMessage — messages insert', () => {
  beforeEach(() => vi.clearAllMocks())

  it('acquires a client from the pool', async () => {
    const client = makeClient()
    const pool = makePool(client)
    await processMessage(makeJob(), pool)
    expect(pool.connect).toHaveBeenCalledOnce()
  })

  it('inserts into messages table with correct message_id', async () => {
    const client = makeClient()
    await processMessage(makeJob(), makePool(client))
    const insertCall = client.query.mock.calls.find(c => c[0].includes('INSERT INTO messages'))
    expect(insertCall).toBeDefined()
    expect(insertCall[1][0]).toBe('msg-1')
  })

  it('returns early and does not throw on duplicate key (23505)', async () => {
    const client = makeClient()
    const dupError = Object.assign(new Error('dup'), { code: '23505' })
    client.query.mockRejectedValueOnce(dupError)
    await expect(processMessage(makeJob(), makePool(client))).resolves.not.toThrow()
  })

  it('rethrows non-duplicate DB errors', async () => {
    const client = makeClient()
    client.query.mockRejectedValueOnce(new Error('connection lost'))
    await expect(processMessage(makeJob(), makePool(client))).rejects.toThrow('connection lost')
  })

  it('releases client even when messages insert throws', async () => {
    const client = makeClient()
    client.query.mockRejectedValueOnce(new Error('boom'))
    await expect(processMessage(makeJob(), makePool(client))).rejects.toThrow()
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('skips cleaning and releases client for irrelevant messages', async () => {
    const client = makeClient()
    await processMessage(makeJob({ flow: 'outbound' }), makePool(client))
    expect(insertCleanedMessage).not.toHaveBeenCalled()
    expect(client.release).toHaveBeenCalledOnce()
  })
})

describe('processMessage — cleaning', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls insertCleanedMessage with correct messageId and intent', async () => {
    const client = makeClient()
    await processMessage(makeJob(), makePool(client))
    expect(insertCleanedMessage).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ messageId: 'msg-1', intent: 'WTS', confidence: 0.92 }),
    )
  })

  it('calls insertDeal for non-SKIP intent', async () => {
    const client = makeClient()
    await processMessage(makeJob(), makePool(client))
    expect(insertDeal).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ messageId: 'msg-1', source: 'rules', cleanedMessageId: 'uuid-1' }),
    )
  })

  it('does NOT call insertDeal for SKIP intent', async () => {
    classify.mockReturnValueOnce(['SKIP', 0.50, ''])
    const client = makeClient()
    await processMessage(makeJob(), makePool(client))
    expect(insertDeal).not.toHaveBeenCalled()
  })

  it('calls markProcessed after successful cleaning', async () => {
    const client = makeClient()
    await processMessage(makeJob(), makePool(client))
    expect(markProcessed).toHaveBeenCalledWith(client, 'msg-1')
  })

  it('commits the cleaning transaction on success', async () => {
    const client = makeClient()
    await processMessage(makeJob(), makePool(client))
    expect(client.query).toHaveBeenCalledWith('COMMIT')
  })

  it('returns early without cleaning when cleanText returns empty string', async () => {
    cleanText.mockReturnValueOnce('')
    const client = makeClient()
    await processMessage(makeJob(), makePool(client))
    expect(insertCleanedMessage).not.toHaveBeenCalled()
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('issues ROLLBACK and returns early when insertCleanedMessage returns null (conflict)', async () => {
    insertCleanedMessage.mockResolvedValueOnce(null)
    const client = makeClient()
    await processMessage(makeJob(), makePool(client))
    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect(insertDeal).not.toHaveBeenCalled()
    expect(markProcessed).not.toHaveBeenCalled()
  })

  it('issues ROLLBACK and rethrows when cleaning write throws', async () => {
    insertCleanedMessage.mockRejectedValueOnce(new Error('db write failed'))
    const client = makeClient()
    await expect(processMessage(makeJob(), makePool(client))).rejects.toThrow('db write failed')
    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('uses isSystem=true and SKIP intent for system messages without calling classify', async () => {
    isSystem.mockReturnValueOnce(true)
    const client = makeClient()
    await processMessage(makeJob(), makePool(client))
    expect(classify).not.toHaveBeenCalled()
    expect(insertCleanedMessage).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ intent: 'SKIP', confidence: 1.0, intentSignal: 'system', isSystem: true }),
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/worker.test.js
```

Expected: Multiple FAILures — `pool.connect is not a function`, missing cleaning assertions.

- [ ] **Step 3: Rewrite `src/queue/worker.js`**

Replace the entire file:

```js
import { cleanText, isSystem, classify, extractPrice, extractRef, extractCondition } from '../cleaning/pipeline.js'
import { insertCleanedMessage, insertDeal, markProcessed } from '../db/cleaning.js'

const INSERT_MESSAGES_SQL = `
  INSERT INTO messages (message_id, sender, conversation_id, timestamp, payload, is_relevant, skip_reason)
  VALUES ($1, $2, $3, $4, $5, $6, $7)
  ON CONFLICT (message_id) DO NOTHING
`

export function classifyRelevance(data) {
  if (data.flow !== 'inbound')
    return { is_relevant: false, skip_reason: 'outbound' }
  if (data.type !== 'text' && data.type !== 'image')
    return { is_relevant: false, skip_reason: 'non_text_or_image' }
  if (data.meta?.isNotification)
    return { is_relevant: false, skip_reason: 'notification' }
  if (data.meta?.isBizNotification)
    return { is_relevant: false, skip_reason: 'biz_notification' }
  if (!data.body?.trim())
    return { is_relevant: false, skip_reason: 'empty_body' }
  return { is_relevant: true, skip_reason: null }
}

export async function processMessage(job, pool) {
  const { data, rawPayload } = job.data
  const { is_relevant, skip_reason } = classifyRelevance(data)
  const sender         = data.fromNumber ?? data.from
  const conversationId = data.chat?.id ?? null
  const timestamp      = new Date(data.timestamp * 1000)

  const client = await pool.connect()
  try {
    // Step 1: persist raw message (auto-commit — each client.query without BEGIN is its own txn)
    try {
      await client.query(INSERT_MESSAGES_SQL, [
        data.id, sender, conversationId, timestamp,
        JSON.stringify(rawPayload), is_relevant, skip_reason,
      ])
    } catch (err) {
      if (err.code === '23505') return
      throw err
    }

    if (!is_relevant) return

    // Step 2: run cleaning pipeline (pure in-memory, no I/O)
    const rawBody  = data.body ?? ''
    const cleanBody = cleanText(rawBody)
    if (!cleanBody) return

    const systemMsg = isSystem(sender, cleanBody)
    const [intent, confidence, intentSignal] = systemMsg
      ? ['SKIP', 1.0, 'system']
      : classify(cleanBody)

    const priceUsd  = extractPrice(cleanBody)
    const watchRef  = extractRef(cleanBody)
    const condition = extractCondition(cleanBody)

    // Step 3: atomic write — cleaned_messages + deals + processed_at
    await client.query('BEGIN')
    const cleanedId = await insertCleanedMessage(client, {
      messageId: data.id, sender, conversationId, timestamp,
      rawBody, cleanBody, intent, confidence, intentSignal,
      priceUsd, watchRef, condition, isSystem: systemMsg,
    })

    if (cleanedId === null) {
      // UNIQUE conflict → already cleaned on a previous attempt, idempotent exit
      await client.query('ROLLBACK')
      return
    }

    if (intent !== 'SKIP') {
      await insertDeal(client, {
        messageId: data.id, cleanedMessageId: cleanedId,
        sender, conversationId, timestamp,
        intent, confidence, intentSignal,
        priceUsd, watchRef, condition,
        cleanBody, source: 'rules',
      })
    }

    await markProcessed(client, data.id)
    await client.query('COMMIT')
  } catch (err) {
    try { await client.query('ROLLBACK') } catch {}
    throw err
  } finally {
    client.release()
  }
}

export function registerWorker(boss, pool) {
  return boss.work(
    'wassenger.message',
    { teamSize: 5, teamConcurrency: 5 },
    (jobs) => Promise.all(jobs.map((job) => processMessage(job, pool))),
  )
}
```

- [ ] **Step 4: Run worker tests to verify they pass**

```bash
npx vitest run test/worker.test.js
```

Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git -C /Users/abdullahsalman/Desktop/wassenger-webhook-server add src/queue/worker.js test/worker.test.js
git -C /Users/abdullahsalman/Desktop/wassenger-webhook-server commit -m "feat: inline cleaning pipeline in pg-boss worker with atomic transaction"
```

---

### Task 5: Full Suite Verification

- [ ] **Step 1: Run all tests**

```bash
cd /Users/abdullahsalman/Desktop/wassenger-webhook-server
npx vitest run
```

Expected: All test files PASS — migrate, boss, worker, authenticate, webhook, admin, cleaning/pipeline, db/cleaning.

- [ ] **Step 2: Check test coverage (optional)**

```bash
npx vitest run --coverage
```

Check that `src/cleaning/pipeline.js` and `src/db/cleaning.js` have >90% coverage.

- [ ] **Step 3: Final commit**

```bash
git -C /Users/abdullahsalman/Desktop/wassenger-webhook-server add .
git -C /Users/abdullahsalman/Desktop/wassenger-webhook-server commit -m "chore: full test suite verified — inline cleaning pipeline complete"
```

---

## What to shut down after this ships

- Stop and undeploy the Python `deals-message-cleaning` FastAPI worker (the `uvicorn worker.main:app` process / Docker container).
- The `deals-message-cleaning` repo can be archived — `clean_chat.py` still works standalone for Excel exports from chat dump files and is unaffected.
- No schema cleanup needed — the `messages.processed_at` work-queue index remains valid and used by the inline worker.
