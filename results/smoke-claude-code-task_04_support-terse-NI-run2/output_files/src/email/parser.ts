import { simpleParser, ParsedMail } from 'mailparser';

export interface ParsedEmail {
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  from: { address: string; name?: string } | null;
  to:   string[];
  cc:   string[];
  subject: string;
  text: string;
  html: string | null;
  attachments: Array<{ filename: string; contentType: string; size: number; cid?: string }>;
  // ticketRef parsed out of subject (e.g. [#12345]) — primary thread key.
  ticketRef: number | null;
}

const TICKET_REF_RE = /\[#(\d+)\]/;

// Strip "On <date>, <author> wrote:" quote tails and common signature delimiters.
const QUOTE_RE = /\n+On .+?wrote:[\s\S]*$/m;
const SIG_RE   = /\n-- \n[\s\S]*$/m;
const REPLY_RE = /(^|\n)>+.*(\n|$)/g;

export function stripQuotedAndSignature(text: string): string {
  let cleaned = text;
  cleaned = cleaned.replace(QUOTE_RE, '');
  cleaned = cleaned.replace(SIG_RE, '');
  // Drop blocks of quoted lines (>>>); leave the rest alone.
  cleaned = cleaned.replace(REPLY_RE, '\n');
  return cleaned.trim();
}

export async function parseRawEmail(raw: Buffer | string): Promise<ParsedEmail> {
  const parsed: ParsedMail = await simpleParser(raw);

  const subjectStr = parsed.subject ?? '';
  const refMatch = subjectStr.match(TICKET_REF_RE);

  const fromAddr = parsed.from?.value?.[0];

  return {
    messageId: parsed.messageId ?? null,
    inReplyTo: (parsed.inReplyTo as string | undefined) ?? null,
    references: Array.isArray(parsed.references)
      ? (parsed.references as string[])
      : parsed.references ? [parsed.references as string] : [],
    from: fromAddr ? { address: fromAddr.address ?? '', name: fromAddr.name } : null,
    to: (parsed.to && 'value' in parsed.to ? parsed.to.value : []).map(v => v.address ?? '').filter(Boolean),
    cc: (parsed.cc && 'value' in parsed.cc ? parsed.cc.value : []).map(v => v.address ?? '').filter(Boolean),
    subject: subjectStr,
    text: stripQuotedAndSignature(parsed.text ?? ''),
    html: parsed.html || null,
    attachments: (parsed.attachments ?? []).map(a => ({
      filename: a.filename ?? 'attachment',
      contentType: a.contentType ?? 'application/octet-stream',
      size: a.size ?? 0,
      cid: a.cid,
    })),
    ticketRef: refMatch ? Number(refMatch[1]) : null,
  };
}
