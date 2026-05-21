/**
 * Customer satisfaction (CSAT) surveys. A survey is created once per ticket when
 * the ticket is first resolved; the customer responds via an unauthenticated
 * tokenised link emailed to them.
 */
import { query, queryOne } from '../../db/pool';
import { badRequest, notFound } from '../../http/errors';
import { config } from '../../config';
import { logger } from '../../logger';
import { sendReply } from '../../email/sender';

export interface CsatSurvey {
  id: number;
  ticket_id: number;
  customer_id: number;
  token: string;
  score: number | null;
  comment: string | null;
  sent_at: string;
  responded_at: string | null;
}

/**
 * Create + email CSAT surveys for tickets resolved since the last sweep that do
 * not yet have one. Returns the number of surveys sent. Idempotent: the unique
 * constraint on csat_surveys.ticket_id prevents duplicates.
 */
export async function dispatchPendingSurveys(): Promise<number> {
  const candidates = await query<{
    ticket_id: number;
    number: number;
    subject: string;
    customer_id: number;
    email: string;
  }>(
    `SELECT t.id AS ticket_id, t.number, t.subject, t.requester_id AS customer_id, c.email
       FROM tickets t
       JOIN customers c ON c.id = t.requester_id
      WHERE t.status IN ('resolved', 'closed')
        AND t.resolved_at IS NOT NULL
        AND c.is_anonymised = false
        AND NOT EXISTS (SELECT 1 FROM csat_surveys s WHERE s.ticket_id = t.id)`,
  );

  let sent = 0;
  for (const c of candidates) {
    const survey = await queryOne<CsatSurvey>(
      `INSERT INTO csat_surveys (ticket_id, customer_id) VALUES ($1, $2)
       ON CONFLICT (ticket_id) DO NOTHING
       RETURNING id, ticket_id, customer_id, token, score, comment, sent_at, responded_at`,
      [c.ticket_id, c.customer_id],
    );
    if (!survey) continue; // raced with another worker

    const link = `https://${config.EMAIL_DOMAIN}/public/csat/${survey.token}`;
    try {
      await sendReply({
        ticketNumber: c.number,
        to: c.email,
        subject: `How did we do? — ${c.subject}`,
        bodyText:
          `Your support ticket #${c.number} has been resolved.\n\n` +
          `We'd love your feedback. Rate your experience (1-5):\n${link}\n\n` +
          `Thank you.`,
      });
      sent++;
    } catch (err) {
      logger.error({ err, ticketId: c.ticket_id }, 'failed to send CSAT survey email');
    }
  }
  return sent;
}

/** Look up a survey by its public token (for the unauthenticated response page). */
export async function getSurveyByToken(token: string): Promise<CsatSurvey> {
  const row = await queryOne<CsatSurvey>(
    `SELECT id, ticket_id, customer_id, token, score, comment, sent_at, responded_at
       FROM csat_surveys WHERE token = $1`,
    [token],
  );
  if (!row) throw notFound('Survey not found');
  return row;
}

/** Record a customer's CSAT response. Surveys may be answered only once. */
export async function submitResponse(
  token: string,
  score: number,
  comment: string | null,
): Promise<CsatSurvey> {
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    throw badRequest('Score must be an integer between 1 and 5');
  }
  const survey = await getSurveyByToken(token);
  if (survey.responded_at) throw badRequest('This survey has already been completed');

  const row = await queryOne<CsatSurvey>(
    `UPDATE csat_surveys SET score = $2, comment = $3, responded_at = now()
      WHERE token = $1
      RETURNING id, ticket_id, customer_id, token, score, comment, sent_at, responded_at`,
    [token, score, comment],
  );
  return row!;
}

export interface CsatStats {
  surveys_sent: number;
  responses: number;
  response_rate: number;
  average_score: number | null;
}

/** Aggregate CSAT stats over an optional date window (by survey sent_at). */
export async function csatStats(from?: string, to?: string): Promise<CsatStats> {
  const args: unknown[] = [];
  const where: string[] = [];
  if (from) {
    args.push(from);
    where.push(`sent_at >= $${args.length}`);
  }
  if (to) {
    args.push(to);
    where.push(`sent_at <= $${args.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const row = await queryOne<{
    sent: string;
    responses: string;
    avg: string | null;
  }>(
    `SELECT count(*)::text AS sent,
            count(score)::text AS responses,
            avg(score)::numeric(3,2)::text AS avg
       FROM csat_surveys ${whereSql}`,
    args,
  );
  const sent = Number(row?.sent ?? 0);
  const responses = Number(row?.responses ?? 0);
  return {
    surveys_sent: sent,
    responses,
    response_rate: sent > 0 ? Number((responses / sent).toFixed(3)) : 0,
    average_score: row?.avg ? Number(row.avg) : null,
  };
}
