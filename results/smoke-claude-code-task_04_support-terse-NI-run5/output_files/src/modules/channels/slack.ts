/**
 * Slack channel adapter (optional integration).
 *
 * This is a typed boundary, not a live integration: it defines how Slack
 * messages map onto tickets so a real Slack app (Events API + Web API) can be
 * dropped in without touching the ticket core. `SLACK_BOT_TOKEN` would gate it.
 *
 * Wiring it up means:
 *  1. Subscribe to `message.channels` / `app_mention` Events API callbacks.
 *  2. Map each Slack thread (channel + thread_ts) to a ticket — store the pair
 *     in tickets.custom_fields, e.g. {"slack":{"channel":"C1","thread_ts":"…"}}.
 *  3. On an inbound Slack message, find-or-create the customer from the Slack
 *     user's email (users.info) and call tickets.createTicket / appendMessage
 *     with channel = 'slack'.
 *  4. On an agent reply with channel 'slack', post back via chat.postMessage.
 */
import { logger } from '../../logger';

export interface SlackInboundEvent {
  channel: string;
  threadTs: string;
  userEmail: string;
  userName: string;
  text: string;
}

export interface SlackOutbound {
  channel: string;
  threadTs: string;
  text: string;
}

/** True once a real Slack app token is configured. */
export function slackEnabled(): boolean {
  return Boolean(process.env.SLACK_BOT_TOKEN);
}

/** Post an agent reply back to a Slack thread. No-op until configured. */
export async function postToSlack(msg: SlackOutbound): Promise<void> {
  if (!slackEnabled()) {
    logger.warn({ channel: msg.channel }, 'Slack not configured — outbound Slack message dropped');
    return;
  }
  // Real implementation: POST https://slack.com/api/chat.postMessage
  // with { channel, thread_ts: msg.threadTs, text: msg.text }.
  throw new Error('Slack Web API client not implemented — see module header');
}
