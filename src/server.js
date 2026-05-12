import Fastify from 'fastify'
import { webhookRoute } from './routes/webhook.js'
import { adminRoute } from './routes/admin.js'

export function buildServer() {
  const fastify = Fastify({
    logger: true,
    trustProxy: true,
  })

  fastify.get('/health', async () => ({ ok: true }))
  fastify.register(webhookRoute)
  fastify.register(adminRoute)

  return fastify
}
