/**
 * Inbound email parsing: MIME decode, reply-quote removal, signature stripping,
 * and ticket-reference extraction for threading.
 */
import { simpleParser } from 'mailparser';
import { config } from '../config';

export interface ParsedEmail {
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  from: string;
  fromName: string | null;
  to: string[];
  subject: string;
  /** Body with quoted replies and signature removed — what becomes the message. */
  cleanText: string;
  /** Full decoded text, retained on the raw email_messages row. */
  rawText: string;
  html: string | null;
  attachments: ParsedAttachment[];
}

export interface ParsedAttachment {
  filename: string;
  contentType: string;
  size: number;
  content: Buffer;
}

/** Decode a raw RFC 5322 message into a normalised ParsedEmail. */
export async function parseRawMime(raw: string | Buffer): Promise<ParsedEmail> {
  const mail = await simpleParser(raw);

  const fromAddr = mail.from?.value?.[0];
  const toList = (mail.to ? (Array.isArray(mail.to) ? mail.to : [mail.to]) : []).flatMap((a) =>
    a.value.map((v) => v.address ?? ''),
  );

  const references = normaliseReferences(mail.references);
  const rawText = mail.text ?? '';

  return {
    messageId: mail.messageId ?? null,
    inReplyTo: mail.inReplyTo ?? null,
    references,
    from: (fromAddr?.address ?? '').toLowerCase(),
    fromName: fromAddr?.name || null,
    to: toList.filter(Boolean).map((a) => a.toLowerCase()),
    subject: mail.subject ?? '(no subject)',
    cleanText: stripSignature(stripQuotedReply(rawText)),
    rawText,
    html: mail.html || null,
    attachments: mail.attachments.map((a) => ({
      filename: a.filename ?? 'attachment',
      contentType: a.contentType ?? 'application/octet-stream',
      size: a.size ?? a.content.length,
      content: a.content,
    })),
  };
}

function normaliseReferences(refs: string | string[] | undefined): string[] {
  if (!refs) return [];
  return (Array.isArray(refs) ? refs : refs.split(/\s+/)).filter(Boolean);
}

/**
 * Drop quoted reply history. Cuts at the first recognised quote delimiter:
 * "On <date>, <person> wrote:", Outlook/Gmail separators, or a run of `>` lines.
 */
export function stripQuotedReply(text: string): string {
  const lines = text.split(/\r?\n/);
  const cutPatterns: RegExp[] = [
    /^On\s.+\swrote:\s*$/i,
    /^-{2,}\s*Original Message\s*-{2,}/i,
    /^_{5,}\s*$/,
    /^From:\s.+/i, // forwarded-header block
    /^\s*>{1,}/, // a quoted line
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (cutPatterns.some((p) => p.test(line))) {
      return lines.slice(0, i).join('\n').trimEnd();
    }
  }
  return text.trimEnd();
}

/**
 * Remove a trailing signature block. Cuts at a standard `-- ` delimiter, or
 * trims a short trailing block that looks like contact details.
 */
export function stripSignature(text: string): string {
  const lines = text.split(/\r?\n/);

  const delimIdx = lines.findIndex((l) => l.trimEnd() === '--' || l.trimEnd() === '-- ');
  if (delimIdx >= 0) return lines.slice(0, delimIdx).join('\n').trimEnd();

  // Heuristic: a "Sent from my iPhone" style trailer.
  const trailer = /^(Sent from|Get Outlook|Regards|Best regards|Cheers|Thanks),?/i;
  for (let i = Math.max(0, lines.length - 6); i < lines.length; i++) {
    if (trailer.test((lines[i] ?? '').trim())) {
      return lines.slice(0, i).join('\n').trimEnd();
    }
  }
  return text.trimEnd();
}

/**
 * Extract the ticket number a reply belongs to. Checks, in order:
 *  1. a plus-addressed recipient: support+1042@domain
 *  2. a subject tag: [#1042] or "Ticket #1042"
 * Returns null for a fresh inbound email (no existing ticket).
 */
export function extractTicketNumber(subject: string, toAddrs: string[]): number | null {
  const localpart = config.INBOUND_ADDRESS_LOCALPART;
  const plusRe = new RegExp(`${escapeRe(localpart)}\\+(\\d+)@`, 'i');
  for (const addr of toAddrs) {
    const m = addr.match(plusRe);
    if (m?.[1]) return Number(m[1]);
  }

  const subjectMatch = subject.match(/\[#(\d+)\]/) ?? subject.match(/ticket\s*#\s*(\d+)/i);
  if (subjectMatch?.[1]) return Number(subjectMatch[1]);

  return null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
