import { boss, QUEUE_NAME } from '../queue/boss.js'
import { activeGroups } from '../cache/activeGroups.js'

export async function webhookRoute(fastify) {
  fastify.post('/webhook', async (request, reply) => {
    const payload = request.body

    if (payload?.event !== 'message:in:new') {
      return reply.send({ ok: true })
    }

    const { data } = payload
    const chatId = data.chat?.id

    if (!chatId || !activeGroups.has(chatId)) {
      return reply.send({ ok: true })
    }

    await boss.send(QUEUE_NAME, { data, rawPayload: payload }, { singletonKey: data.id })

    return reply.send({ ok: true })
  })
}
