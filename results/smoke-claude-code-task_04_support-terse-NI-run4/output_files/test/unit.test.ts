import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addBusinessMinutes } from '../src/services/slaService';
import { extractTicketRef, fromWebhookPayload, subjectTag } from '../src/email/parser';

/**
 * Pure-function unit tests — no database required.
 * Run with: npm test
 */

test('addBusinessMinutes stays within the same business day', () => {
  // Monday 10:00 + 60min → Monday 11:00
  const monday10 = new Date('2026-05-18T10:00:00');
  const due = addBusinessMinutes(monday10, 60);
  assert.equal(due.getHours(), 11);
  assert.equal(due.getDate(), 18);
});

test('addBusinessMinutes rolls past the end of the work day', () => {
  // Monday 16:30 + 60min → Tuesday 09:30 (30min today + 30min next day)
  const monday1630 = new Date('2026-05-18T16:30:00');
  const due = addBusinessMinutes(monday1630, 60);
  assert.equal(due.getDate(), 19);
  assert.equal(due.getHours(), 9);
  assert.equal(due.getMinutes(), 30);
});

test('addBusinessMinutes skips the weekend', () => {
  // Friday 16:00 + 120min → Monday 10:00 (1h Fri + 1h Mon)
  const friday16 = new Date('2026-05-22T16:00:00');
  const due = addBusinessMinutes(friday16, 120);
  assert.equal(due.getDay(), 1); // Monday
  assert.equal(due.getHours(), 10);
});

test('extractTicketRef reads a plus-addressed recipient', () => {
  assert.equal(extractTicketRef(['support+4271@example.com'], 'Re: anything'), 4271);
});

test('extractTicketRef falls back to the subject tag', () => {
  assert.equal(extractTicketRef(['support@example.com'], 'Re: help [#88]'), 88);
});

test('extractTicketRef returns null for a fresh email', () => {
  assert.equal(extractTicketRef(['support@example.com'], 'New problem'), null);
});

test('subjectTag formats the ticket reference', () => {
  assert.equal(subjectTag(123), '[#123]');
});

test('inbound parser strips quoted reply history', () => {
  const parsed = fromWebhookPayload({
    from: 'jane@example.com',
    subject: 'Re: order [#5]',
    text: 'Thanks, that worked!\n\nOn Mon, Support wrote:\n> Have you tried restarting?',
  });
  assert.equal(parsed.cleanText, 'Thanks, that worked!');
  assert.equal(parsed.ticketRef, 5);
});

test('inbound parser strips a trailing signature', () => {
  const parsed = fromWebhookPayload({
    from: 'jane@example.com',
    subject: 'Help',
    text: 'My password does not work.\n\n--\nJane Doe\nAcme Corp',
  });
  assert.equal(parsed.cleanText, 'My password does not work.');
});
