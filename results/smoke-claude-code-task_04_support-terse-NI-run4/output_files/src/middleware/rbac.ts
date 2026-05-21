import { NextFunction, Request, Response } from 'express';
import { forbidden, unauthorized } from '../errors';
import { AgentRole } from '../types';

/**
 * Role-based access control for agent endpoints (SOC2 access controls).
 * Roles are ordered: admin ⊃ team_lead ⊃ agent.
 */
const RANK: Record<AgentRole, number> = { agent: 1, team_lead: 2, admin: 3 };

/** Require the agent's role to be at least `minRole`. */
export function requireRole(minRole: AgentRole) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const principal = req.principal;
    if (!principal || principal.kind !== 'agent' || !principal.role) {
      return next(unauthorized('Agent access required'));
    }
    if (RANK[principal.role] < RANK[minRole]) {
      return next(forbidden(`Requires ${minRole} role`));
    }
    next();
  };
}

export const requireAdmin = requireRole('admin');
export const requireTeamLead = requireRole('team_lead');
