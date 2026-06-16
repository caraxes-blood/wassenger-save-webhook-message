export async function runMigrations(pool) {
  // messages: create (new DB) + alter columns (existing DB) + all indexes
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      message_id      TEXT        UNIQUE NOT NULL,
      sender          TEXT        NOT NULL,
      conversation_id TEXT,
      timestamp       TIMESTAMPTZ NOT NULL,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      is_relevant     BOOLEAN     NOT NULL DEFAULT true,
      skip_reason     TEXT,
      processed_at    TIMESTAMPTZ,
      type            TEXT,
      group_name      TEXT,
      message_body    TEXT,
      caption         TEXT,
      image_url       TEXT
    );

    ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS is_relevant   BOOLEAN NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS skip_reason   TEXT,
      ADD COLUMN IF NOT EXISTS processed_at  TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS type          TEXT,
      ADD COLUMN IF NOT EXISTS group_name    TEXT,
      ADD COLUMN IF NOT EXISTS message_body  TEXT,
      ADD COLUMN IF NOT EXISTS caption       TEXT,
      ADD COLUMN IF NOT EXISTS image_url     TEXT;

    -- make payload nullable so the worker can INSERT without it while the
    -- backfill script (scripts/backfill-trim.js) is still pending
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'messages' AND column_name = 'payload'
      ) THEN
        ALTER TABLE messages ALTER COLUMN payload DROP NOT NULL;
      END IF;
    END $$;

    CREATE INDEX IF NOT EXISTS idx_messages_sender          ON messages(sender);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp       ON messages(timestamp);
    CREATE INDEX IF NOT EXISTS idx_messages_work_queue
      ON messages (is_relevant, processed_at)
      WHERE is_relevant = true AND processed_at IS NULL;
  `)

  // cleaned_messages: output of Python cleaning worker
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cleaned_messages (
      id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      message_id       TEXT        NOT NULL REFERENCES messages(message_id),
      sender           TEXT        NOT NULL,
      conversation_id  TEXT,
      timestamp        TIMESTAMPTZ NOT NULL,
      raw_body         TEXT        NOT NULL,
      clean_body       TEXT        NOT NULL,
      intent           TEXT        NOT NULL,
      confidence       FLOAT       NOT NULL,
      intent_signal    TEXT,
      price_usd        FLOAT,
      watch_ref        TEXT,
      condition        TEXT,
      language         TEXT,
      is_system        BOOLEAN     NOT NULL DEFAULT false,
      processed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_cleaned_messages_message_id ON cleaned_messages(message_id);
    CREATE INDEX IF NOT EXISTS idx_cleaned_messages_intent     ON cleaned_messages(intent);
    CREATE INDEX IF NOT EXISTS idx_cleaned_messages_timestamp  ON cleaned_messages(timestamp);

    CREATE UNIQUE INDEX IF NOT EXISTS uniq_cleaned_messages_message_id
      ON cleaned_messages (message_id);
  `)

  // groups: WhatsApp group chats synced from Wassenger API
  await pool.query(`
    CREATE TABLE IF NOT EXISTS groups (
      wid            TEXT        PRIMARY KEY,
      name           TEXT,
      device_id      TEXT,
      last_synced_at TIMESTAMPTZ
    );

    ALTER TABLE groups
      ADD COLUMN IF NOT EXISTS active              BOOLEAN     NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS total_participants  INT,
      ADD COLUMN IF NOT EXISTS is_archive          BOOLEAN     NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS created_at          TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS last_message_at     TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS wassenger_id        TEXT;

    CREATE TABLE IF NOT EXISTS users (
      phone      TEXT        PRIMARY KEY,
      name       TEXT,
      wid        TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS group_members (
      group_wid  TEXT    NOT NULL REFERENCES groups(wid),
      user_phone TEXT    NOT NULL REFERENCES users(phone),
      is_admin   BOOLEAN NOT NULL DEFAULT false,
      PRIMARY KEY (group_wid, user_phone)
    );
  `)

  // deals: rule-based now (source='rules'), AI pipeline later (source='ai')
  await pool.query(`
    CREATE TABLE IF NOT EXISTS deals (
      id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      message_id          TEXT        NOT NULL REFERENCES messages(message_id),
      cleaned_message_id  UUID        NOT NULL REFERENCES cleaned_messages(id),
      sender              TEXT        NOT NULL,
      conversation_id     TEXT,
      timestamp           TIMESTAMPTZ NOT NULL,
      intent              TEXT        NOT NULL,
      confidence          FLOAT,
      intent_signal       TEXT,
      price_usd           FLOAT,
      watch_ref           TEXT,
      condition           TEXT,
      language            TEXT,
      clean_body          TEXT        NOT NULL,
      source              TEXT        NOT NULL DEFAULT 'rules',
      ai_notes            TEXT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_deals_timestamp ON deals(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_deals_intent    ON deals(intent);
    CREATE INDEX IF NOT EXISTS idx_deals_source    ON deals(source);
    CREATE INDEX IF NOT EXISTS idx_deals_sender    ON deals(sender);

    CREATE UNIQUE INDEX IF NOT EXISTS uniq_deals_message_id_source
      ON deals (message_id, source);
  `)
}
