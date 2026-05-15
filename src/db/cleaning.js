const INSERT_CLEANED_SQL = `
  INSERT INTO cleaned_messages (
    message_id, sender, conversation_id, timestamp,
    raw_body, clean_body, intent, confidence, intent_signal,
    price_usd, watch_ref, condition, language, is_system
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
  ON CONFLICT (message_id) DO NOTHING
  RETURNING id
`

export async function insertCleanedMessage(client, f) {
  const { rows } = await client.query(INSERT_CLEANED_SQL, [
    f.messageId,
    f.sender,
    f.conversationId,
    f.timestamp,
    f.rawBody,
    f.cleanBody,
    f.intent,
    f.confidence,
    f.intentSignal,
    f.priceUsd ?? null,
    f.watchRef ?? null,
    f.condition ?? null,
    null,
    f.isSystem,
  ])
  return rows[0]?.id ?? null
}

const INSERT_DEAL_SQL = `
  INSERT INTO deals (
    message_id, cleaned_message_id, sender, conversation_id, timestamp,
    intent, confidence, intent_signal,
    price_usd, watch_ref, condition, language,
    clean_body, source
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
  ON CONFLICT (message_id, source) DO NOTHING
`

export async function insertDeal(client, f) {
  await client.query(INSERT_DEAL_SQL, [
    f.messageId,
    f.cleanedMessageId,
    f.sender,
    f.conversationId,
    f.timestamp,
    f.intent,
    f.confidence,
    f.intentSignal,
    f.priceUsd ?? null,
    f.watchRef ?? null,
    f.condition ?? null,
    null,
    f.cleanBody,
    f.source,
  ])
}

export async function markProcessed(client, messageId) {
  await client.query(
    'UPDATE messages SET processed_at = NOW() WHERE message_id = $1',
    [messageId],
  )
}
