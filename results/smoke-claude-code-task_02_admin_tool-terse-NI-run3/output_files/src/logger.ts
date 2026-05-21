/** Application logger (pino). */
import pino from 'pino';
import { config } from './config';

export const logger = pino({
  level: config.NODE_ENV === 'test' ? 'silent' : config.isProd ? 'info' : 'debug',
  // Redact anything that could leak credentials in structured logs.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.tokenHash',
      '*.password',
      '*.SESSION_SECRET',
    ],
    censor: '[redacted]',
  },
  transport: config.isProd
    ? undefined
    : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
});
