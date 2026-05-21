/**
 * Express session middleware, backed by Postgres so sessions survive restarts
 * and are shared across replicas.
 */
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { config } from '../config';

const PgStore = connectPgSimple(session);

export function sessionMiddleware() {
  return session({
    name: 'admin.sid',
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true, // idle timeout: each request refreshes the expiry
    store: new PgStore({
      conString: config.DATABASE_URL,
      tableName: 'user_sessions',
      createTableIfMissing: true,
    }),
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProd, // requires HTTPS in production
      maxAge: config.SESSION_TTL_MINUTES * 60 * 1000,
    },
  });
}
