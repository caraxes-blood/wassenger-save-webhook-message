import { pool } from '../db/client.js'
import { config } from '../config.js'
import { activeGroups } from '../cache/activeGroups.js'

const BASE_URL = 'https://api.wassenger.com/v1'

async function wassengerGet(path) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Token: config.wassengerApiToken },
  })
  if (!res.ok) throw new Error(`Wassenger GET ${path} → HTTP ${res.status}`)
  return res.json()
}

async function bulkUpsertGroups(groups) {
  if (groups.length === 0) return
  const params = []
  const valueSets = groups.map((g, i) => {
    const b = i * 8
    params.push(
      g.wid,
      g.name ?? null,
      g.device ?? config.wassengerDeviceId,
      g.totalParticipants ?? null,
      g.isArchive ?? false,
      g.createdAt ? new Date(g.createdAt) : null,
      g.lastMessageAt ? new Date(g.lastMessageAt) : null,
      g.id ?? null,
    )
    return `($${b+1},$${b+2},$${b+3},NOW(),$${b+4},$${b+5},$${b+6},$${b+7},$${b+8})`
  })
  await pool.query(
    `INSERT INTO groups (wid,name,device_id,last_synced_at,total_participants,is_archive,created_at,last_message_at,wassenger_id)
     VALUES ${valueSets.join(',')}
     ON CONFLICT (wid) DO UPDATE SET
       name               = EXCLUDED.name,
       device_id          = EXCLUDED.device_id,
       last_synced_at     = NOW(),
       total_participants = EXCLUDED.total_participants,
       is_archive         = EXCLUDED.is_archive,
       created_at         = COALESCE(groups.created_at, EXCLUDED.created_at),
       last_message_at    = EXCLUDED.last_message_at,
       wassenger_id       = EXCLUDED.wassenger_id`,
    params,
  )
}

export async function groupsRoute(fastify) {
  fastify.get('/groups', async (request, reply) => {
    const limit  = Math.min(parseInt(request.query.limit ?? '20', 10), 100)
    const page   = Math.max(parseInt(request.query.page  ?? '1',  10), 1)
    const offset = (page - 1) * limit
    const q      = request.query.q?.trim() ?? ''

    const params = []
    let where = ''
    if (q) {
      params.push(`%${q}%`)
      where = `WHERE name ILIKE $${params.length}`
    }

    params.push(limit, offset)
    const limitIdx  = params.length - 1
    const offsetIdx = params.length

    const [{ rows }, { rows: countRows }] = await Promise.all([
      pool.query(
        `SELECT wid, name, device_id, active, total_participants, is_archive,
                created_at, last_message_at, last_synced_at
         FROM groups ${where}
         ORDER BY name ASC NULLS LAST
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        params,
      ),
      pool.query(
        `SELECT COUNT(*) AS total FROM groups ${where}`,
        params.slice(0, params.length - 2),
      ),
    ])

    const total      = parseInt(countRows[0].total, 10)
    const totalPages = Math.max(1, Math.ceil(total / limit))

    return reply.send({ data: rows, total, page, totalPages, hasNext: page < totalPages, hasPrev: page > 1 })
  })

  fastify.patch('/groups/:wid', async (request, reply) => {
    const { wid } = request.params
    const { active } = request.body ?? {}

    if (typeof active !== 'boolean') {
      return reply.code(400).send({ error: '`active` must be a boolean' })
    }

    const { rows } = await pool.query(
      `UPDATE groups SET active = $1 WHERE wid = $2
       RETURNING wid, name, active, total_participants, is_archive, last_synced_at`,
      [active, wid],
    )

    if (rows.length === 0) return reply.code(404).send({ error: 'Group not found' })

    if (active) activeGroups.add(wid)
    else activeGroups.delete(wid)

    return reply.send({ data: rows[0] })
  })

  fastify.post('/groups/sync', async (request, reply) => {
    if (!config.wassengerApiToken || !config.wassengerDeviceId) {
      return reply.code(503).send({ error: 'WASSENGER_API_TOKEN or WASSENGER_DEVICE_ID not configured' })
    }

    const all = await wassengerGet(`/devices/${config.wassengerDeviceId}/groups`)
    const groups = all.filter(g => g.kind === 'group')

    let ok = 0, failed = 0
    const errors = []

    await bulkUpsertGroups(groups)

    return reply.send({ synced: groups.length, failed: 0, errors: [] })
  })
}
