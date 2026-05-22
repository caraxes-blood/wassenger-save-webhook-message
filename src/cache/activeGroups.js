import { pool } from '../db/client.js'

export const activeGroups = new Set()

async function refresh() {
  const { rows } = await pool.query('SELECT wid FROM groups WHERE active = true')
  activeGroups.clear()
  for (const { wid } of rows) activeGroups.add(wid)
}

export async function initActiveGroupsCache() {
  await refresh()
  setInterval(refresh, 30_000)
}
