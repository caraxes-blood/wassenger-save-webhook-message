export async function runMigrations(pool) {
  // messages: create (new DB) + alter columns (existing DB) + all indexes
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      message_id      TEXT        UNIQUE NOT NULL,
      sender          TEXT        NOT NULL,
      conversation_id TEXT,
      timestamp       TIMESTAMPTZ NOT NULL,
      payload         JSONB       NOT NULL,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      is_relevant     BOOLEAN     NOT NULL DEFAULT true,
      skip_reason     TEXT,
      processed_at    TIMESTAMPTZ
    );

    ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS is_relevant  BOOLEAN NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS skip_reason  TEXT,
      ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

    CREATE INDEX IF NOT EXISTS idx_messages_sender          ON messages(sender);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp       ON messages(timestamp);
    CREATE INDEX IF NOT EXISTS idx_messages_payload_gin     ON messages USING GIN(payload);
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
