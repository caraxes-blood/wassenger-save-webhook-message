import { config } from '../config.js'

export async function authRoute(fastify) {
  fastify.post('/auth/login', async (request, reply) => {
    const { username, password } = request.body ?? {}
    if (username !== config.adminUsername || password !== config.adminPassword) {
      return reply.code(401).send({ error: 'Invalid credentials' })
    }
    const token = await reply.jwtSign({ role: 'admin' }, { expiresIn: '24h' })
    return reply
      .setCookie('token', token, {
        httpOnly: true,
        secure: true,
        sameSite: 'None',
        path: '/',
        maxAge: 86400,
      })
      .send({ ok: true })
  })

  fastify.post('/auth/logout', async (request, reply) => {
    return reply
      .clearCookie('token', { path: '/', secure: true, sameSite: 'None' })
      .send({ ok: true })
  })
}
