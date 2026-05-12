import 'dotenv/config'

const required = (key) => {
  const val = process.env[key]
  if (!val) throw new Error(`Missing required env var: ${key}`)
  return val
}

export const config = {
  port: parseInt(process.env.PORT ?? '3000', 10),
  databaseUrl: required('DATABASE_URL'),
  webhookSecret: required('WASSENGER_WEBHOOK_SECRET'),
  adminToken: required('ADMIN_TOKEN'),
  nodeEnv: process.env.NODE_ENV ?? 'development',
}
