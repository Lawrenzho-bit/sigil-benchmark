// Process entrypoint: boot the HTTP server and wire graceful shutdown.
import { buildApp } from './app.js';
import { config } from './config.js';
import { disconnectDb } from './db.js';

const app = await buildApp();

try {
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// Drain in-flight requests, then close DB connections, on SIGTERM/SIGINT.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, async () => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    await disconnectDb();
    process.exit(0);
  });
}
