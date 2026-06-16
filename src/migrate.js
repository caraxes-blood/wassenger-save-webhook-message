import { pool } from './db/client.js'
import { runMigrations } from './db/migrate.js'

await runMigrations(pool)
console.log('Migrations complete.')
await pool.end()
