import Fastify from 'fastify'
import fjwt from '@fastify/jwt'
import fcookie from '@fastify/cookie'
import cors from '@fastify/cors'
import { config } from './config.js'
import { webhookRoute } from './routes/webhook.js'
import { adminRoute } from './routes/admin.js'
import { authRoute } from './routes/auth.js'
import { messagesRoute } from './routes/messages.js'
import { cleanedMessagesRoute } from './routes/cleanedMessages.js'

export function buildServer() {
  const fastify = Fastify({ logger: true, trustProxy: true })

  fastify.register(cors, {
    origin: config.corsOrigin,
    credentials: true,
  })

  fastify.register(fcookie)

  fastify.register(fjwt, {
    secret: config.jwtSecret,
    cookie: { cookieName: 'token', signed: false },
  })

  fastify.get('/health', async () => ({ ok: true }))
  fastify.register(webhookRoute)
  fastify.register(authRoute)

  fastify.register(async (instance) => {
    instance.addHook('onRequest', async (request, reply) => {
      try {
        await request.jwtVerify()
      } catch {
        return reply.code(401).send({ error: 'Unauthorized' })
      }
    })
    instance.register(adminRoute)
    instance.register(messagesRoute)
    instance.register(cleanedMessagesRoute)
  })

  return fastify
}
