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
