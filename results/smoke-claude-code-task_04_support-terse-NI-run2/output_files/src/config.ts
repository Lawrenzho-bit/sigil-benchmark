import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: required('DATABASE_URL'),
  sessionSecret: process.env.SESSION_SECRET ?? 'dev-only-do-not-use',
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.SMTP_FROM ?? 'support@example.com',
  },
  imap: {
    host: process.env.IMAP_HOST ?? '',
    port: Number(process.env.IMAP_PORT ?? 993),
    user: process.env.IMAP_USER ?? '',
    pass: process.env.IMAP_PASS ?? '',
  },
  slack: {
    webhookUrl: process.env.SLACK_WEBHOOK_URL ?? '',
    signingSecret: process.env.SLACK_SIGNING_SECRET ?? '',
  },
  sla: {
    firstResponseMin: Number(process.env.SLA_FIRST_RESPONSE_MIN ?? 60),
    resolutionMin: Number(process.env.SLA_RESOLUTION_MIN ?? 1440),
  },
  retentionDays: Number(process.env.RETENTION_DAYS ?? 1095),
};
