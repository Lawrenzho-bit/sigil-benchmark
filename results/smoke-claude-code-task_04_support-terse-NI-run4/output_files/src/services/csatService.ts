import { randomBytes } from 'node:crypto';
import { query, queryOne } from '../db';
import { badRequest, conflict, notFound } from '../errors';
import { config } from '../config';

export interface CsatSurvey {
  id: string;
  ticket_id: number;
  token: string;
  score: number | null;
  comment: string | null;
  sent_at: Date;
  responded_at: Date | null;
}

/**
 * Create a CSAT survey for a resolved ticket and return its public link.
 *
 * Idempotent per ticket: if a survey already exists (e.g. the ticket was
 * resolved, re-opened, resolved again) the existing one is reused so the
 * customer is never surveyed twice for the same ticket.
 */
export async function createSurveyForTicket(
  ticketId: number,
): Promise<{ survey: CsatSurvey; url: string }> {
  const existing = await queryOne<CsatSurvey>(
    'SELECT * FROM csat_surveys WHERE ticket_id = $1',
    [ticketId],
  );
  const survey =
    existing ??
    (await queryOne<CsatSurvey>(
      'INSERT INTO csat_surveys (ticket_id, token) VALUES ($1, $2) RETURNING *',
      [ticketId, randomBytes(24).toString('hex')],
    ))!;
  return { survey, url: `${config.publicBaseUrl}/csat/${survey.token}` };
}

/** Fetch a survey by its single-use token (the customer-facing link). */
export async function getSurveyByToken(token: string): Promise<CsatSurvey> {
  const survey = await queryOne<CsatSurvey>(
    'SELECT * FROM csat_surveys WHERE token = $1',
    [token],
  );
  if (!survey) throw notFound('Survey not found or expired');
  return survey;
}

/** Record the customer's rating. A survey can only be answered once. */
export async function submitSurvey(
  token: string,
  score: number,
  comment: string | null,
): Promise<CsatSurvey> {
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    throw badRequest('Score must be an integer between 1 and 5');
  }
  const survey = await getSurveyByToken(token);
  if (survey.responded_at) throw conflict('This survey has already been completed');

  const updated = await queryOne<CsatSurvey>(
    `UPDATE csat_surveys
        SET score = $2, comment = $3, responded_at = now()
      WHERE token = $1 RETURNING *`,
    [token, score, comment?.slice(0, 2000) ?? null],
  );
  return updated!;
}
