/**
 * Sync WhatsApp group chats and their members from Wassenger API into the DB.
 *
 * Run: node scripts/sync-groups.js
 * Requires DATABASE_URL, WASSENGER_API_TOKEN, WASSENGER_DEVICE_ID in .env
 */

import 'dotenv/config'
import pg from 'pg'

const TOKEN    = process.env.WASSENGER_API_TOKEN
const DEVICE   = process.env.WASSENGER_DEVICE_ID
const BASE_URL = 'https://api.wassenger.com/v1'

if (!TOKEN || !DEVICE) {
  console.error('Missing WASSENGER_API_TOKEN or WASSENGER_DEVICE_ID')
  process.exit(1)
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

async function wassengerGet(path) {
  const res = await fetch(`${BASE_URL}${path}`, { headers: { Token: TOKEN } })
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
      DEVICE,
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

async function main() {
  console.log('Fetching group list...')
  const groups = await wassengerGet(`/devices/${DEVICE}/groups`)
  const onlyGroups = groups.filter(g => g.kind === 'group')
  console.log(`Found ${onlyGroups.length} group(s)`)

  await bulkUpsertGroups(onlyGroups)

  await pool.end()
  console.log(`Done — ${onlyGroups.length} groups upserted`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
