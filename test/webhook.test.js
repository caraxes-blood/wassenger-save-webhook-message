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

  it('returns 200 and enqueues message:in:new events', async () => {
    const app = await buildApp()
    const payload = {
      event: 'message:in:new',
      data: {
        id: 'msg_1',
        fromNumber: '+1234567890',
        chat: { id: 'conv_1' },
        timestamp: 1778584656,
      },
    }

    const response = await app.inject({
      method: 'POST',
      url: '/webhook',
      headers: { 'content-type': 'application/json' },
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

  it('returns 200 but does NOT enqueue non-message:in:new events', async () => {
    const app = await buildApp()

    const response = await app.inject({
      method: 'POST',
      url: '/webhook',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'message:out:new', data: {} }),
    })

    expect(response.statusCode).toBe(200)
    expect(mockSendOnce).not.toHaveBeenCalled()
  })
})
