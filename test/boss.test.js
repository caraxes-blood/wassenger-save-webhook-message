import { describe, it, expect, vi } from 'vitest'

vi.mock('pg-boss', () => ({
  default: class MockPgBoss {
    start = vi.fn().mockResolvedValue(undefined)
    stop = vi.fn().mockResolvedValue(undefined)
  }
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
