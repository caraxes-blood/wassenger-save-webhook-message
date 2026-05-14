const INSERT_SQL = `
  INSERT INTO messages (message_id, sender, conversation_id, timestamp, payload, is_relevant, skip_reason)
  VALUES ($1, $2, $3, $4, $5, $6, $7)
  ON CONFLICT (message_id) DO NOTHING
`;

export function classifyRelevance(data) {
  if (data.flow !== "inbound")
    return { is_relevant: false, skip_reason: "outbound" };
  if (data.type !== "text" && data.type !== "image")
    return { is_relevant: false, skip_reason: "non_text_or_image" };
  if (data.meta?.isNotification)
    return { is_relevant: false, skip_reason: "notification" };
  if (data.meta?.isBizNotification)
    return { is_relevant: false, skip_reason: "biz_notification" };
  if (!data.body?.trim())
    return { is_relevant: false, skip_reason: "empty_body" };
  return { is_relevant: true, skip_reason: null };
}

export async function processMessage(job, pool) {
  const { data, rawPayload } = job.data;
  const { is_relevant, skip_reason } = classifyRelevance(data);
  try {
    await pool.query(INSERT_SQL, [
      data.id,
      data.fromNumber ?? data.from,
      data.chat?.id ?? null,
      new Date(data.timestamp * 1000),
      JSON.stringify(rawPayload),
      is_relevant,
      skip_reason,
    ]);
  } catch (err) {
    if (err.code === "23505") return;
    throw err;
  }
}

export function registerWorker(boss, pool) {
  return boss.work(
    "wassenger.message",
    { teamSize: 5, teamConcurrency: 5 },
    (jobs) => Promise.all(jobs.map((job) => processMessage(job, pool))),
  );
}
