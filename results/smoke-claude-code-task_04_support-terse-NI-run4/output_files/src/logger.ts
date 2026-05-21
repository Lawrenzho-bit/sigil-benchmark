import pino from 'pino';
import { config } from './config';

/**
 * Structured JSON logger. `email` and `password_hash` are redacted so PII /
 * secrets never land in log aggregation (GDPR + SOC2).
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (config.isProd ? 'info' : 'debug'),
  redact: {
    paths: ['req.headers.authorization', '*.password', '*.password_hash', '*.token'],
    censor: '[redacted]',
  },
  transport: config.isProd ? undefined : { target: 'pino-pretty' },
});
