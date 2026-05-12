import PgBoss from 'pg-boss'
import { config } from '../config.js'

export const QUEUE_NAME = 'wassenger.message'

export const boss = new PgBoss({
  connectionString: config.databaseUrl,
  retryLimit: 3,
  retryDelay: 5,
  deleteAfterDays: 7,
})
