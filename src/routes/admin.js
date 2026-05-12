import { pool } from '../db/client.js'
import { boss, QUEUE_NAME } from '../queue/boss.js'
import { validateAdminToken } from '../plugins/authenticate.js'

export async function adminRoute(fastify) {
  fastify.get('/admin', { preHandler: validateAdminToken }, async (request, reply) => {
    const [{ rows }, queueSize] = await Promise.all([
      pool.query('SELECT COUNT(*) AS count FROM messages'),
      boss.getQueueSize(QUEUE_NAME),
    ])

    return reply.send({
      status: 'ok',
      totalMessages: parseInt(rows[0].count, 10),
      queueSize,
      timestamp: new Date().toISOString(),
    })
  })
}
