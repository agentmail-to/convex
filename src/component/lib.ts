import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server.js";
import { components, internal } from "./_generated/api.js";
import { Workpool } from "@convex-dev/workpool";
import {
  vRuntimeConfig,
  vSendKind,
  vSendPayload,
  type AgentMailEvent,
} from "./shared.js";
import type { FunctionHandle } from "convex/server";
import { agentmailFetch, AgentMailApiError } from "./utils.js";
import {
  extractIndexFields,
  mapEventToOutboundStatus,
  sendPath,
  TERMINAL_STATUSES,
} from "./eventLogic.js";

const FINALIZED_OUTBOUND_RETENTION_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const SEND_POOL_PARALLELISM = 8;
const CALLBACK_POOL_PARALLELISM = 8;

const sendPool = new Workpool(components.sendPool, {
  maxParallelism: SEND_POOL_PARALLELISM,
});

const callbackPool = new Workpool(components.callbackPool, {
  maxParallelism: CALLBACK_POOL_PARALLELISM,
});

// ---------------------------------------------------------------------------
// Inboxes
// ---------------------------------------------------------------------------

export const createInbox = internalAction({
  args: {
    config: vRuntimeConfig,
    request: v.object({
      username: v.optional(v.string()),
      domain: v.optional(v.string()),
      display_name: v.optional(v.string()),
      client_id: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const inbox = (await agentmailFetch(args.config, "/inboxes", {
      method: "POST",
      body: args.request,
    })) as InboxResponse;
    await ctx.runMutation(internal.lib.upsertInbox, { inbox });
    return inbox;
  },
});

export const listInboxes = internalAction({
  args: {
    config: vRuntimeConfig,
    limit: v.optional(v.number()),
    page_token: v.optional(v.string()),
    ascending: v.optional(v.boolean()),
  },
  handler: async (_ctx, args) => {
    return await agentmailFetch(args.config, "/inboxes", {
      method: "GET",
      query: {
        limit: args.limit,
        page_token: args.page_token,
        ascending: args.ascending,
      },
    });
  },
});

export const getInboxRemote = internalAction({
  args: { config: vRuntimeConfig, inboxId: v.string() },
  handler: async (ctx, args) => {
    const inbox = (await agentmailFetch(
      args.config,
      `/inboxes/${args.inboxId}`,
      { method: "GET" },
    )) as InboxResponse;
    await ctx.runMutation(internal.lib.upsertInbox, { inbox });
    return inbox;
  },
});

export const deleteInbox = internalAction({
  args: { config: vRuntimeConfig, inboxId: v.string() },
  handler: async (ctx, args) => {
    await agentmailFetch(args.config, `/inboxes/${args.inboxId}`, {
      method: "DELETE",
    });
    await ctx.runMutation(internal.lib.removeInbox, { inboxId: args.inboxId });
    return null;
  },
});

type InboxResponse = {
  pod_id?: string;
  inbox_id: string;
  email: string;
  display_name?: string;
  client_id?: string;
  created_at: string;
  updated_at: string;
};

export const upsertInbox = internalMutation({
  args: { inbox: v.any() },
  handler: async (ctx, args) => {
    const inbox = args.inbox as InboxResponse;
    const existing = await ctx.db
      .query("inboxes")
      .withIndex("by_inboxId", (q) => q.eq("inboxId", inbox.inbox_id))
      .unique();
    const doc = {
      inboxId: inbox.inbox_id,
      podId: inbox.pod_id,
      email: inbox.email,
      displayName: inbox.display_name,
      clientId: inbox.client_id,
      createdAt: Date.parse(inbox.created_at),
      updatedAt: Date.parse(inbox.updated_at),
    };
    if (existing) {
      await ctx.db.replace(existing._id, doc);
    } else {
      await ctx.db.insert("inboxes", doc);
    }
  },
});

export const removeInbox = internalMutation({
  args: { inboxId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("inboxes")
      .withIndex("by_inboxId", (q) => q.eq("inboxId", args.inboxId))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
  },
});

export const listCachedInboxes = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("inboxes").collect();
  },
});

export const getCachedInbox = query({
  args: { inboxId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("inboxes")
      .withIndex("by_inboxId", (q) => q.eq("inboxId", args.inboxId))
      .unique();
  },
});

// ---------------------------------------------------------------------------
// Sending: enqueueSend (mutation) -> workpool -> performSend (action) -> onSendComplete
// ---------------------------------------------------------------------------

export const enqueueSend = mutation({
  args: {
    config: vRuntimeConfig,
    inboxId: v.string(),
    kind: vSendKind,
    parentMessageId: v.optional(v.string()),
    payload: vSendPayload,
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("outboundMessages", {
      inboxId: args.inboxId,
      kind: args.kind,
      parentMessageId: args.parentMessageId,
      payload: args.payload,
      status: "pending",
    });
    await sendPool.enqueueAction(
      ctx,
      internal.lib.performSend,
      { config: args.config, outboundId: id },
      {
        retry: {
          maxAttempts: args.config.retryAttempts,
          initialBackoffMs: args.config.initialBackoffMs,
          base: 2,
        },
        context: { outboundId: id },
        onComplete: internal.lib.onSendComplete,
      },
    );
    return id;
  },
});

export const cancelSend = mutation({
  args: { outboundId: v.id("outboundMessages") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.outboundId);
    if (!row) throw new Error("Outbound message not found");
    if (row.status !== "pending" && row.status !== "sending") {
      throw new Error(`Cannot cancel: status is ${row.status}`);
    }
    await ctx.db.patch(args.outboundId, {
      status: "failed",
      errorMessage: "Cancelled by user",
      finalizedAt: Date.now(),
    });
  },
});

const vSendResult = v.union(
  v.null(),
  v.object({
    agentmailMessageId: v.string(),
    threadId: v.string(),
  }),
);

export const performSend = internalAction({
  args: { config: vRuntimeConfig, outboundId: v.id("outboundMessages") },
  returns: vSendResult,
  handler: async (ctx, args) => {
    const row = await ctx.runQuery(internal.lib.getOutbound, {
      outboundId: args.outboundId,
    });
    if (!row || row.status === "failed") {
      // Cancelled or already finalized.
      return null;
    }

    const path = sendPath(row.inboxId, row.kind, row.parentMessageId);

    try {
      const response = (await agentmailFetch(args.config, path, {
        method: "POST",
        body: row.payload,
      })) as { message_id: string; thread_id: string } | null;

      // Defensive: AgentMail's send endpoints always return JSON; guard the
      // pathological case so we surface a clear error rather than NPE on
      // null.message_id.
      if (!response || !response.message_id || !response.thread_id) {
        await ctx.runMutation(internal.lib.markSendFailed, {
          outboundId: args.outboundId,
          errorMessage: "AgentMail returned a 2xx without a JSON send response",
        });
        return null;
      }

      return {
        agentmailMessageId: response.message_id,
        threadId: response.thread_id,
      };
    } catch (err) {
      if (err instanceof AgentMailApiError && err.permanent) {
        await ctx.runMutation(internal.lib.markSendFailed, {
          outboundId: args.outboundId,
          errorMessage: `${err.message}: ${err.body}`,
        });
        return null;
      }
      // Transient: throw so workpool retries.
      throw err;
    }
  },
});

export const onSendComplete = sendPool.defineOnComplete({
  context: v.object({ outboundId: v.id("outboundMessages") }),
  handler: async (ctx, args) => {
    const { outboundId } = args.context;
    const row = await ctx.db.get(outboundId);
    if (!row) return;

    if (args.result.kind === "success") {
      const value = args.result.returnValue as
        | { agentmailMessageId: string; threadId: string }
        | null;
      if (value === null) return; // permanent error path already wrote failure
      // Set finalizedAt so the cleanup sweep can reclaim sent rows that
      // never receive a delivery webhook (e.g. customers who don't subscribe
      // to message.delivered events).
      await ctx.db.patch(outboundId, {
        status: "sent",
        agentmailMessageId: value.agentmailMessageId,
        threadId: value.threadId,
        finalizedAt: Date.now(),
      });
    } else if (args.result.kind === "failed") {
      await ctx.db.patch(outboundId, {
        status: "failed",
        errorMessage: args.result.error,
        finalizedAt: Date.now(),
      });
    } else if (args.result.kind === "canceled") {
      // Don't clobber a user-set "Cancelled by user" message if cancelSend
      // already moved the row to failed.
      if (row.status === "failed") return;
      await ctx.db.patch(outboundId, {
        status: "failed",
        errorMessage: "Workpool cancelled the send",
        finalizedAt: Date.now(),
      });
    }
  },
});

export const markSendFailed = internalMutation({
  args: {
    outboundId: v.id("outboundMessages"),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.outboundId, {
      status: "failed",
      errorMessage: args.errorMessage,
      finalizedAt: Date.now(),
    });
  },
});

export const getOutbound = internalQuery({
  args: { outboundId: v.id("outboundMessages") },
  handler: async (ctx, args) => ctx.db.get(args.outboundId),
});

export const getOutboundStatus = query({
  args: { outboundId: v.id("outboundMessages") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.outboundId);
    if (!row) return null;
    return {
      status: row.status,
      agentmailMessageId: row.agentmailMessageId ?? null,
      threadId: row.threadId ?? null,
      errorMessage: row.errorMessage ?? null,
    };
  },
});

// ---------------------------------------------------------------------------
// Threads / messages: thin wrappers over remote API
// ---------------------------------------------------------------------------

export const listThreads = internalAction({
  args: {
    config: vRuntimeConfig,
    inboxId: v.string(),
    limit: v.optional(v.number()),
    page_token: v.optional(v.string()),
    labels: v.optional(v.array(v.string())),
    before: v.optional(v.string()),
    after: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    return await agentmailFetch(
      args.config,
      `/inboxes/${args.inboxId}/threads`,
      {
        method: "GET",
        query: {
          limit: args.limit,
          page_token: args.page_token,
          before: args.before,
          after: args.after,
          labels: args.labels?.join(","),
        },
      },
    );
  },
});

export const getThread = internalAction({
  args: { config: vRuntimeConfig, inboxId: v.string(), threadId: v.string() },
  handler: async (_ctx, args) => {
    return await agentmailFetch(
      args.config,
      `/inboxes/${args.inboxId}/threads/${args.threadId}`,
      { method: "GET" },
    );
  },
});

export const getMessage = internalAction({
  args: { config: vRuntimeConfig, inboxId: v.string(), messageId: v.string() },
  handler: async (_ctx, args) => {
    return await agentmailFetch(
      args.config,
      `/inboxes/${args.inboxId}/messages/${args.messageId}`,
      { method: "GET" },
    );
  },
});

export const listInboundMessages = query({
  args: { inboxId: v.optional(v.string()), threadId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (args.threadId) {
      return await ctx.db
        .query("inboundMessages")
        .withIndex("by_thread", (q) => q.eq("threadId", args.threadId!))
        .order("asc")
        .collect();
    }
    if (args.inboxId) {
      return await ctx.db
        .query("inboundMessages")
        .withIndex("by_inbox", (q) => q.eq("inboxId", args.inboxId!))
        .order("desc")
        .collect();
    }
    return await ctx.db.query("inboundMessages").order("desc").take(100);
  },
});

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export const handleEvent = mutation({
  args: { config: vRuntimeConfig, event: v.any() },
  handler: async (ctx, args) => {
    const event = args.event as AgentMailEvent;

    // Idempotency: skip if we've already processed this event_id.
    const existing = await ctx.db
      .query("events")
      .withIndex("by_eventId", (q) => q.eq("eventId", event.event_id))
      .unique();
    if (existing) return;

    const indexFields = extractIndexFields(event);

    await ctx.db.insert("events", {
      eventId: event.event_id,
      eventType: event.event_type,
      ...indexFields,
      receivedAt: Date.now(),
      raw: event,
    });

    if (event.event_type === "message.received" && event.message) {
      const m = event.message as InboundMessagePayload;
      await ctx.db.insert("inboundMessages", {
        inboxId: m.inbox_id,
        threadId: m.thread_id,
        messageId: m.message_id,
        eventId: event.event_id,
        from: m.from,
        to: Array.isArray(m.to) ? m.to : [m.to],
        cc: m.cc ? (Array.isArray(m.cc) ? m.cc : [m.cc]) : undefined,
        subject: m.subject,
        preview: m.preview,
        text: m.text,
        html: m.html,
        extractedText: m.extracted_text,
        extractedHtml: m.extracted_html,
        inReplyTo: m.in_reply_to,
        references: m.references,
        timestamp: Date.parse(m.timestamp),
        raw: m,
      });
    }

    if (indexFields.messageId) {
      await applyEventToOutbound(ctx, indexFields.messageId, event);
    }

    // User callbacks via the callbackPool so a user-handler failure cannot block webhook ingest.
    if (args.config.onEvent) {
      const handle = args.config.onEvent.fnHandle as FunctionHandle<
        "mutation",
        { event: AgentMailEvent }
      >;
      await callbackPool.enqueueMutation(ctx, handle, { event });
    }
    if (
      args.config.onMessageReceived &&
      event.event_type === "message.received"
    ) {
      const handle = args.config.onMessageReceived
        .fnHandle as FunctionHandle<
        "mutation",
        { message: unknown; thread: unknown; eventId: string }
      >;
      await callbackPool.enqueueMutation(ctx, handle, {
        message: event.message,
        thread: event.thread,
        eventId: event.event_id,
      });
    }
  },
});

type InboundMessagePayload = {
  inbox_id: string;
  thread_id: string;
  message_id: string;
  from: string;
  to: string | string[];
  cc?: string | string[];
  subject?: string;
  preview?: string;
  text?: string;
  html?: string;
  extracted_text?: string;
  extracted_html?: string;
  in_reply_to?: string;
  references?: string[];
  timestamp: string;
};

async function applyEventToOutbound(
  ctx: { db: import("./_generated/server.js").MutationCtx["db"] },
  messageId: string,
  event: AgentMailEvent,
) {
  const outbound = await ctx.db
    .query("outboundMessages")
    .withIndex("by_agentmailMessageId", (q) =>
      q.eq("agentmailMessageId", messageId),
    )
    .unique();
  if (!outbound) return;

  const next = mapEventToOutboundStatus(event.event_type);
  if (!next) return;

  const finalizedAt =
    next === "delivered" || next === "bounced" || next === "rejected"
      ? Date.now()
      : undefined;
  await ctx.db.patch(outbound._id, {
    status: next,
    ...(finalizedAt ? { finalizedAt } : {}),
  });
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

// Sweeps any row whose status is terminal and whose finalizedAt is older than
// the retention threshold. Reads each terminal status via its index so the
// scan stays cheap even with millions of rows.
export const cleanupFinalizedOutbound = mutation({
  args: { olderThan: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const olderThan = args.olderThan ?? FINALIZED_OUTBOUND_RETENTION_MS;
    const cutoff = Date.now() - olderThan;
    const PER_STATUS_LIMIT = 200;
    for (const status of TERMINAL_STATUSES) {
      const rows = await ctx.db
        .query("outboundMessages")
        .withIndex("by_status", (q) => q.eq("status", status))
        .take(PER_STATUS_LIMIT);
      for (const row of rows) {
        if (row.finalizedAt && row.finalizedAt < cutoff) {
          await ctx.db.delete(row._id);
        }
      }
    }
  },
});
