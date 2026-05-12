# Wassenger Webhook Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-ready Fastify webhook server that receives Wassenger message events, queues them with pg-boss, and persists full JSON payloads to PostgreSQL.

**Architecture:** Fastify handles HTTP ingress, validates the Wassenger webhook secret header on every request, filters to `message.created` events only, and immediately enqueues the payload via pg-boss before returning 200 OK. A background worker drains the queue and writes records to a PostgreSQL JSONB table with idempotent upsert. A protected `/admin` route exposes queue health and message counts.

**Tech Stack:** Node.js 20 (ESM), Fastify 5, pg-boss 10, PostgreSQL 16 (JSONB), Vitest, Railway

---

## File Map

| File | Responsibility |
|------|----------------|
| `src/config.js` | Load + validate env vars, fail fast if missing |
| `src/db/client.js` | Postgres connection pool (pg) |
| `src/db/migrate.js` | Run schema migrations on startup |
| `src/queue/boss.js` | pg-boss singleton + queue name constant |
| `src/queue/worker.js` | Dequeue jobs, insert to DB, handle duplicates |
| `src/plugins/authenticate.js` | Fastify preHandler: validate Wassenger secret + admin token |
| `src/routes/webhook.js` | POST /webhook — filter, enqueue, 200 OK |
| `src/routes/admin.js` | GET /admin — queue stats + message count |
| `src/server.js` | Compose Fastify app (register routes) |
| `src/app.js` | Entry point: migrate → start boss → start server |
| `test/migrate.test.js` | Migration SQL unit test |
| `test/boss.test.js` | pg-boss instance unit test |
| `test/worker.test.js` | Worker insert + duplicate handling tests |
| `test/authenticate.test.js` | Auth handler unit tests |
| `test/webhook.test.js` | Webhook route unit tests via inject() |
| `test/admin.test.js` | Admin route unit tests via inject() |
| `.env.example` | Env var template |
| `railway.toml` | Railway deployment config |

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `.env.example`
- Create: `.gitignore`
- Create: `src/config.js`

- [ ] **Step 1: Initialise npm in the project directory**

```bash
cd /Users/abdullahsalman/Desktop/wassenger-webhook-server
npm init -y
```

- [ ] **Step 2: Install dependencies**

```bash
npm install fastify@5 pg pg-boss@10 dotenv
npm install --save-dev vitest @vitest/coverage-v8
```

- [ ] **Step 3: Write `.env.example`**

Create `.env.example`:
```
DATABASE_URL=postgresql://user:password@localhost:5432/wassenger
WASSENGER_WEBHOOK_SECRET=your_wassenger_webhook_secret
ADMIN_TOKEN=your_admin_token_here
PORT=3000
NODE_ENV=development
```

- [ ] **Step 4: Write `.gitignore`**

Create `.gitignore`:
```
node_modules/
.env
*.log
coverage/
```

- [ ] **Step 5: Write `src/config.js`**

Create `src/config.js`:
```js
import 'dotenv/config'

const required = (key) => {
  const val = process.env[key]
  if (!val) throw new Error(`Missing required env var: ${key}`)
  return val
}

export const config = {
  port: parseInt(process.env.PORT ?? '3000', 10),
  databaseUrl: required('DATABASE_URL'),
  webhookSecret: required('WASSENGER_WEBHOOK_SECRET'),
  adminToken: required('ADMIN_TOKEN'),
  nodeEnv: process.env.NODE_ENV ?? 'development',
}
```

- [ ] **Step 6: Update `package.json` — set type and scripts**

Replace the generated `package.json` with:
```json
{
  "name": "wassenger-webhook-server",
  "version": "1.0.0",
  "type": "module",
  "main": "src/app.js",
  "scripts": {
    "start": "node src/app.js",
    "dev": "node --watch src/app.js",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage"
  },
  "dependencies": {
    "dotenv": "^16.0.0",
    "fastify": "^5.0.0",
    "pg": "^8.0.0",
    "pg-boss": "^10.0.0"
  },
  "devDependencies": {
    "@vitest/coverage-v8": "^2.0.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 7: Copy `.env.example` to `.env` and fill in local values**

```bash
cp .env.example .env
# Edit .env with your local Postgres credentials and test secrets
```

- [ ] **Step 8: Commit**

```bash
git init
git add package.json .env.example .gitignore src/config.js
git commit -m "feat: project scaffold with config and dependencies"
```

---

### Task 2: Database Client + Migrations

**Files:**
- Create: `src/db/client.js`
- Create: `src/db/migrate.js`
- Create: `test/migrate.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/migrate.test.js`:
```js
import { describe, it, expect, vi } from 'vitest'

describe('runMigrations', () => {
  it('executes migration SQL against the pool', async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rows: [] })
    const mockPool = { query: mockQuery }

    const { runMigrations } = await import('../src/db/migrate.js')
    await runMigrations(mockPool)

    expect(mockQuery).toHaveBeenCalledTimes(1)
    const sql = mockQuery.mock.calls[0][0]
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS messages')
    expect(sql).toContain('payload JSONB')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run test/migrate.test.js
```
Expected: FAIL with `Cannot find module '../src/db/migrate.js'`

- [ ] **Step 3: Write `src/db/client.js`**

Create `src/db/client.js`:
```js
import pg from 'pg'
import { config } from '../config.js'

const { Pool } = pg

export const pool = new Pool({ connectionString: config.databaseUrl })
```

- [ ] **Step 4: Write `src/db/migrate.js`**

Create `src/db/migrate.js`:
```js
export async function runMigrations(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      message_id       TEXT        UNIQUE NOT NULL,
      sender           TEXT        NOT NULL,
      conversation_id  TEXT,
      timestamp        TIMESTAMPTZ NOT NULL,
      payload          JSONB       NOT NULL,
      created_at       TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_messages_sender          ON messages(sender);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp       ON messages(timestamp);
    CREATE INDEX IF NOT EXISTS idx_messages_payload_gin     ON messages USING GIN(payload);
  `)
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run test/migrate.test.js
```
Expected: PASS (1 test)

- [ ] **Step 6: Commit**

```bash
git add src/db/client.js src/db/migrate.js test/migrate.test.js
git commit -m "feat: postgres client and migration runner"
```

---

### Task 3: pg-boss Queue Instance

**Files:**
- Create: `src/queue/boss.js`
- Create: `test/boss.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/boss.test.js`:
```js
import { describe, it, expect, vi } from 'vitest'

vi.mock('pg-boss', () => ({
  default: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  }))
}))

vi.mock('../src/config.js', () => ({
  config: {
    databaseUrl: 'postgresql://test:test@localhost/test',
    webhookSecret: 'secret',
    adminToken: 'admin',
    port: 3000,
    nodeEnv: 'test',
  }
}))

describe('boss', () => {
  it('exports a pg-boss instance with start and stop methods', async () => {
    const { boss } = await import('../src/queue/boss.js')
    expect(boss).toBeDefined()
    expect(typeof boss.start).toBe('function')
    expect(typeof boss.stop).toBe('function')
  })

  it('exports QUEUE_NAME constant', async () => {
    const { QUEUE_NAME } = await import('../src/queue/boss.js')
    expect(QUEUE_NAME).toBe('wassenger.message')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run test/boss.test.js
```
Expected: FAIL with `Cannot find module '../src/queue/boss.js'`

- [ ] **Step 3: Write `src/queue/boss.js`**

Create `src/queue/boss.js`:
```js
import PgBoss from 'pg-boss'
import { config } from '../config.js'

export const QUEUE_NAME = 'wassenger.message'

export const boss = new PgBoss({
  connectionString: config.databaseUrl,
  retryLimit: 3,
  retryDelay: 5,
  deleteAfterDays: 7,
})
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run test/boss.test.js
```
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/queue/boss.js test/boss.test.js
git commit -m "feat: pg-boss singleton with retry config"
```

---

### Task 4: Message Worker

**Files:**
- Create: `src/queue/worker.js`
- Create: `test/worker.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/worker.test.js`:
```js
import { describe, it, expect, vi } from 'vitest'

describe('processMessage', () => {
  it('inserts message payload into messages table', async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rows: [] })
    const mockPool = { query: mockQuery }

    const { processMessage } = await import('../src/queue/worker.js')

    const job = {
      data: {
        data: {
          id: 'msg_abc123',
          from: '+1234567890',
          conversationId: 'conv_xyz',
          timestamp: '2026-05-12T10:00:00Z',
        },
        rawPayload: { event: 'message.created', data: { id: 'msg_abc123' } },
      },
    }

    await processMessage(job, mockPool)

    expect(mockQuery).toHaveBeenCalledOnce()
    const [sql, params] = mockQuery.mock.calls[0]
    expect(sql).toContain('INSERT INTO messages')
    expect(params[0]).toBe('msg_abc123')
    expect(params[1]).toBe('+1234567890')
    expect(params[2]).toBe('conv_xyz')
  })

  it('silently skips duplicate message_id (Postgres error code 23505)', async () => {
    const dupError = Object.assign(new Error('duplicate key'), { code: '23505' })
    const mockPool = { query: vi.fn().mockRejectedValue(dupError) }

    const { processMessage } = await import('../src/queue/worker.js')

    const job = {
      data: {
        data: { id: 'dup_id', from: '+1', conversationId: null, timestamp: '2026-05-12T10:00:00Z' },
        rawPayload: {},
      },
    }

    await expect(processMessage(job, mockPool)).resolves.not.toThrow()
  })

  it('re-throws non-duplicate DB errors so pg-boss can retry', async () => {
    const dbError = new Error('connection refused')
    const mockPool = { query: vi.fn().mockRejectedValue(dbError) }

    const { processMessage } = await import('../src/queue/worker.js')

    const job = {
      data: {
        data: { id: 'msg_2', from: '+1', conversationId: null, timestamp: '2026-05-12T10:00:00Z' },
        rawPayload: {},
      },
    }

    await expect(processMessage(job, mockPool)).rejects.toThrow('connection refused')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run test/worker.test.js
```
Expected: FAIL with `Cannot find module '../src/queue/worker.js'`

- [ ] **Step 3: Write `src/queue/worker.js`**

Create `src/queue/worker.js`:
```js
const INSERT_SQL = `
  INSERT INTO messages (message_id, sender, conversation_id, timestamp, payload)
  VALUES ($1, $2, $3, $4, $5)
  ON CONFLICT (message_id) DO NOTHING
`

export async function processMessage(job, pool) {
  const { data, rawPayload } = job.data
  try {
    await pool.query(INSERT_SQL, [
      data.id,
      data.from,
      data.conversationId ?? null,
      new Date(data.timestamp),
      JSON.stringify(rawPayload),
    ])
  } catch (err) {
    if (err.code === '23505') return
    throw err
  }
}

export function registerWorker(boss, pool) {
  return boss.work(
    'wassenger.message',
    { teamSize: 5, teamConcurrency: 5 },
    (job) => processMessage(job, pool)
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run test/worker.test.js
```
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/queue/worker.js test/worker.test.js
git commit -m "feat: message worker with idempotent insert and retry propagation"
```

---

### Task 5: Auth Handlers

**Files:**
- Create: `src/plugins/authenticate.js`
- Create: `test/authenticate.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/authenticate.test.js`:
```js
import { describe, it, expect, vi } from 'vitest'

vi.mock('../src/config.js', () => ({
  config: {
    webhookSecret: 'test-secret',
    adminToken: 'admin-token',
    port: 3000,
    databaseUrl: 'postgresql://x',
    nodeEnv: 'test',
  }
}))

const makeReply = () => ({ code: vi.fn().mockReturnThis(), send: vi.fn() })

describe('validateWebhookSecret', () => {
  it('calls done() when x-api-key matches webhook secret', async () => {
    const { validateWebhookSecret } = await import('../src/plugins/authenticate.js')
    const reply = makeReply()
    const done = vi.fn()

    await validateWebhookSecret({ headers: { 'x-api-key': 'test-secret' } }, reply, done)

    expect(done).toHaveBeenCalledOnce()
    expect(reply.code).not.toHaveBeenCalled()
  })

  it('returns 401 when x-api-key is wrong', async () => {
    const { validateWebhookSecret } = await import('../src/plugins/authenticate.js')
    const reply = makeReply()
    const done = vi.fn()

    await validateWebhookSecret({ headers: { 'x-api-key': 'wrong' } }, reply, done)

    expect(reply.code).toHaveBeenCalledWith(401)
    expect(reply.send).toHaveBeenCalledWith({ error: 'Unauthorized' })
    expect(done).not.toHaveBeenCalled()
  })

  it('returns 401 when x-api-key header is absent', async () => {
    const { validateWebhookSecret } = await import('../src/plugins/authenticate.js')
    const reply = makeReply()

    await validateWebhookSecret({ headers: {} }, reply, vi.fn())

    expect(reply.code).toHaveBeenCalledWith(401)
  })
})

describe('validateAdminToken', () => {
  it('calls done() when Authorization Bearer matches admin token', async () => {
    const { validateAdminToken } = await import('../src/plugins/authenticate.js')
    const reply = makeReply()
    const done = vi.fn()

    await validateAdminToken({ headers: { authorization: 'Bearer admin-token' } }, reply, done)

    expect(done).toHaveBeenCalledOnce()
  })

  it('returns 401 when admin token is wrong', async () => {
    const { validateAdminToken } = await import('../src/plugins/authenticate.js')
    const reply = makeReply()
    const done = vi.fn()

    await validateAdminToken({ headers: { authorization: 'Bearer wrong' } }, reply, done)

    expect(reply.code).toHaveBeenCalledWith(401)
    expect(done).not.toHaveBeenCalled()
  })

  it('returns 401 when Authorization header is absent', async () => {
    const { validateAdminToken } = await import('../src/plugins/authenticate.js')
    const reply = makeReply()

    await validateAdminToken({ headers: {} }, reply, vi.fn())

    expect(reply.code).toHaveBeenCalledWith(401)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run test/authenticate.test.js
```
Expected: FAIL with `Cannot find module '../src/plugins/authenticate.js'`

- [ ] **Step 3: Write `src/plugins/authenticate.js`**

Create `src/plugins/authenticate.js`:
```js
import { config } from '../config.js'

export async function validateWebhookSecret(request, reply, done) {
  if (request.headers['x-api-key'] !== config.webhookSecret) {
    return reply.code(401).send({ error: 'Unauthorized' })
  }
  done()
}

export async function validateAdminToken(request, reply, done) {
  const token = request.headers.authorization?.replace('Bearer ', '')
  if (token !== config.adminToken) {
    return reply.code(401).send({ error: 'Unauthorized' })
  }
  done()
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run test/authenticate.test.js
```
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/plugins/authenticate.js test/authenticate.test.js
git commit -m "feat: webhook secret and admin token auth handlers"
```

---

### Task 6: Webhook Route

**Files:**
- Create: `src/routes/webhook.js`
- Create: `test/webhook.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/webhook.test.js`:
```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'

const mockSendOnce = vi.fn().mockResolvedValue('job-id-123')

vi.mock('../src/queue/boss.js', () => ({
  boss: { sendOnce: mockSendOnce },
  QUEUE_NAME: 'wassenger.message',
}))

vi.mock('../src/config.js', () => ({
  config: {
    webhookSecret: 'test-secret',
    adminToken: 'admin-token',
    port: 3000,
    databaseUrl: 'postgresql://x',
    nodeEnv: 'test',
  }
}))

async function buildApp() {
  const app = Fastify()
  const { webhookRoute } = await import('../src/routes/webhook.js')
  await app.register(webhookRoute)
  return app
}

describe('POST /webhook', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 200 and enqueues message.created events with valid secret', async () => {
    const app = await buildApp()
    const payload = {
      event: 'message.created',
      data: {
        id: 'msg_1',
        from: '+1234567890',
        conversationId: 'conv_1',
        timestamp: '2026-05-12T10:00:00Z',
      },
    }

    const response = await app.inject({
      method: 'POST',
      url: '/webhook',
      headers: { 'x-api-key': 'test-secret', 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toEqual({ ok: true })
    expect(mockSendOnce).toHaveBeenCalledWith(
      'wassenger.message',
      'msg_1',
      expect.objectContaining({ data: payload.data, rawPayload: payload })
    )
  })

  it('returns 200 but does NOT enqueue non-message.created events', async () => {
    const app = await buildApp()

    const response = await app.inject({
      method: 'POST',
      url: '/webhook',
      headers: { 'x-api-key': 'test-secret', 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'message.updated', data: {} }),
    })

    expect(response.statusCode).toBe(200)
    expect(mockSendOnce).not.toHaveBeenCalled()
  })

  it('returns 401 when x-api-key header is missing', async () => {
    const app = await buildApp()

    const response = await app.inject({
      method: 'POST',
      url: '/webhook',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'message.created', data: {} }),
    })

    expect(response.statusCode).toBe(401)
  })

  it('returns 401 when x-api-key is wrong', async () => {
    const app = await buildApp()

    const response = await app.inject({
      method: 'POST',
      url: '/webhook',
      headers: { 'x-api-key': 'wrong-secret', 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'message.created', data: {} }),
    })

    expect(response.statusCode).toBe(401)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run test/webhook.test.js
```
Expected: FAIL with `Cannot find module '../src/routes/webhook.js'`

- [ ] **Step 3: Write `src/routes/webhook.js`**

Create `src/routes/webhook.js`:
```js
import { boss, QUEUE_NAME } from '../queue/boss.js'
import { validateWebhookSecret } from '../plugins/authenticate.js'

export async function webhookRoute(fastify) {
  fastify.post('/webhook', { preHandler: validateWebhookSecret }, async (request, reply) => {
    const payload = request.body

    if (payload?.event !== 'message.created') {
      return reply.send({ ok: true })
    }

    const { data } = payload
    await boss.sendOnce(QUEUE_NAME, data.id, { data, rawPayload: payload })

    return reply.send({ ok: true })
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run test/webhook.test.js
```
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/routes/webhook.js test/webhook.test.js
git commit -m "feat: webhook route with secret validation and event filtering"
```

---

### Task 7: Admin Route

**Files:**
- Create: `src/routes/admin.js`
- Create: `test/admin.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/admin.test.js`:
```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'

const mockQuery = vi.fn()

vi.mock('../src/db/client.js', () => ({
  pool: { query: mockQuery }
}))

vi.mock('../src/queue/boss.js', () => ({
  boss: { getQueueSize: vi.fn().mockResolvedValue(5) },
  QUEUE_NAME: 'wassenger.message',
}))

vi.mock('../src/config.js', () => ({
  config: {
    webhookSecret: 'test-secret',
    adminToken: 'admin-token',
    port: 3000,
    databaseUrl: 'postgresql://x',
    nodeEnv: 'test',
  }
}))

async function buildApp() {
  const app = Fastify()
  const { adminRoute } = await import('../src/routes/admin.js')
  await app.register(adminRoute)
  return app
}

describe('GET /admin', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns queue and message stats with valid admin token', async () => {
    mockQuery.mockResolvedValue({ rows: [{ count: '42' }] })
    const app = await buildApp()

    const response = await app.inject({
      method: 'GET',
      url: '/admin',
      headers: { authorization: 'Bearer admin-token' },
    })

    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body)
    expect(body.totalMessages).toBe(42)
    expect(body.queueSize).toBe(5)
    expect(body.status).toBe('ok')
    expect(body.timestamp).toBeDefined()
  })

  it('returns 401 without a valid admin token', async () => {
    const app = await buildApp()

    const response = await app.inject({
      method: 'GET',
      url: '/admin',
      headers: { authorization: 'Bearer wrong' },
    })

    expect(response.statusCode).toBe(401)
  })

  it('returns 401 when Authorization header is absent', async () => {
    const app = await buildApp()

    const response = await app.inject({
      method: 'GET',
      url: '/admin',
    })

    expect(response.statusCode).toBe(401)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run test/admin.test.js
```
Expected: FAIL with `Cannot find module '../src/routes/admin.js'`

- [ ] **Step 3: Write `src/routes/admin.js`**

Create `src/routes/admin.js`:
```js
import { pool } from '../db/client.js'
import { boss, QUEUE_NAME } from '../queue/boss.js'
import { validateAdminToken } from '../plugins/authenticate.js'

export async function adminRoute(fastify) {
  fastify.get('/admin', { preHandler: validateAdminToken }, async (request, reply) => {
    const [{ rows }, queueSize] = await Promise.all([
      pool.query('SELECT COUNT(*) AS count FROM messages'),
      boss.getQueueSize(QUEUE_NAME),
    ])

    return reply.send({
      status: 'ok',
      totalMessages: parseInt(rows[0].count, 10),
      queueSize,
      timestamp: new Date().toISOString(),
    })
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run test/admin.test.js
```
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/routes/admin.js test/admin.test.js
git commit -m "feat: protected admin route with queue and message stats"
```

---

### Task 8: Server + App Entry Point

**Files:**
- Create: `src/server.js`
- Create: `src/app.js`

- [ ] **Step 1: Write `src/server.js`**

Create `src/server.js`:
```js
import Fastify from 'fastify'
import { webhookRoute } from './routes/webhook.js'
import { adminRoute } from './routes/admin.js'

export function buildServer() {
  const fastify = Fastify({
    logger: true,
    trustProxy: true,
  })

  fastify.get('/health', async () => ({ ok: true }))
  fastify.register(webhookRoute)
  fastify.register(adminRoute)

  return fastify
}
```

- [ ] **Step 2: Write `src/app.js`**

Create `src/app.js`:
```js
import { config } from './config.js'
import { pool } from './db/client.js'
import { runMigrations } from './db/migrate.js'
import { boss } from './queue/boss.js'
import { registerWorker } from './queue/worker.js'
import { buildServer } from './server.js'

async function main() {
  await runMigrations(pool)
  await boss.start()
  registerWorker(boss, pool)

  const server = buildServer()
  await server.listen({ port: config.port, host: '0.0.0.0' })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
```

- [ ] **Step 3: Run all tests to verify nothing broke**

```bash
npx vitest run
```
Expected: All test files PASS (migrate, boss, worker, authenticate, webhook, admin)

- [ ] **Step 4: Commit**

```bash
git add src/server.js src/app.js
git commit -m "feat: compose Fastify server and app entry point"
```

---

### Task 9: Railway Deployment Config

**Files:**
- Create: `railway.toml`

- [ ] **Step 1: Write `railway.toml`**

Create `railway.toml`:
```toml
[build]
builder = "NIXPACKS"

[deploy]
startCommand = "node src/app.js"
healthcheckPath = "/health"
healthcheckTimeout = 30
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3
```

- [ ] **Step 2: Commit**

```bash
git add railway.toml
git commit -m "feat: railway deployment config with healthcheck"
```

---

### Task 10: Smoke Test + Final Verification

- [ ] **Step 1: Run full test suite**

```bash
npx vitest run
```
Expected: All 6 test files PASS with 0 failures

- [ ] **Step 2: Start the server locally**

```bash
node src/app.js
```
Expected: Fastify logs `Server listening at http://0.0.0.0:3000`

- [ ] **Step 3: Smoke test the health endpoint**

```bash
curl http://localhost:3000/health
```
Expected: `{"ok":true}`

- [ ] **Step 4: Smoke test the webhook endpoint**

```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_WASSENGER_WEBHOOK_SECRET" \
  -d '{"event":"message.created","data":{"id":"test_msg_1","from":"+1234567890","conversationId":"conv_1","timestamp":"2026-05-12T10:00:00Z"}}'
```
Expected: `{"ok":true}`

- [ ] **Step 5: Smoke test the admin endpoint**

```bash
curl http://localhost:3000/admin \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```
Expected: `{"status":"ok","totalMessages":1,"queueSize":0,"timestamp":"..."}`

- [ ] **Step 6: Smoke test that non-message.created events are silently dropped**

```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_WASSENGER_WEBHOOK_SECRET" \
  -d '{"event":"message.updated","data":{}}'
```
Expected: `{"ok":true}` with 0 new rows in the messages table

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "chore: full test suite and smoke tests verified"
```

---

## Railway Deploy Checklist

After pushing to GitHub, set these env vars in the Railway dashboard before deploying:

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | Auto-filled by Railway Postgres plugin |
| `WASSENGER_WEBHOOK_SECRET` | From your Wassenger dashboard → Webhooks |
| `ADMIN_TOKEN` | A strong random string (e.g. `openssl rand -hex 32`) |
| `NODE_ENV` | `production` |
| `PORT` | Leave unset — Railway injects this automatically |

Point your Wassenger webhook URL to: `https://your-app.railway.app/webhook`
