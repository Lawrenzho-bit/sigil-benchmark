import { createApp } from './server';
import { config } from './config';
import { logger } from './logger';
import { pool } from './db';
import { startSlaMonitor } from './jobs/slaMonitor';

/**
 * Process entry point: start the HTTP server and the in-process SLA monitor.
 *
 * For horizontal scaling, run the API with the monitor disabled
 * (RUN_SLA_MONITOR=false) and deploy a single dedicated worker replica —
 * see docker-compose.yml.
 */
function main(): void {
  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port, env: config.env }, 'support-tool API listening');
  });

  let stopMonitor: (() => void) | undefined;
  if (process.env.RUN_SLA_MONITOR !== 'false') {
    stopMonitor = startSlaMonitor();
  }

  // Graceful shutdown so in-flight requests finish and the pool drains.
  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    stopMonitor?.();
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
    // Hard exit if cleanup stalls.
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
