import { simpleParser, ParsedMail } from 'mailparser';
import { config } from '../config';

export interface ParsedInbound {
  fromEmail: string;
  fromName: string | null;
  subject: string;
  /** Body with quoted history + signature removed — what the customer typed. */
  cleanText: string;
  /** Full original text, kept for the message record. */
  rawText: string;
  html: string | null;
  messageId: string | null;
  inReplyTo: string | null;
  /** Ticket number extracted from a `support+<id>@` address or subject tag. */
  ticketRef: number | null;
  attachments: Array<{
    filename: string;
    contentType: string;
    size: number;
    content: Buffer;
  }>;
}

// "On <date>, <name> wrote:" and similar reply preambles.
const QUOTE_MARKERS = [
  /^On .+wrote:$/im,
  /^-{2,}\s*Original Message\s*-{2,}/im,
  /^_{5,}/m,
  /^From:.*$/im,
];

// Common signature delimiters. `-- ` (dash-dash-space) is the RFC 3676 one.
const SIGNATURE_MARKERS = [/^--\s*$/m, /^Sent from my /im, /^Get Outlook for /im];

/** Strip quoted reply history: cut at the first quote marker we recognise. */
function stripQuotedHistory(text: string): string {
  let cut = text.length;
  for (const marker of QUOTE_MARKERS) {
    const m = marker.exec(text);
    if (m && m.index < cut) cut = m.index;
  }
  // Lines beginning with '>' are quoted; drop a trailing run of them too.
  return text.slice(0, cut);
}

/** Strip a trailing signature block. */
function stripSignature(text: string): string {
  let cut = text.length;
  for (const marker of SIGNATURE_MARKERS) {
    const m = marker.exec(text);
    if (m && m.index < cut) cut = m.index;
  }
  return text.slice(0, cut);
}

/** Collapse leftover quoted lines and excess whitespace. */
function tidy(text: string): string {
  return text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('>'))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Extract a ticket number from an inbound address or subject.
 *
 * Replies are routed by a plus-addressed recipient — `support+1234@domain` —
 * which survives round-trips better than subject parsing. The `[#1234]`
 * subject tag is a fallback for clients that strip plus addressing.
 */
export function extractTicketRef(toAddresses: string[], subject: string): number | null {
  for (const addr of toAddresses) {
    const m = /\+(\d+)@/.exec(addr);
    if (m) return Number(m[1]);
  }
  const subjectMatch = /\[#(\d+)\]/.exec(subject);
  return subjectMatch ? Number(subjectMatch[1]) : null;
}

/** Render the subject tag appended to outbound mail for reply correlation. */
export function subjectTag(ticketId: number): string {
  return `[#${ticketId}]`;
}

/** The plus-addressed reply-to address for a ticket. */
export function replyAddress(ticketId: number): string {
  const [local, domain] = config.supportFromAddress.split('@');
  return `${local}+${ticketId}@${domain ?? config.supportDomain}`;
}

/**
 * Parse a raw RFC822 message into the fields the ticketing layer needs.
 * Used by the inbound webhook when the mail provider forwards raw MIME.
 */
export async function parseRawEmail(raw: Buffer | string): Promise<ParsedInbound> {
  const mail: ParsedMail = await simpleParser(raw);
  return fromParsedMail(mail);
}

function addressList(value: ParsedMail['to']): string[] {
  if (!value) return [];
  const arr = Array.isArray(value) ? value : [value];
  return arr.flatMap((a) => a.value.map((v) => v.address ?? '')).filter(Boolean);
}

function fromParsedMail(mail: ParsedMail): ParsedInbound {
  const fromAddr = mail.from?.value[0];
  const rawText = mail.text ?? '';
  const cleanText = tidy(stripSignature(stripQuotedHistory(rawText)));

  return {
    fromEmail: (fromAddr?.address ?? '').toLowerCase(),
    fromName: fromAddr?.name || null,
    subject: mail.subject ?? '(no subject)',
    cleanText: cleanText || rawText.trim() || '(empty message)',
    rawText,
    html: typeof mail.html === 'string' ? mail.html : null,
    messageId: mail.messageId ?? null,
    inReplyTo: mail.inReplyTo ?? null,
    ticketRef: extractTicketRef(addressList(mail.to), mail.subject ?? ''),
    attachments: (mail.attachments ?? []).map((a) => ({
      filename: a.filename ?? 'attachment',
      contentType: a.contentType,
      size: a.size,
      content: a.content,
    })),
  };
}

/**
 * Build a ParsedInbound from an already-parsed JSON webhook payload (the
 * shape most managed mail providers POST). Reuses the same cleaning logic.
 */
export function fromWebhookPayload(payload: {
  from: string;
  fromName?: string;
  to?: string[];
  subject?: string;
  text?: string;
  html?: string;
  messageId?: string;
  inReplyTo?: string;
}): ParsedInbound {
  const rawText = payload.text ?? '';
  const cleanText = tidy(stripSignature(stripQuotedHistory(rawText)));
  return {
    fromEmail: payload.from.toLowerCase(),
    fromName: payload.fromName ?? null,
    subject: payload.subject ?? '(no subject)',
    cleanText: cleanText || rawText.trim() || '(empty message)',
    rawText,
    html: payload.html ?? null,
    messageId: payload.messageId ?? null,
    inReplyTo: payload.inReplyTo ?? null,
    ticketRef: extractTicketRef(payload.to ?? [], payload.subject ?? ''),
    attachments: [],
  };
}
