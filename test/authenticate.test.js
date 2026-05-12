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
