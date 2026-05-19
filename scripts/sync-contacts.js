/**
 * Sync WhatsApp contacts from Wassenger API into the users table.
 *
 * Run: node scripts/sync-contacts.js
 * Requires DATABASE_URL, WASSENGER_API_TOKEN, WASSENGER_DEVICE_ID in .env
 */

import 'dotenv/config'
import pg from 'pg'

const TOKEN    = process.env.WASSENGER_API_TOKEN
const DEVICE   = process.env.WASSENGER_DEVICE_ID
const BASE_URL = 'https://api.wassenger.com/v1'
const PAGE_SIZE = 500

if (!TOKEN || !DEVICE) {
  console.error('Missing WASSENGER_API_TOKEN or WASSENGER_DEVICE_ID')
  process.exit(1)
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

const FETCH_TIMEOUT_MS = 30_000

async function wassengerGet(path) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { Token: TOKEN },
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`Wassenger GET ${path} → HTTP ${res.status}`)
    return res.json()
  } finally {
    clearTimeout(timer)
  }
}

async function fetchAllContacts() {
  const contacts = []
  let page = 1

  while (true) {
    process.stdout.write(`\r  page ${page} (${contacts.length} so far)...`)
    const batch = await wassengerGet(
      `/chat/${DEVICE}/contacts?page=${page}&size=${PAGE_SIZE}`,
    )
    if (!Array.isArray(batch) || batch.length === 0) break
    contacts.push(...batch)
    if (batch.length < PAGE_SIZE) break
    page++
  }

  process.stdout.write('\n')
  return contacts
}

async function main() {
  console.log('Fetching contacts...')
  const all = await fetchAllContacts()
  const seen = new Map()
  for (const c of all) {
    if (c.type === 'user' && c.phone && !seen.has(c.phone)) seen.set(c.phone, c)
  }
  const users = [...seen.values()]
  console.log(`Found ${all.length} contact(s), ${users.length} unique phones\n`)

  const client = await pool.connect()
  let ok = 0, skipped = 0

  const CHUNK = 500

  try {
    await client.query('BEGIN')

    for (let i = 0; i < users.length; i += CHUNK) {
      const chunk = users.slice(i, i + CHUNK)
      const values = []
      const params = []

      chunk.forEach((contact, idx) => {
        const base = idx * 3
        values.push(`($${base + 1}, $${base + 2}, $${base + 3})`)
        params.push(
          contact.phone,
          contact.displayName ?? contact.name ?? null,
          contact.wid ?? null,
        )
      })

      await client.query(
        `INSERT INTO users (phone, name, wid)
         VALUES ${values.join(', ')}
         ON CONFLICT (phone) DO UPDATE SET
           name       = COALESCE(EXCLUDED.name, users.name),
           wid        = COALESCE(EXCLUDED.wid,  users.wid),
           updated_at = NOW()`,
        params,
      )
      ok += chunk.length
    }

    await client.query('COMMIT')
    console.log(`Done — ${ok} upserted, ${skipped} skipped (no phone)`)
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
