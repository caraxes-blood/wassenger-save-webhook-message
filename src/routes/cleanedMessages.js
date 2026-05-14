import { pool } from '../db/client.js'

export async function cleanedMessagesRoute(fastify) {
  fastify.get('/cleaned-messages', async (request, reply) => {
    const limit = Math.min(parseInt(request.query.limit ?? '20', 10), 100)
    const page = Math.max(parseInt(request.query.page ?? '1', 10), 1)
    const offset = (page - 1) * limit

    const conditions = []
    const params = [limit, offset]

    if (request.query.intent !== undefined) {
      params.push(request.query.intent)
      conditions.push(`intent = $${params.length}`)
    }

    if (request.query.is_system !== undefined) {
      params.push(request.query.is_system === 'true')
      conditions.push(`is_system = $${params.length}`)
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    const [{ rows }, { rows: countRows }] = await Promise.all([
      pool.query(
        `SELECT id, message_id, sender, conversation_id, timestamp,
                clean_body, intent, confidence, intent_signal,
                price_usd, watch_ref, condition, language,
                is_system, processed_at
         FROM cleaned_messages
         ${where}
         ORDER BY timestamp DESC
         LIMIT $1 OFFSET $2`,
        params
      ),
      pool.query(
        `SELECT COUNT(*) AS total FROM cleaned_messages ${where}`,
        params.slice(2)
      ),
    ])

    const total = parseInt(countRows[0].total, 10)
    const totalPages = Math.ceil(total / limit)

    return reply.send({
      data: rows,
      total,
      page,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    })
  })
}
