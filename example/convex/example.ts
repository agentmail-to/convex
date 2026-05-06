import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { AgentMail, type OutboundId } from "@agentmail/convex";

const agentmail = new AgentMail(components.agentmail, {
  onMessageReceived: internal.example.onMessageReceived,
});

// Create an inbox the user's agent can send and receive from.
export const createInbox = action({
  args: { displayName: v.optional(v.string()) },
  handler: async (ctx, args) => {
    return await agentmail.createInbox(ctx, {
      displayName: args.displayName,
    });
  },
});

// Send an email. Returns an outboundId the UI can subscribe to for status.
export const sendMessage = mutation({
  args: {
    inboxId: v.string(),
    to: v.string(),
    subject: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    return await agentmail.sendMessage(ctx, args.inboxId, {
      to: args.to,
      subject: args.subject,
      text: args.text,
    });
  },
});

// Reactive query: subscribe in your frontend to see new mail land instantly.
export const listMessages = query({
  args: { inboxId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.agentmail.lib.listInboundMessages, {
      inboxId: args.inboxId,
    });
  },
});

// Live status of a send.
export const sendStatus = query({
  args: { outboundId: v.string() },
  handler: async (ctx, args) => {
    return await agentmail.status(ctx, args.outboundId as OutboundId);
  },
});

// Hook fired by the component on every inbound message. Wire your LLM here.
export const onMessageReceived = internalMutation({
  args: {
    message: v.any(),
    thread: v.any(),
    eventId: v.string(),
  },
  handler: async (ctx, args) => {
    // Example: schedule an auto-reply via an action that calls your LLM.
    await ctx.scheduler.runAfter(0, internal.example.draftAutoReply, {
      inboxId: args.message.inbox_id,
      messageId: args.message.message_id,
      from: args.message.from,
      subject: args.message.subject,
      text: args.message.text ?? args.message.preview ?? "",
    });
  },
});

export const draftAutoReply = action({
  args: {
    inboxId: v.string(),
    messageId: v.string(),
    from: v.string(),
    subject: v.optional(v.string()),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    // TODO: call your LLM with args.text and craft a reply body.
    const replyBody = `Thanks for your message. We received: "${args.text.slice(0, 200)}"`;

    await agentmail.replyToMessage(ctx, args.inboxId, args.messageId, {
      text: replyBody,
    });
  },
});
