/** Shared domain types mirrored from the database enums. */

export type AgentRole = 'agent' | 'team_lead' | 'admin';

export type TicketStatus =
  | 'new'
  | 'open'
  | 'pending'
  | 'on_hold'
  | 'resolved'
  | 'closed';

export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';

export type TicketChannel = 'email' | 'web' | 'slack' | 'api';

export type AuthorType = 'customer' | 'agent' | 'system';

/** Statuses that count a ticket as "done" for SLA + CSAT purposes. */
export const TERMINAL_STATUSES: TicketStatus[] = ['resolved', 'closed'];

/** The authenticated principal attached to a request by the auth middleware. */
export interface Principal {
  kind: 'agent' | 'customer';
  id: string;
  role?: AgentRole; // present only for agents
  teamId?: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      principal?: Principal;
    }
  }
}
