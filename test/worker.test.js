import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/cleaning/pipeline.js', () => ({
  cleanText:        vi.fn().mockReturnValue('WTS Rolex 126710BLNR $14k BNIB'),
  isSystem:         vi.fn().mockReturnValue(false),
  classify:         vi.fn().mockReturnValue(['WTS', 0.92, 'inferred:price+ref']),
  extractPrice:     vi.fn().mockReturnValue(14000),
  extractRef:       vi.fn().mockReturnValue('126710BLNR'),
  extractCondition: vi.fn().mockReturnValue('BNIB'),
}))

vi.mock('../src/db/cleaning.js', () => ({
  insertCleanedMessage: vi.fn().mockResolvedValue('uuid-1'),
  insertDeal:           vi.fn().mockResolvedValue(undefined),
  markProcessed:        vi.fn().mockResolvedValue(undefined),
}))

import { classifyRelevance, processMessage } from '../src/queue/worker.js'
import {
  cleanText, isSystem, classify,
  extractPrice, extractRef, extractCondition,
} from '../src/cleaning/pipeline.js'
import { insertCleanedMessage, insertDeal, markProcessed } from '../src/db/cleaning.js'

function makeClient() {
  return {
    query:   vi.fn().mockResolvedValue({ rows: [] }),
    release: vi.fn(),
  }
}

function makePool(client) {
  return { connect: vi.fn().mockResolvedValue(client) }
}

function makeJob(dataOverrides = {}) {
  return {
    data: {
      data: {
        id:         'msg-1',
        flow:       'inbound',
        type:       'text',
        body:       'WTS Rolex 126710BLNR $14k BNIB',
        fromNumber: '+1234567890',
        chat:       { id: 'conv-1' },
        timestamp:  1700000000,
        meta:       {},
        ...dataOverrides,
      },
      rawPayload: { event: 'message:in:new' },
    },
  }
}

describe('classifyRelevance', () => {
  it('returns is_relevant true for inbound text with body', () => {
    expect(classifyRelevance({ flow: 'inbound', type: 'text', body: 'hello', meta: {} }))
      .toEqual({ is_relevant: true, skip_reason: null })
  })
  it('returns false skip_reason "outbound" for outbound messages', () => {
    const r = classifyRelevance({ flow: 'outbound', type: 'text', body: 'hi', meta: {} })
    expect(r.is_relevant).toBe(false)
    expect(r.skip_reason).toBe('outbound')
  })
  it('returns false skip_reason "non_text_or_image" for document type', () => {
    const r = classifyRelevance({ flow: 'inbound', type: 'document', body: 'x', meta: {} })
    expect(r.is_relevant).toBe(false)
    expect(r.skip_reason).toBe('non_text_or_image')
  })
  it('returns false for notification', () => {
    const r = classifyRelevance({ flow: 'inbound', type: 'text', body: 'x', meta: { isNotification: true } })
    expect(r.is_relevant).toBe(false)
    expect(r.skip_reason).toBe('notification')
  })
  it('returns false for empty body', () => {
    const r = classifyRelevance({ flow: 'inbound', type: 'text', body: '', meta: {} })
    expect(r.is_relevant).toBe(false)
    expect(r.skip_reason).toBe('empty_body')
  })
})

describe('processMessage — messages insert', () => {
  beforeEach(() => vi.clearAllMocks())

  it('acquires a client from the pool', async () => {
    const client = makeClient()
    const pool = makePool(client)
    await processMessage(makeJob(), pool)
    expect(pool.connect).toHaveBeenCalledOnce()
  })

  it('inserts into messages table with correct message_id', async () => {
    const client = makeClient()
    await processMessage(makeJob(), makePool(client))
    const insertCall = client.query.mock.calls.find(c => c[0].includes('INSERT INTO messages'))
    expect(insertCall).toBeDefined()
    expect(insertCall[1][0]).toBe('msg-1')
  })

  it('returns early and does not throw on duplicate key (23505)', async () => {
    const client = makeClient()
    const dupError = Object.assign(new Error('dup'), { code: '23505' })
    client.query.mockRejectedValueOnce(dupError)
    await expect(processMessage(makeJob(), makePool(client))).resolves.not.toThrow()
  })

  it('rethrows non-duplicate DB errors', async () => {
    const client = makeClient()
    client.query.mockRejectedValueOnce(new Error('connection lost'))
    await expect(processMessage(makeJob(), makePool(client))).rejects.toThrow('connection lost')
  })

  it('releases client even when messages insert throws', async () => {
    const client = makeClient()
    client.query.mockRejectedValueOnce(new Error('boom'))
    await expect(processMessage(makeJob(), makePool(client))).rejects.toThrow()
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('skips cleaning and releases client for irrelevant messages', async () => {
    const client = makeClient()
    await processMessage(makeJob({ flow: 'outbound' }), makePool(client))
    expect(insertCleanedMessage).not.toHaveBeenCalled()
    expect(client.release).toHaveBeenCalledOnce()
  })
})

describe('processMessage — cleaning', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls insertCleanedMessage with correct messageId and intent', async () => {
    const client = makeClient()
    await processMessage(makeJob(), makePool(client))
    expect(insertCleanedMessage).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ messageId: 'msg-1', intent: 'WTS', confidence: 0.92 }),
    )
  })

  it('calls insertDeal for non-SKIP intent', async () => {
    const client = makeClient()
    await processMessage(makeJob(), makePool(client))
    expect(insertDeal).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ messageId: 'msg-1', source: 'rules', cleanedMessageId: 'uuid-1' }),
    )
  })

  it('does NOT call insertDeal for SKIP intent', async () => {
    classify.mockReturnValueOnce(['SKIP', 0.50, ''])
    const client = makeClient()
    await processMessage(makeJob(), makePool(client))
    expect(insertDeal).not.toHaveBeenCalled()
  })

  it('calls markProcessed after successful cleaning', async () => {
    const client = makeClient()
    await processMessage(makeJob(), makePool(client))
    expect(markProcessed).toHaveBeenCalledWith(client, 'msg-1')
  })

  it('commits the cleaning transaction on success', async () => {
    const client = makeClient()
    await processMessage(makeJob(), makePool(client))
    expect(client.query).toHaveBeenCalledWith('COMMIT')
  })

  it('returns early without cleaning when cleanText returns empty string', async () => {
    cleanText.mockReturnValueOnce('')
    const client = makeClient()
    await processMessage(makeJob(), makePool(client))
    expect(insertCleanedMessage).not.toHaveBeenCalled()
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('issues ROLLBACK and returns early when insertCleanedMessage returns null (conflict)', async () => {
    insertCleanedMessage.mockResolvedValueOnce(null)
    const client = makeClient()
    await processMessage(makeJob(), makePool(client))
    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect(insertDeal).not.toHaveBeenCalled()
    expect(markProcessed).not.toHaveBeenCalled()
  })

  it('issues ROLLBACK and rethrows when cleaning write throws', async () => {
    insertCleanedMessage.mockRejectedValueOnce(new Error('db write failed'))
    const client = makeClient()
    await expect(processMessage(makeJob(), makePool(client))).rejects.toThrow('db write failed')
    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('uses SKIP intent and skips classify for system messages', async () => {
    isSystem.mockReturnValueOnce(true)
    const client = makeClient()
    await processMessage(makeJob(), makePool(client))
    expect(classify).not.toHaveBeenCalled()
    expect(insertCleanedMessage).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ intent: 'SKIP', confidence: 1.0, intentSignal: 'system', isSystem: true }),
    )
  })
})
