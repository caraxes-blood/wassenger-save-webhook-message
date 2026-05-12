export async function runMigrations(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      message_id TEXT UNIQUE NOT NULL,
      sender TEXT NOT NULL,
      conversation_id TEXT,
      timestamp TIMESTAMPTZ NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
    CREATE INDEX IF NOT EXISTS idx_messages_payload_gin ON messages USING GIN(payload);
  `)
}
