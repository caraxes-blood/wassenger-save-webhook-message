import { cleanText, isSystem, classify, extractPrice, extractRef, extractCondition } from '../cleaning/pipeline.js'
import { insertCleanedMessage, insertDeal, markProcessed } from '../db/cleaning.js'

const INSERT_MESSAGES_SQL = `
  INSERT INTO messages (message_id, sender, conversation_id, timestamp, payload, is_relevant, skip_reason)
  VALUES ($1, $2, $3, $4, $5, $6, $7)
  ON CONFLICT (message_id) DO NOTHING
`

export function classifyRelevance(data) {
  if (data.flow !== 'inbound')
    return { is_relevant: false, skip_reason: 'outbound' }
  if (data.type !== 'text' && data.type !== 'image')
    return { is_relevant: false, skip_reason: 'non_text_or_image' }
  if (data.meta?.isNotification)
    return { is_relevant: false, skip_reason: 'notification' }
  if (data.meta?.isBizNotification)
    return { is_relevant: false, skip_reason: 'biz_notification' }
  if (!data.body?.trim())
    return { is_relevant: false, skip_reason: 'empty_body' }
  return { is_relevant: true, skip_reason: null }
}

export async function processMessage(job, pool) {
  const { data, rawPayload } = job.data
  const { is_relevant, skip_reason } = classifyRelevance(data)
  const sender         = data.fromNumber ?? data.from
  const conversationId = data.chat?.id ?? null
  const timestamp      = new Date(data.timestamp * 1000)

  const client = await pool.connect()
  try {
    // Step 1: persist raw message (auto-commit per query)
    try {
      await client.query(INSERT_MESSAGES_SQL, [
        data.id, sender, conversationId, timestamp,
        JSON.stringify(rawPayload), is_relevant, skip_reason,
      ])
    } catch (err) {
      if (err.code === '23505') return
      throw err
    }

    if (!is_relevant) return

    // Step 2: run cleaning pipeline (pure in-memory, no I/O)
    const rawBody   = data.body ?? ''
    const cleanBody = cleanText(rawBody)
    if (!cleanBody) return

    const systemMsg = isSystem(sender, cleanBody)
    const [intent, confidence, intentSignal] = systemMsg
      ? ['SKIP', 1.0, 'system']
      : classify(cleanBody)

    const priceUsd  = extractPrice(cleanBody)
    const watchRef  = extractRef(cleanBody)
    const condition = extractCondition(cleanBody)

    // Step 3: atomic write — cleaned_messages + deals + processed_at
    await client.query('BEGIN')
    const cleanedId = await insertCleanedMessage(client, {
      messageId: data.id, sender, conversationId, timestamp,
      rawBody, cleanBody, intent, confidence, intentSignal,
      priceUsd, watchRef, condition, isSystem: systemMsg,
    })

    if (cleanedId === null) {
      // UNIQUE conflict → already cleaned on a previous attempt, idempotent exit
      await client.query('ROLLBACK')
      return
    }

    if (intent !== 'SKIP') {
      await insertDeal(client, {
        messageId: data.id, cleanedMessageId: cleanedId,
        sender, conversationId, timestamp,
        intent, confidence, intentSignal,
        priceUsd, watchRef, condition,
        cleanBody, source: 'rules',
      })
    }

    await markProcessed(client, data.id)
    await client.query('COMMIT')
  } catch (err) {
    try { await client.query('ROLLBACK') } catch {}
    throw err
  } finally {
    client.release()
  }
}

export function registerWorker(boss, pool) {
  return boss.work(
    'wassenger.message',
    { teamSize: 5, teamConcurrency: 5 },
    (jobs) => Promise.all(jobs.map((job) => processMessage(job, pool))),
  )
}
