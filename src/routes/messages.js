import { pool } from '../db/client.js'
import { QUEUE_NAME } from '../queue/boss.js'

export async function messagesRoute(fastify) {
  fastify.get('/messages', async (request, reply) => {
    const limit = Math.min(parseInt(request.query.limit ?? '20', 10), 100)
    const cursor = request.query.cursor

    const { rows } = cursor
      ? await pool.query(
          `SELECT id, message_id, sender, conversation_id, timestamp, payload, created_at
           FROM messages
           WHERE created_at < $1
           ORDER BY created_at DESC
           LIMIT $2`,
          [cursor, limit + 1]
        )
      : await pool.query(
          `SELECT id, message_id, sender, conversation_id, timestamp, payload, created_at
           FROM messages
           ORDER BY created_at DESC
           LIMIT $1`,
          [limit + 1]
        )

    const hasMore = rows.length > limit
    if (hasMore) rows.pop()

    return reply.send({
      data: rows,
      nextCursor: hasMore ? rows[rows.length - 1].created_at.toISOString() : null,
    })
  })

  fastify.get('/messages/failed', async (request, reply) => {
    const limit = Math.min(parseInt(request.query.limit ?? '20', 10), 100)
    const cursor = request.query.cursor

    const { rows } = cursor
      ? await pool.query(
          `SELECT id, name, data, output, created_on, started_on, completed_on
           FROM pgboss.job
           WHERE name = $1 AND state = 'failed' AND created_on < $2
           ORDER BY created_on DESC
           LIMIT $3`,
          [QUEUE_NAME, cursor, limit + 1]
        )
      : await pool.query(
          `SELECT id, name, data, output, created_on, started_on, completed_on
           FROM pgboss.job
           WHERE name = $1 AND state = 'failed'
           ORDER BY created_on DESC
           LIMIT $2`,
          [QUEUE_NAME, limit + 1]
        )

    const hasMore = rows.length > limit
    if (hasMore) rows.pop()

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
      nextCursor: hasMore ? rows[rows.length - 1].created_on.toISOString() : null,
    })
  })
}
