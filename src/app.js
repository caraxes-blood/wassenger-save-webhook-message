import { config } from './config.js'
import { pool } from './db/client.js'
import { runMigrations } from './db/migrate.js'
import { boss, QUEUE_NAME } from './queue/boss.js'
import { registerWorker } from './queue/worker.js'
import { buildServer } from './server.js'
import { initActiveGroupsCache } from './cache/activeGroups.js'

async function main() {
  await runMigrations(pool)
  await initActiveGroupsCache()
  await boss.start()
  await boss.createQueue(QUEUE_NAME)
  registerWorker(boss, pool)

  const server = buildServer()
  await server.listen({ port: config.port, host: '0.0.0.0' })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
