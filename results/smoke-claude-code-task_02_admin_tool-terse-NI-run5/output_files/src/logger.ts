import pino from 'pino';
import { config } from './config';

export const logger = pino({
  level: config.LOG_LEVEL,
  base: { app: 'internal-admin-tool' },
  // Pretty output in dev; structured JSON in prod for log shipping.
  transport: config.isProd
    ? undefined
    : { target: 'pino/file', options: { destination: 1 } },
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.tokenHash', '*.password'],
    censor: '[redacted]',
  },
});
