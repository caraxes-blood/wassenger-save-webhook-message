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
