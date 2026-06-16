import { pool } from '../db/client.js'
import { QUEUE_NAME } from '../queue/boss.js'

export async function messagesRoute(fastify) {
  fastify.get('/messages', async (request, reply) => {
    const limit = Math.min(parseInt(request.query.limit ?? '20', 10), 100)
    const page = Math.max(parseInt(request.query.page ?? '1', 10), 1)
    const offset = (page - 1) * limit

    const [{ rows }, { rows: countRows }] = await Promise.all([
      pool.query(
        `SELECT id, message_id, sender, conversation_id, timestamp, created_at,
                is_relevant, skip_reason, processed_at, type, group_name, message_body,
                caption, image_url
         FROM messages
         ORDER BY created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
      pool.query('SELECT COUNT(*) AS total FROM messages'),
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

  fastify.get('/messages/failed', async (request, reply) => {
    const limit = Math.min(parseInt(request.query.limit ?? '20', 10), 100)
    const page = Math.max(parseInt(request.query.page ?? '1', 10), 1)
    const offset = (page - 1) * limit

    const [{ rows }, { rows: countRows }] = await Promise.all([
      pool.query(
        `SELECT id, name, data, output, created_on, started_on, completed_on
         FROM pgboss.job
         WHERE name = $1 AND state = 'failed'
         ORDER BY created_on DESC
         LIMIT $2 OFFSET $3`,
        [QUEUE_NAME, limit, offset]
      ),
      pool.query(
        `SELECT COUNT(*) AS total FROM pgboss.job WHERE name = $1 AND state = 'failed'`,
        [QUEUE_NAME]
      ),
    ])

    const total = parseInt(countRows[0].total, 10)
    const totalPages = Math.ceil(total / limit)

    return reply.send({
      data: rows.map((row) => ({
        jobId: row.id,
        messageId: row.data?.data?.id,
        from: row.data?.data?.fromNumber,
        body: row.data?.data?.body,
        type: row.data?.data?.type,
        failedAt: row.completed_on,
        createdAt: row.created_on,
        error: row.output?.message,
      })),
      total,
      page,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    })
  })
}
