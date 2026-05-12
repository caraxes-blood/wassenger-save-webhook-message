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
