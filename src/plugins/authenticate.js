import { config } from '../config.js'

export async function validateWebhookSecret(request, reply, done) {
  if (request.headers['x-api-key'] !== config.webhookSecret) {
    return reply.code(401).send({ error: 'Unauthorized' })
  }
  done()
}

export async function validateAdminToken(request, reply, done) {
  const token = request.headers.authorization?.replace('Bearer ', '')
  if (token !== config.adminToken) {
    return reply.code(401).send({ error: 'Unauthorized' })
  }
  done()
}
