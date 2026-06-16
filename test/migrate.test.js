import { describe, it, expect, vi } from 'vitest'

describe('runMigrations', () => {
  it('creates messages table without payload column', async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rows: [] })
    const { runMigrations } = await import('../src/db/migrate.js')
    await runMigrations({ query: mockQuery })
    const allSql = mockQuery.mock.calls.map(c => c[0]).join('\n')
    expect(allSql).toContain('CREATE TABLE IF NOT EXISTS messages')
    expect(allSql).toContain('image_url')
  })

  it('creates UNIQUE index on cleaned_messages(message_id)', async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rows: [] })
    const { runMigrations } = await import('../src/db/migrate.js')
    await runMigrations({ query: mockQuery })
    const allSql = mockQuery.mock.calls.map(c => c[0]).join('\n')
    expect(allSql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uniq_cleaned_messages_message_id')
  })

  it('creates UNIQUE index on deals(message_id, source)', async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rows: [] })
    const { runMigrations } = await import('../src/db/migrate.js')
    await runMigrations({ query: mockQuery })
    const allSql = mockQuery.mock.calls.map(c => c[0]).join('\n')
    expect(allSql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uniq_deals_message_id_source')
  })
})
