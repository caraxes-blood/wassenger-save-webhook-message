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
          fromNumber: '+23206295535687',
          chat: { id: '23206295535687@lid' },
          timestamp: 1778584656,
        },
        rawPayload: { event: 'message:in:new', data: { id: 'msg_abc123' } },
      },
    }

    await processMessage(job, mockPool)

    expect(mockQuery).toHaveBeenCalledOnce()
    const [sql, params] = mockQuery.mock.calls[0]
    expect(sql).toContain('INSERT INTO messages')
    expect(params[0]).toBe('msg_abc123')
    expect(params[1]).toBe('+23206295535687')
    expect(params[2]).toBe('23206295535687@lid')
  })

  it('silently skips duplicate message_id (Postgres error code 23505)', async () => {
    const dupError = Object.assign(new Error('duplicate key'), { code: '23505' })
    const mockPool = { query: vi.fn().mockRejectedValue(dupError) }

    const { processMessage } = await import('../src/queue/worker.js')

    const job = {
      data: {
        data: { id: 'dup_id', fromNumber: '+1', chat: null, timestamp: 1778584656 },
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
        data: { id: 'msg_2', fromNumber: '+1', chat: null, timestamp: 1778584656 },
        rawPayload: {},
      },
    }

    await expect(processMessage(job, mockPool)).rejects.toThrow('connection refused')
  })
})
