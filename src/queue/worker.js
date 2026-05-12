const INSERT_SQL = `
  INSERT INTO messages (message_id, sender, conversation_id, timestamp, payload)
  VALUES ($1, $2, $3, $4, $5)
  ON CONFLICT (message_id) DO NOTHING
`

export async function processMessage(job, pool) {
  const { data, rawPayload } = job.data
  try {
    await pool.query(INSERT_SQL, [
      data.id,
      data.from,
      data.conversationId ?? null,
      new Date(data.timestamp),
      JSON.stringify(rawPayload),
    ])
  } catch (err) {
    if (err.code === '23505') return
    throw err
  }
}

export function registerWorker(boss, pool) {
  return boss.work(
    'wassenger.message',
    { teamSize: 5, teamConcurrency: 5 },
    (job) => processMessage(job, pool)
  )
}
