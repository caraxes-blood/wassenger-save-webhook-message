import { boss, QUEUE_NAME } from '../queue/boss.js'

export async function webhookRoute(fastify) {
  fastify.post('/webhook', async (request, reply) => {
    const payload = request.body

    if (payload?.event !== 'message:in:new') {
      return reply.send({ ok: true })
    }

    const { data } = payload
    await boss.send(QUEUE_NAME, { data, rawPayload: payload }, { singletonKey: data.id })

    return reply.send({ ok: true })
  })
}
