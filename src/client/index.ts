import {
  createFunctionHandle,
  type FunctionReference,
  type FunctionVisibility,
} from "convex/server";
import { v, type VString } from "convex/values";
import {
  type AgentMailEvent,
  type RunActionCtx,
  type RunMutationCtx,
  type RunQueryCtx,
  type RuntimeConfig,
} from "../component/shared.js";
import {
  toSendPayload,
  type ForwardArgs,
  type ReplyArgs,
  type SendArgs,
} from "./payload.js";
import { verifyAgentMailWebhook, WebhookVerificationError } from "./webhook.js";
import type { ComponentApi } from "../component/_generated/component.js";
import type { Id } from "../component/_generated/dataModel.js";

export type AgentMailComponent = ComponentApi;

export type OutboundId = Id<"outboundMessages">;
export const vOutboundId = v.string() as VString<OutboundId>;

export {
  vEvent,
  vEventType,
  vOutboundStatus,
  vSendKind,
} from "../component/shared.js";
export type {
  AgentMailEvent,
  EventType,
  OutboundStatus,
  SendKind,
} from "../component/shared.js";
export type { SendArgs, ReplyArgs, ForwardArgs } from "./payload.js";
export { toSendPayload } from "./payload.js";
export { verifyAgentMailWebhook, WebhookVerificationError } from "./webhook.js";

// Defaults for the non-sensitive tuning params. Sensitive credentials
// (AGENTMAIL_API_KEY, AGENTMAIL_BASE_URL, AGENTMAIL_WEBHOOK_SECRET) are
// read directly from process.env on the deployment that hosts the
// component, so they never flow through mutation args and never appear
// in Convex function logs.
const DEFAULT_RETRY_ATTEMPTS = 5;
const DEFAULT_INITIAL_BACKOFF_MS = 30_000;

type Config = RuntimeConfig & { webhookSecret: string };

export type AgentMailOptions = {
  /** Override `AGENTMAIL_WEBHOOK_SECRET` for the webhook handler. */
  webhookSecret?: string;
  initialBackoffMs?: number;
  retryAttempts?: number;
  /** Mutation invoked on every webhook event. */
  onEvent?: FunctionReference<
    "mutation",
    FunctionVisibility,
    { event: AgentMailEvent }
  > | null;
  /** Mutation invoked specifically on inbound mail. Most common hook. */
  onMessageReceived?: FunctionReference<
    "mutation",
    FunctionVisibility,
    { message: unknown; thread: unknown; eventId: string }
  > | null;
};

export class AgentMail {
  public config: Config;
  private onEvent?: AgentMailOptions["onEvent"];
  private onMessageReceived?: AgentMailOptions["onMessageReceived"];

  /**
   * Create an AgentMail component handle.
   *
   * @param component The component reference, e.g. `components.agentmail`.
   * @param options Overrides for environment-driven defaults.
   */
  constructor(
    public component: ComponentApi,
    options?: AgentMailOptions,
  ) {
    this.config = {
      webhookSecret:
        options?.webhookSecret ?? process.env.AGENTMAIL_WEBHOOK_SECRET ?? "",
      initialBackoffMs: options?.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS,
      retryAttempts: options?.retryAttempts ?? DEFAULT_RETRY_ATTEMPTS,
    };
    this.onEvent = options?.onEvent ?? undefined;
    this.onMessageReceived = options?.onMessageReceived ?? undefined;
  }

  // ---- Inboxes ---------------------------------------------------------

  async createInbox(
    ctx: RunActionCtx,
    request: {
      username?: string;
      domain?: string;
      displayName?: string;
      clientId?: string;
    } = {},
  ) {
    return await ctx.runAction(this.component.lib.createInbox, {
      request: {
        username: request.username,
        domain: request.domain,
        display_name: request.displayName,
        client_id: request.clientId,
      },
    });
  }

  async listInboxes(
    ctx: RunActionCtx,
    args: { limit?: number; pageToken?: string; ascending?: boolean } = {},
  ) {
    return await ctx.runAction(this.component.lib.listInboxes, {
      limit: args.limit,
      page_token: args.pageToken,
      ascending: args.ascending,
    });
  }

  async getInbox(ctx: RunActionCtx, inboxId: string) {
    return await ctx.runAction(this.component.lib.getInboxRemote, {
      inboxId,
    });
  }

  async deleteInbox(ctx: RunActionCtx, inboxId: string) {
    return await ctx.runAction(this.component.lib.deleteInbox, {
      inboxId,
    });
  }

  // ---- Sending ---------------------------------------------------------

  /**
   * Enqueue a message to send. Returns an OutboundId you can poll via
   * {@link status}, or subscribe to with `useQuery`.
   */
  async sendMessage(
    ctx: RunMutationCtx,
    inboxId: string,
    args: SendArgs,
  ): Promise<OutboundId> {
    this.assertConfigured("send");
    const id = await ctx.runMutation(this.component.lib.enqueueSend, {
      config: await this.runtimeConfig(),
      inboxId,
      kind: "send",
      payload: toSendPayload(args),
    });
    return id as OutboundId;
  }

  async replyToMessage(
    ctx: RunMutationCtx,
    inboxId: string,
    parentMessageId: string,
    args: ReplyArgs,
  ): Promise<OutboundId> {
    this.assertConfigured("send");
    const id = await ctx.runMutation(this.component.lib.enqueueSend, {
      config: await this.runtimeConfig(),
      inboxId,
      kind: args.replyAll ? "reply_all" : "reply",
      parentMessageId,
      payload: toSendPayload(args),
    });
    return id as OutboundId;
  }

  async forwardMessage(
    ctx: RunMutationCtx,
    inboxId: string,
    parentMessageId: string,
    args: ForwardArgs,
  ): Promise<OutboundId> {
    this.assertConfigured("send");
    const id = await ctx.runMutation(this.component.lib.enqueueSend, {
      config: await this.runtimeConfig(),
      inboxId,
      kind: "forward",
      parentMessageId,
      payload: toSendPayload(args),
    });
    return id as OutboundId;
  }

  async cancel(ctx: RunMutationCtx, outboundId: OutboundId) {
    await ctx.runMutation(this.component.lib.cancelSend, {
      outboundId,
    });
  }

  async status(ctx: RunQueryCtx, outboundId: OutboundId) {
    return await ctx.runQuery(this.component.lib.getOutboundStatus, {
      outboundId,
    });
  }

  // ---- Threads / messages (remote reads) -------------------------------

  async listThreads(
    ctx: RunActionCtx,
    inboxId: string,
    args: { limit?: number; pageToken?: string; labels?: string[] } = {},
  ) {
    return await ctx.runAction(this.component.lib.listThreads, {
      inboxId,
      limit: args.limit,
      page_token: args.pageToken,
      labels: args.labels,
    });
  }

  async getThread(
    ctx: RunActionCtx,
    inboxId: string,
    threadId: string,
  ) {
    return await ctx.runAction(this.component.lib.getThread, {
      inboxId,
      threadId,
    });
  }

  async getMessage(
    ctx: RunActionCtx,
    inboxId: string,
    messageId: string,
  ) {
    return await ctx.runAction(this.component.lib.getMessage, {
      inboxId,
      messageId,
    });
  }

  // ---- Webhook ---------------------------------------------------------

  /**
   * Verify and dispatch an AgentMail webhook. Mount this in `convex/http.ts`.
   */
  async handleWebhook(
    ctx: RunMutationCtx,
    req: Request,
  ): Promise<Response> {
    this.assertConfigured("webhook");
    const raw = await req.text();
    const headers = {
      "svix-id": req.headers.get("svix-id") ?? "",
      "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
      "svix-signature": req.headers.get("svix-signature") ?? "",
    };
    let event: AgentMailEvent;
    try {
      event = verifyAgentMailWebhook(this.config.webhookSecret, raw, headers);
    } catch (err) {
      if (err instanceof WebhookVerificationError) {
        return new Response("invalid signature", { status: 401 });
      }
      throw err;
    }

    await ctx.runMutation(this.component.lib.handleEvent, {
      config: await this.runtimeConfig(),
      event,
    });

    return new Response(null, { status: 204 });
  }

  // ---- Internals -------------------------------------------------------

  private async runtimeConfig(): Promise<RuntimeConfig> {
    return {
      retryAttempts: this.config.retryAttempts,
      initialBackoffMs: this.config.initialBackoffMs,
      onEvent: this.onEvent
        ? { fnHandle: await createFunctionHandle(this.onEvent) }
        : undefined,
      onMessageReceived: this.onMessageReceived
        ? { fnHandle: await createFunctionHandle(this.onMessageReceived) }
        : undefined,
    };
  }

  private assertConfigured(mode: "send" | "webhook") {
    if (mode === "send" && !process.env.AGENTMAIL_API_KEY) {
      throw new Error(
        "AGENTMAIL_API_KEY is not set on the Convex deployment. Run " +
          "`npx convex env set AGENTMAIL_API_KEY <key>`.",
      );
    }
    if (mode === "webhook" && !this.config.webhookSecret) {
      throw new Error(
        "AGENTMAIL_WEBHOOK_SECRET is not set. Pass webhookSecret to the AgentMail constructor or set the env var.",
      );
    }
  }
}
