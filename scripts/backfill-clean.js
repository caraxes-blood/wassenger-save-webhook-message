/**
 * Backfill script — cleans all messages where is_relevant=true AND processed_at IS NULL.
 *
 * Run: node scripts/backfill-clean.js
 * Requires DATABASE_URL in .env (same as the main server).
 */

import 'dotenv/config'
import pg from 'pg'
import {
  cleanText, isSystem, classify,
  extractPrice, extractRef, extractCondition,
} from '../src/cleaning/pipeline.js'
import { insertCleanedMessage, insertDeal, markProcessed } from '../src/db/cleaning.js'

const BATCH_SIZE = 100

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

const FETCH_SQL = `
  SELECT message_id, sender, conversation_id, timestamp, payload
  FROM messages
  WHERE is_relevant = true AND processed_at IS NULL
  ORDER BY timestamp
  LIMIT $1
`

const COUNT_SQL = `
  SELECT COUNT(*) AS total
  FROM messages
  WHERE is_relevant = true AND processed_at IS NULL
`

const STAMP_SQL = `
  UPDATE messages SET processed_at = NOW() WHERE message_id = $1
`

async function processRow(client, row) {
  const body = row.payload?.data?.body ?? ''
  const cleanBody = cleanText(body)

  if (!cleanBody) {
    // Empty after cleaning — stamp and skip, no cleaned_message row
    await client.query(STAMP_SQL, [row.message_id])
    return 'empty'
  }

  const systemMsg = isSystem(row.sender, cleanBody)
  const [intent, confidence, intentSignal] = systemMsg
    ? ['SKIP', 1.0, 'system']
    : classify(cleanBody)

  const priceUsd  = extractPrice(cleanBody)
  const watchRef  = extractRef(cleanBody)
  const condition = extractCondition(cleanBody)

  await client.query('BEGIN')

  const cleanedId = await insertCleanedMessage(client, {
    messageId:      row.message_id,
    sender:         row.sender,
    conversationId: row.conversation_id,
    timestamp:      row.timestamp,
    rawBody:        body,
    cleanBody,
    intent,
    confidence,
    intentSignal,
    priceUsd,
    watchRef,
    condition,
    isSystem:       systemMsg,
  })

  if (cleanedId === null) {
    // Already cleaned (UNIQUE conflict) — just stamp processed_at
    await markProcessed(client, row.message_id)
    await client.query('COMMIT')
    return 'already_done'
  }

  if (intent !== 'SKIP') {
    await insertDeal(client, {
      messageId:        row.message_id,
      cleanedMessageId: cleanedId,
      sender:           row.sender,
      conversationId:   row.conversation_id,
      timestamp:        row.timestamp,
      intent,
      confidence,
      intentSignal,
      priceUsd,
      watchRef,
      condition,
      cleanBody,
      source: 'rules',
    })
  }

  await markProcessed(client, row.message_id)
  await client.query('COMMIT')
  return intent
}

async function main() {
  const { rows: [{ total }] } = await pool.query(COUNT_SQL)
  const pending = parseInt(total, 10)
  console.log(`Pending messages to clean: ${pending}`)

  if (pending === 0) {
    console.log('Nothing to do.')
    await pool.end()
    return
  }

  const counts = { deals: 0, system: 0, empty: 0, already_done: 0, errors: 0 }
  let processed = 0

  while (true) {
    // Always fetch at offset 0 — processed rows drop off the WHERE clause
    const { rows } = await pool.query(FETCH_SQL, [BATCH_SIZE])
    if (rows.length === 0) break

    const settled = await Promise.allSettled(rows.map(async (row) => {
      const client = await pool.connect()
      try {
        return await processRow(client, row)
      } catch (err) {
        try { await client.query('ROLLBACK') } catch {}
        try { await pool.query(STAMP_SQL, [row.message_id]) } catch {}
        console.error(`  Error on ${row.message_id}: ${err.message}`)
        throw err
      } finally {
        client.release()
      }
    }))

    for (const outcome of settled) {
      if (outcome.status === 'rejected') { counts.errors++; }
      else if (outcome.value === 'empty')        counts.empty++
      else if (outcome.value === 'already_done') counts.already_done++
      else if (outcome.value === 'SKIP')         counts.system++
      else                                       counts.deals++
      processed++
    }

    const pct = Math.min(100, ((processed / pending) * 100)).toFixed(1)
    process.stdout.write(`\r  ${processed}/${pending} (${pct}%)  `)
  }

  console.log('\n\nDone.')
  console.log(`  Actionable deals written : ${counts.deals}`)
  console.log(`  SKIP / system messages   : ${counts.system}`)
  console.log(`  Empty after cleaning     : ${counts.empty}`)
  console.log(`  Already cleaned          : ${counts.already_done}`)
  console.log(`  Errors (stamped, skipped): ${counts.errors}`)

  await pool.end()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
