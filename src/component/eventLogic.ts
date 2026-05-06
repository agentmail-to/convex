import type { AgentMailEvent, OutboundStatus } from "./shared.js";

/**
 * Pure helper for routing send actions to the correct AgentMail endpoint.
 * Tested standalone; used by lib.performSend.
 */
export function sendPath(
  inboxId: string,
  kind: "send" | "reply" | "reply_all" | "forward",
  parentMessageId?: string,
): string {
  const base = `/inboxes/${inboxId}/messages`;
  switch (kind) {
    case "send":
      return `${base}/send`;
    case "reply":
      if (!parentMessageId) throw new Error("parentMessageId required for reply");
      return `${base}/${parentMessageId}/reply`;
    case "reply_all":
      if (!parentMessageId)
        throw new Error("parentMessageId required for reply_all");
      return `${base}/${parentMessageId}/reply-all`;
    case "forward":
      if (!parentMessageId)
        throw new Error("parentMessageId required for forward");
      return `${base}/${parentMessageId}/forward`;
  }
}

/**
 * Pull the inbox/thread/message identifiers out of any AgentMail event payload,
 * regardless of which sub-object (`message`, `send`, `delivery`, ...) carries them.
 */
export function extractIndexFields(event: AgentMailEvent): {
  inboxId?: string;
  threadId?: string;
  messageId?: string;
} {
  const payload =
    event.message ??
    event.send ??
    event.delivery ??
    event.bounce ??
    event.complaint ??
    event.reject ??
    {};
  return {
    inboxId: payload.inbox_id,
    threadId: payload.thread_id,
    messageId: payload.message_id,
  };
}

/**
 * Map a webhook event_type to the next outbound status, if the event implies
 * one. Returns undefined for events that don't update outbound status
 * (message.received, domain.verified).
 */
export function mapEventToOutboundStatus(
  eventType: AgentMailEvent["event_type"],
): OutboundStatus | undefined {
  switch (eventType) {
    case "message.sent":
      return "sent";
    case "message.delivered":
      return "delivered";
    case "message.bounced":
      return "bounced";
    case "message.complained":
      return "complained";
    case "message.rejected":
      return "rejected";
    case "message.received":
    case "domain.verified":
      return undefined;
  }
}

/**
 * Returns whether the given outbound status is terminal (no more transitions expected).
 */
export function isTerminalStatus(status: OutboundStatus): boolean {
  return (
    status === "delivered" ||
    status === "bounced" ||
    status === "complained" ||
    status === "rejected" ||
    status === "failed"
  );
}
