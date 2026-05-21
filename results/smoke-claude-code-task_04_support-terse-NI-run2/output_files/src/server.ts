import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { authenticate, loginAgent, loginCustomer, registerCustomer, revokeSession } from './auth.js';
import { audit } from './audit.js';
import ticketsRouter   from './routes/tickets.js';
import messagesRouter  from './routes/messages.js';
import customersRouter from './routes/customers.js';
import agentsRouter    from './routes/agents.js';
import kbRouter        from './routes/kb.js';
import macrosRouter    from './routes/macros.js';
import reportsRouter   from './routes/reports.js';
import csatRouter      from './routes/csat.js';
import portalRouter    from './routes/portal.js';
import slackRouter     from './slack/webhook.js';
import emailInboundRouter from './email/inbound.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// Light global rate limit; auth endpoints have a tighter one below.
app.use(rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false }));
const authLimiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });

app.get('/healthz', (_req, res) => res.json({ ok: true }));

// Auth.
app.post('/auth/agent/login', authLimiter, async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) return res.status(400).json({ error: 'email_password_required' });
  const result = await loginAgent(String(email), String(password));
  if (!result) {
    audit({ actor: { kind: 'system' }, action: 'login.agent.fail', meta: { email }, req });
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  audit({ actor: result.agent, action: 'login.agent.success', req });
  res.json({ token: result.token, agent: result.agent });
});

app.post('/auth/customer/login', authLimiter, async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) return res.status(400).json({ error: 'email_password_required' });
  const result = await loginCustomer(String(email), String(password));
  if (!result) return res.status(401).json({ error: 'invalid_credentials' });
  audit({ actor: result.customer, action: 'login.customer.success', req });
  res.json({ token: result.token, customer: result.customer });
});

app.post('/auth/customer/register', authLimiter, async (req, res) => {
  const { email, password, full_name, org_id } = req.body ?? {};
  if (!email || !password) return res.status(400).json({ error: 'email_password_required' });
  const c = await registerCustomer(org_id ?? null, String(email), String(password), full_name);
  audit({ actor: c, action: 'customer.register', req });
  res.status(201).json({ customer: c });
});

app.post('/auth/logout', authenticate({ required: true }), async (req, res) => {
  const auth = req.header('authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  if (token) await revokeSession(token);
  audit({ actor: req.subject!, action: 'logout', req });
  res.json({ ok: true });
});

// Authenticated APIs.
app.use('/api/tickets',   authenticate(), ticketsRouter);
app.use('/api/messages',  authenticate(), messagesRouter);
app.use('/api/customers', authenticate({ kinds: ['agent'] }), customersRouter);
app.use('/api/agents',    authenticate({ kinds: ['agent'] }), agentsRouter);
app.use('/api/kb',        authenticate({ required: false }), kbRouter);
app.use('/api/macros',    authenticate({ kinds: ['agent'] }), macrosRouter);
app.use('/api/reports',   authenticate({ kinds: ['agent'] }), reportsRouter);

// Customer-facing.
app.use('/api/portal',  authenticate({ kinds: ['customer'] }), portalRouter);
// CSAT survey responses are accessed via token, not session.
app.use('/csat', csatRouter);

// Channels (inbound webhooks). Authentication is per-route inside the routers.
app.use('/channels/email/inbound', emailInboundRouter);
app.use('/channels/slack',         slackRouter);

// Static UI.
app.use('/', express.static(path.join(__dirname, '..', 'web')));

// JSON error handler. Production-grade: never leak stack traces.
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[error]', err);
  audit({ actor: req.subject ?? { kind: 'system' }, action: 'http.error',
          meta: { message: (err as Error)?.message ?? String(err) }, req });
  res.status(500).json({ error: 'internal_error' });
});

app.listen(config.port, () => {
  console.log(`support-desk listening on :${config.port}`);
});
