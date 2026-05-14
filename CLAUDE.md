# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start              # production server
npm run dev            # dev server with --watch hot reload
npm test               # run all tests
npm run test:coverage  # tests with coverage report
npx vitest run test/webhook.test.js  # run a single test file
```

## Required Environment Variables

```
DATABASE_URL=postgresql://user:password@localhost:5432/wassenger
JWT_SECRET=<random secret>
ADMIN_USERNAME=<username>
ADMIN_PASSWORD=<password>
CORS_ORIGIN=<allowed origin>
PORT=3000  # optional, defaults to 3000
```

## Architecture

**Startup sequence** (`src/app.js`): DB migrations → pg-boss start → create queue → register worker → Fastify listen. Everything runs sequentially before the server accepts traffic.

**Route structure** (`src/server.js`):
- Public: `POST /webhook`, `POST /auth/login`, `POST /auth/logout`, `GET /health`
- JWT-protected (cookie `token`): `GET /admin`, `GET /messages`, `GET /messages/failed`

**Webhook flow**: Wassenger POSTs to `/webhook` with no authentication required. Only `message:in:new` events are enqueued; all other event types return `200 { ok: true }` immediately. The job is deduplicated via `singletonKey: data.id` in `boss.send()`.

**Worker** (`src/queue/worker.js`): pg-boss v10 delivers an **array** of jobs per handler invocation (not a single job). Worker inserts into `messages` with `ON CONFLICT (message_id) DO NOTHING` — duplicate protection exists at both the queue layer (singletonKey) and DB layer. Non-duplicate DB errors are re-thrown so pg-boss retries (up to 3 times with 5s delay).

**Auth**: JWT issued via `POST /auth/login` with `ADMIN_USERNAME`/`ADMIN_PASSWORD`, stored as `httpOnly` cookie (`token`). The JWT-protected scope uses a Fastify `onRequest` hook in `server.js` to verify the JWT before any protected route handler runs.

**Migrations**: Single SQL block executed via `pool.query()` on every startup. Uses `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` — safe to run repeatedly.

**Pagination**: `GET /messages` and `GET /messages/failed` use offset-based pagination with query params `page` (default 1) and `limit` (default 20, max 100). Response includes `total`, `totalPages`, `hasNext`, `hasPrev`.

## Testing Patterns

Tests use Vitest with `vi.mock()` — no real DB or pg-boss connection needed. Standard mocks used across test files:

```js
vi.mock('../src/config.js', () => ({ config: { databaseUrl: 'postgresql://x', jwtSecret: 'test-secret', ... } }))
vi.mock('../src/queue/boss.js', () => ({ boss: { send: vi.fn() }, QUEUE_NAME: 'wassenger.message' }))
vi.mock('../src/db/client.js', () => ({ pool: { query: vi.fn() } }))
```

Route tests build an isolated Fastify instance via `app.inject()`:

```js
const app = Fastify()
await app.register(webhookRoute)
const response = await app.inject({ method: 'POST', url: '/webhook', ... })
```

## Notes

- ESM-only project (`"type": "module"`). All imports must use `.js` extension.
- `src/plugins/authenticate.js` (webhook secret + bearer token auth) is a legacy file not wired into the current server; the server uses JWT middleware instead.
- pg-boss manages its own schema in the `pgboss` schema. `GET /messages/failed` queries `pgboss.job` directly for failed jobs in the `wassenger.message` queue.
