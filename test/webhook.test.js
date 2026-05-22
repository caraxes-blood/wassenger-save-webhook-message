import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'

const mockSend = vi.fn().mockResolvedValue('job-id-123')

vi.mock('../src/queue/boss.js', () => ({
  boss: { send: mockSend },
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

vi.mock('../src/cache/activeGroups.js', () => ({
  activeGroups: new Set(['conv_1']),
  initActiveGroupsCache: vi.fn(),
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
    expect(mockSend).toHaveBeenCalledWith(
      'wassenger.message',
      expect.objectContaining({ data: payload.data, rawPayload: payload }),
      { singletonKey: 'msg_1' }
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
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('returns 200 but does NOT enqueue messages from inactive groups', async () => {
    const app = await buildApp()
    const payload = {
      event: 'message:in:new',
      data: {
        id: 'msg_2',
        fromNumber: '+1234567890',
        chat: { id: 'inactive_group' },
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
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('returns 200 but does NOT enqueue messages with no chat id', async () => {
    const app = await buildApp()
    const payload = {
      event: 'message:in:new',
      data: { id: 'msg_3', fromNumber: '+1234567890', timestamp: 1778584656 },
    }

    const response = await app.inject({
      method: 'POST',
      url: '/webhook',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })

    expect(response.statusCode).toBe(200)
    expect(mockSend).not.toHaveBeenCalled()
  })
})
