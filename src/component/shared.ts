import { type Infer, v } from "convex/values";
import {
  type GenericActionCtx,
  type GenericDataModel,
  type GenericMutationCtx,
  type GenericQueryCtx,
} from "convex/server";

export const vOutboundStatus = v.union(
  v.literal("pending"),
  v.literal("sent"),
  v.literal("failed"),
  v.literal("delivered"),
  v.literal("bounced"),
  v.literal("complained"),
  v.literal("rejected"),
);
export type OutboundStatus = Infer<typeof vOutboundStatus>;

export const vSendKind = v.union(
  v.literal("send"),
  v.literal("reply"),
  v.literal("reply_all"),
  v.literal("forward"),
);
export type SendKind = Infer<typeof vSendKind>;

export const vAddresses = v.union(v.string(), v.array(v.string()));

export const vAttachment = v.object({
  filename: v.string(),
  content: v.string(),
  content_type: v.optional(v.string()),
});

export const vSendPayload = v.object({
  labels: v.optional(v.array(v.string())),
  reply_to: v.optional(vAddresses),
  to: v.optional(vAddresses),
  cc: v.optional(vAddresses),
  bcc: v.optional(vAddresses),
  subject: v.optional(v.string()),
  text: v.optional(v.string()),
  html: v.optional(v.string()),
  attachments: v.optional(v.array(vAttachment)),
  headers: v.optional(v.record(v.string(), v.string())),
  reply_all: v.optional(v.boolean()),
});
export type SendPayload = Infer<typeof vSendPayload>;

export const vEventType = v.union(
  v.literal("message.received"),
  v.literal("message.sent"),
  v.literal("message.delivered"),
  v.literal("message.bounced"),
  v.literal("message.complained"),
  v.literal("message.rejected"),
  v.literal("domain.verified"),
);
export type EventType = Infer<typeof vEventType>;

export const vEvent = v.object({
  type: v.literal("event"),
  event_type: vEventType,
  event_id: v.string(),
  message: v.optional(v.any()),
  thread: v.optional(v.any()),
  send: v.optional(v.any()),
  delivery: v.optional(v.any()),
  bounce: v.optional(v.any()),
  complaint: v.optional(v.any()),
  reject: v.optional(v.any()),
  domain: v.optional(v.any()),
});
export type AgentMailEvent = Infer<typeof vEvent>;

export const vRuntimeConfig = v.object({
  apiKey: v.string(),
  baseUrl: v.string(),
  retryAttempts: v.number(),
  initialBackoffMs: v.number(),
  onMessageReceived: v.optional(v.object({ fnHandle: v.string() })),
  onEvent: v.optional(v.object({ fnHandle: v.string() })),
});
export type RuntimeConfig = Infer<typeof vRuntimeConfig>;

export type RunQueryCtx = {
  runQuery: GenericQueryCtx<GenericDataModel>["runQuery"];
};
export type RunMutationCtx = {
  runMutation: GenericMutationCtx<GenericDataModel>["runMutation"];
};
export type RunActionCtx = {
  runAction: GenericActionCtx<GenericDataModel>["runAction"];
  runMutation: GenericActionCtx<GenericDataModel>["runMutation"];
  runQuery: GenericActionCtx<GenericDataModel>["runQuery"];
};
