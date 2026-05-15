import { describe, it, expect, vi } from 'vitest'
import { insertCleanedMessage, insertDeal, markProcessed } from '../../src/db/cleaning.js'

function makeClient(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) }
}

const BASE_FIELDS = {
  messageId: 'msg-1',
  sender: '+1234567890',
  conversationId: 'conv-1',
  timestamp: new Date('2026-01-01T00:00:00Z'),
  rawBody: 'raw text',
  cleanBody: 'clean text',
  intent: 'WTS',
  confidence: 0.92,
  intentSignal: 'inferred:price+ref',
  priceUsd: 14000,
  watchRef: '126710BLNR',
  condition: 'BNIB',
  isSystem: false,
}

describe('insertCleanedMessage', () => {
  it('returns the new UUID on success', async () => {
    const client = makeClient([{ id: 'uuid-abc' }])
    const id = await insertCleanedMessage(client, BASE_FIELDS)
    expect(id).toBe('uuid-abc')
  })

  it('executes INSERT INTO cleaned_messages with ON CONFLICT DO NOTHING RETURNING id', async () => {
    const client = makeClient([{ id: 'uuid-abc' }])
    await insertCleanedMessage(client, BASE_FIELDS)
    const [sql] = client.query.mock.calls[0]
    expect(sql).toContain('INSERT INTO cleaned_messages')
    expect(sql).toContain('ON CONFLICT (message_id) DO NOTHING')
    expect(sql).toContain('RETURNING id')
  })

  it('passes message_id as first parameter', async () => {
    const client = makeClient([{ id: 'uuid-abc' }])
    await insertCleanedMessage(client, BASE_FIELDS)
    const [, params] = client.query.mock.calls[0]
    expect(params[0]).toBe('msg-1')
  })

  it('writes null for language column', async () => {
    const client = makeClient([{ id: 'uuid-abc' }])
    await insertCleanedMessage(client, BASE_FIELDS)
    const [, params] = client.query.mock.calls[0]
    expect(params).toContain(null)
  })

  it('returns null when UNIQUE conflict fires (empty RETURNING)', async () => {
    const client = makeClient([])
    const id = await insertCleanedMessage(client, BASE_FIELDS)
    expect(id).toBeNull()
  })

  it('passes null for optional fields when undefined', async () => {
    const client = makeClient([{ id: 'uuid-abc' }])
    await insertCleanedMessage(client, {
      ...BASE_FIELDS,
      priceUsd: undefined,
      watchRef: undefined,
      condition: undefined,
    })
    const [, params] = client.query.mock.calls[0]
    const nullCount = params.filter(p => p === null).length
    expect(nullCount).toBeGreaterThanOrEqual(3) // priceUsd, watchRef, condition, language
  })
})

describe('insertDeal', () => {
  const DEAL_FIELDS = {
    messageId: 'msg-1',
    cleanedMessageId: 'uuid-abc',
    sender: '+1234567890',
    conversationId: 'conv-1',
    timestamp: new Date('2026-01-01T00:00:00Z'),
    intent: 'WTS',
    confidence: 0.92,
    intentSignal: 'inferred:price+ref',
    priceUsd: 14000,
    watchRef: '126710BLNR',
    condition: 'BNIB',
    cleanBody: 'clean text',
    source: 'rules',
  }

  it('executes INSERT INTO deals with ON CONFLICT (message_id, source) DO NOTHING', async () => {
    const client = makeClient()
    await insertDeal(client, DEAL_FIELDS)
    const [sql] = client.query.mock.calls[0]
    expect(sql).toContain('INSERT INTO deals')
    expect(sql).toContain('ON CONFLICT (message_id, source) DO NOTHING')
  })

  it('passes message_id as first parameter', async () => {
    const client = makeClient()
    await insertDeal(client, DEAL_FIELDS)
    const [, params] = client.query.mock.calls[0]
    expect(params[0]).toBe('msg-1')
  })

  it('passes source as last parameter with value "rules"', async () => {
    const client = makeClient()
    await insertDeal(client, DEAL_FIELDS)
    const [, params] = client.query.mock.calls[0]
    expect(params[params.length - 1]).toBe('rules')
  })
})

describe('markProcessed', () => {
  it('updates processed_at for the given message_id', async () => {
    const client = makeClient()
    await markProcessed(client, 'msg-1')
    const [sql, params] = client.query.mock.calls[0]
    expect(sql).toContain('UPDATE messages')
    expect(sql).toContain('processed_at')
    expect(params[0]).toBe('msg-1')
  })
})
