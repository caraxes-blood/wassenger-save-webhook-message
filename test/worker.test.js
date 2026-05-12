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
