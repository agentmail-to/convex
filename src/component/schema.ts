import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { vEventType, vOutboundStatus, vSendKind } from "./shared.js";

export default defineSchema({
  // Outbound message attempts. The lifecycle: pending -> sending -> sent -> (delivered|bounced|...).
  // Webhook events from AgentMail update the status after the initial send via inbox_id+message_id.
  outboundMessages: defineTable({
    inboxId: v.string(),
    kind: vSendKind,
    // For replies/reply_all/forward, the parent message_id. Empty string for plain sends.
    parentMessageId: v.optional(v.string()),
    // Compact stored payload (validators/types in shared.ts).
    payload: v.any(),
    status: vOutboundStatus,
    // Set after AgentMail accepts the send.
    agentmailMessageId: v.optional(v.string()),
    threadId: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    finalizedAt: v.optional(v.number()),
  })
    .index("by_status", ["status"])
    .index("by_agentmailMessageId", ["agentmailMessageId"]),

  // Cached inbox metadata. Populated on createInbox or via getInbox.
  inboxes: defineTable({
    inboxId: v.string(),
    podId: v.optional(v.string()),
    email: v.string(),
    displayName: v.optional(v.string()),
    clientId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_inboxId", ["inboxId"]),

  // Inbound messages persisted from message.received webhooks.
  inboundMessages: defineTable({
    inboxId: v.string(),
    threadId: v.string(),
    messageId: v.string(),
    eventId: v.optional(v.string()),
    from: v.string(),
    to: v.array(v.string()),
    cc: v.optional(v.array(v.string())),
    subject: v.optional(v.string()),
    preview: v.optional(v.string()),
    text: v.optional(v.string()),
    html: v.optional(v.string()),
    extractedText: v.optional(v.string()),
    extractedHtml: v.optional(v.string()),
    inReplyTo: v.optional(v.string()),
    references: v.optional(v.array(v.string())),
    timestamp: v.number(),
    raw: v.any(),
  })
    .index("by_inbox", ["inboxId"])
    .index("by_thread", ["threadId"])
    .index("by_messageId", ["messageId"]),

  // Audit log of every webhook event we accepted, for analytics + idempotency.
  events: defineTable({
    eventId: v.string(),
    eventType: vEventType,
    inboxId: v.optional(v.string()),
    threadId: v.optional(v.string()),
    messageId: v.optional(v.string()),
    receivedAt: v.number(),
    raw: v.any(),
  })
    .index("by_eventId", ["eventId"])
    .index("by_message", ["messageId"]),
});
