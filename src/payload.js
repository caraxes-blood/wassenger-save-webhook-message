export function extractColumns(data) {
  return {
    type:         data.type ?? null,
    group_name:   data.chat?.type === 'group' ? (data.chat?.name ?? null) : null,
    message_body: data.type === 'text'  ? (data.body ?? null) : null,
    caption:      data.type === 'image' ? (data.media?.caption ?? null) : null,
    image_url:    data.type === 'image' ? (data.media?.links?.download ?? null) : null,
  }
}
