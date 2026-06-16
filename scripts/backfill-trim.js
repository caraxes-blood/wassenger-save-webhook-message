/**
 * Backfill script — populates type/group_name/message_body/caption/image_url
 * for all messages that still have a payload column value, then drops the
 * payload column entirely once every row has been processed.
 *
 * Run:     node scripts/backfill-trim.js
 * Dry run: node scripts/backfill-trim.js --dry-run --limit 50
 * Slice:   node scripts/backfill-trim.js --limit 500
 *
 * Requires DATABASE_URL in .env (same as the main server).
 * Run this BEFORE restarting the server after deploying the payload-drop migration.
 */

import "dotenv/config";
import pg from "pg";
import { extractColumns } from "../src/payload.js";

const BATCH_SIZE = 500;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitIdx = args.indexOf("--limit");
const maxRows = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : Infinity;

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const FETCH_SQL = `
  SELECT message_id, payload
  FROM messages
  WHERE payload IS NOT NULL
  ORDER BY id
  LIMIT $1
`;

const COUNT_SQL = `
  SELECT COUNT(*) AS total FROM messages WHERE payload IS NOT NULL
`;

function buildBatchUpdate(valid) {
  const params = [];
  const placeholders = valid.map(({ message_id, cols }, i) => {
    const b = i * 6;
    params.push(cols.type, cols.group_name, cols.message_body, cols.caption, cols.image_url, message_id);
    return `($${b+1}::text,$${b+2}::text,$${b+3}::text,$${b+4}::text,$${b+5}::text,$${b+6}::text)`;
  }).join(',');
  return {
    sql: `UPDATE messages AS m
          SET payload = NULL, type = v.type, group_name = v.group_name,
              message_body = v.message_body, caption = v.caption, image_url = v.image_url
          FROM (VALUES ${placeholders}) AS v(type,group_name,message_body,caption,image_url,message_id)
          WHERE m.message_id = v.message_id`,
    params,
  };
}

async function main() {
  // Check if payload column exists at all
  const { rows: colCheck } = await pool.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'messages' AND column_name = 'payload'
  `);
  if (colCheck.length === 0) {
    console.log("payload column does not exist — nothing to do.");
    await pool.end();
    return;
  }

  const {
    rows: [{ total }],
  } = await pool.query(COUNT_SQL);
  console.log(
    `Rows with payload: ${total}${maxRows !== Infinity ? ` (capped at ${maxRows})` : ""}`,
  );

  if (parseInt(total, 10) === 0) {
    console.log("Nothing to backfill.");
    if (!dryRun) await dropPayloadColumn();
    await pool.end();
    return;
  }

  if (dryRun) console.log("DRY RUN — no writes will be committed.");

  let processed = 0;
  let errors = 0;
  const batchLimit = maxRows === Infinity ? BATCH_SIZE : Math.min(BATCH_SIZE, maxRows);

  while (processed < (maxRows === Infinity ? Infinity : maxRows)) {
    const fetchLimit = maxRows === Infinity ? batchLimit : Math.min(batchLimit, maxRows - processed);
    const { rows } = await pool.query(FETCH_SQL, [fetchLimit]);
    if (rows.length === 0) break;

    // Extract columns in JS; collect valid rows and skip bad ones without a DB round-trip
    const valid = [];
    for (const row of rows) {
      // payload may be the raw Wassenger envelope {event, data} or already-trimmed {data}
      const data = row.payload?.data;
      if (!data) {
        console.error(`  Skipping ${row.message_id}: payload.data missing`);
        errors++;
        continue;
      }
      try {
        valid.push({ message_id: row.message_id, cols: extractColumns(data) });
      } catch (err) {
        console.error(`  Error extracting ${row.message_id}: ${err.message}`);
        errors++;
      }
    }

    if (dryRun) {
      for (const { message_id, cols } of valid) {
        console.log(
          `  [DRY] ${message_id}: type=${cols.type} group=${cols.group_name} body=${cols.message_body?.slice(0, 40) ?? null} caption=${cols.caption} image_url=${cols.image_url}`,
        );
      }
      processed += valid.length;
      break;
    }

    if (valid.length > 0) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { sql, params } = buildBatchUpdate(valid);
        await client.query(sql, params);
        await client.query("COMMIT");
        processed += valid.length;
      } catch (err) {
        try { await client.query("ROLLBACK"); } catch {}
        console.error(`Batch error: ${err.message}`);
        errors += valid.length;
      } finally {
        client.release();
      }
    }

    const pct =
      maxRows !== Infinity
        ? Math.min(100, (processed / maxRows) * 100).toFixed(1)
        : processed.toString();
    process.stdout.write(
      `\r  ${processed} processed${maxRows !== Infinity ? ` / ${maxRows} (${pct}%)` : ""}  `,
    );
  }

  console.log("\n\nDone.");
  console.log(`  Rows processed : ${processed}`);
  console.log(`  Errors skipped : ${errors}`);

  if (!dryRun) {
    // Only drop if all remaining rows with payload have been processed
    const {
      rows: [{ remaining }],
    } = await pool.query(
      "SELECT COUNT(*) AS remaining FROM messages WHERE payload IS NOT NULL",
    );
    if (parseInt(remaining, 10) === 0) {
      await dropPayloadColumn();
    } else {
      console.log(
        `\n  ${remaining} rows still have payload — re-run without --limit to drop the column.`,
      );
    }
  }

  await pool.end();
}

async function dropPayloadColumn() {
  console.log("\nDropping payload column and GIN index...");
  await pool.query(`
    DROP INDEX IF EXISTS idx_messages_payload_gin;
    ALTER TABLE messages DROP COLUMN IF EXISTS payload;
  `);
  console.log("  payload column dropped.");
  console.log("  Running VACUUM FULL messages (this may take a while)...");
  await pool.query("VACUUM FULL messages");
  console.log("  VACUUM FULL done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
