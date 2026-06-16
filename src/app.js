import { config } from './config.js'
import { pool } from './db/client.js'
import { boss, QUEUE_NAME } from './queue/boss.js'
import { registerWorker } from './queue/worker.js'
import { buildServer } from './server.js'
import { initActiveGroupsCache } from './cache/activeGroups.js'

async function main() {
  // 1. Start the HTTP server immediately
  const server = buildServer()
  await server.listen({ port: config.port, host: '0.0.0.0' })
  console.log('Server listening')  // Heroku sees this, stops the boot timer

  // 2. Everything else can initialize after server is up
  await boss.start()
  await boss.createQueue(QUEUE_NAME)
  registerWorker(boss, pool)
  await initActiveGroupsCache()   // warm the cache after server is live
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
