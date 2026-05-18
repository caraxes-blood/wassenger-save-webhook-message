import { pool } from '../db/client.js'

export async function usersRoute(fastify) {
  fastify.get('/users', async (request, reply) => {
    const limit  = Math.min(parseInt(request.query.limit ?? '20', 10), 100)
    const page   = Math.max(parseInt(request.query.page  ?? '1',  10), 1)
    const offset = (page - 1) * limit
    const q         = request.query.q?.trim()       ?? ''
    const groupWid  = request.query.group_wid?.trim() ?? ''

    const params  = []
    const conditions = []

    let fromClause = 'FROM users u'
    if (groupWid) {
      params.push(groupWid)
      fromClause += ` JOIN group_members gm ON u.phone = gm.user_phone AND gm.group_wid = $${params.length}`
    }

    if (q) {
      params.push(`%${q}%`)
      const idx = params.length
      conditions.push(`(u.phone ILIKE $${idx} OR u.name ILIKE $${idx})`)
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    params.push(limit, offset)
    const limitIdx  = params.length - 1
    const offsetIdx = params.length

    const [{ rows }, { rows: countRows }] = await Promise.all([
      pool.query(
        `SELECT u.phone, u.name, u.wid, u.created_at, u.updated_at
         ${fromClause} ${where}
         ORDER BY u.name ASC NULLS LAST, u.phone ASC
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        params,
      ),
      pool.query(
        `SELECT COUNT(*) AS total ${fromClause} ${where}`,
        params.slice(0, params.length - 2),
      ),
    ])

    const total      = parseInt(countRows[0].total, 10)
    const totalPages = Math.max(1, Math.ceil(total / limit))

    return reply.send({ data: rows, total, page, totalPages, hasNext: page < totalPages, hasPrev: page > 1 })
  })

  fastify.get('/groups', async (_request, reply) => {
    const { rows } = await pool.query(
      `SELECT wid, name FROM groups ORDER BY name ASC NULLS LAST`,
    )
    return reply.send({ data: rows })
  })
}
