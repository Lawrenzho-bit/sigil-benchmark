import pino from 'pino';
import { config } from './config';

/** Shared structured logger. Pretty in dev, JSON in production. */
export const logger = pino({
  level: config.logLevel,
  transport: config.isProd
    ? undefined
    : { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } },
});
