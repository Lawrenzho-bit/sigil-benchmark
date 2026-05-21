import pino from 'pino';
import { config, isProd } from './config';

/** Process-wide structured logger. Pretty in dev, JSON in prod. */
export const logger = pino({
  level: config.LOG_LEVEL,
  transport: isProd ? undefined : { target: 'pino-pretty', options: { colorize: true } },
  // Never log secrets or full email bodies.
  redact: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.password_hash'],
});
