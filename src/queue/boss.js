import PgBoss from "pg-boss";
import { config } from "../config.js";

export const QUEUE_NAME = "wassenger.message";

export const boss = new PgBoss({
  connectionString: config.databaseUrl,
  retryLimit: 3,
  retryDelay: 5,

  // Move completed jobs to archive after 1 hour
  archiveCompletedAfterSeconds: 60 * 60,

  // Move failed jobs to archive after 1 hour
  archiveFailedAfterSeconds: 60 * 60,

  // Delete from archive after 1 hour (3600 seconds)
  deleteArchivedAfterSeconds: 60 * 60,

  // Run cleanup every 5 minutes
  maintenanceIntervalSeconds: 300,

  ssl: {
    rejectUnauthorized: false,
  },
});
