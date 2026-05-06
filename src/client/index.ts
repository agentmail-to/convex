import {
  createFunctionHandle,
  type FunctionReference,
  type FunctionVisibility,
} from "convex/server";
import { v, type VString } from "convex/values";
import {
  type AgentMailEvent,
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

export type AgentMailComponent = ComponentApi;

export type OutboundId = string & { __isOutboundId: true };
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

const DEFAULT_BASE_URL = "https://api.agentmail.to/v0";

type Config = RuntimeConfig & {
  webhookSecret: string;
};

function getDefaultConfig(): Config {
  return {
    apiKey: process.env.AGENTMAIL_API_KEY ?? "",
    baseUrl: process.env.AGENTMAIL_BASE_URL ?? DEFAULT_BASE_URL,
    webhookSecret: process.env.AGENTMAIL_WEBHOOK_SECRET ?? "",
    initialBackoffMs: 30_000,
    retryAttempts: 5,
  };
}

export type AgentMailOptions = {
  /** API key. Falls back to AGENTMAIL_API_KEY. */
  apiKey?: string;
  /** Override base URL (e.g. https://api.agentmail.eu/v0). Falls back to AGENTMAIL_BASE_URL. */
  baseUrl?: string;
  /** Svix webhook secret. Falls back to AGENTMAIL_WEBHOOK_SECRET. */
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
    const defaults = getDefaultConfig();
    this.config = {
      apiKey: options?.apiKey ?? defaults.apiKey,
      baseUrl: options?.baseUrl ?? defaults.baseUrl,
      webhookSecret: options?.webhookSecret ?? defaults.webhookSecret,
      initialBackoffMs:
        options?.initialBackoffMs ?? defaults.initialBackoffMs,
      retryAttempts: options?.retryAttempts ?? defaults.retryAttempts,
    };
    this.onEvent = options?.onEvent ?? undefined;
    this.onMessageReceived = options?.onMessageReceived ?? undefined;
  }

  // ---- Inboxes ---------------------------------------------------------

  async createInbox(
    ctx: { runAction: any },
    request: {
      username?: string;
      domain?: string;
      displayName?: string;
      clientId?: string;
    } = {},
  ) {
    return await ctx.runAction(this.component.lib.createInbox, {
      config: await this.runtimeConfig(),
      request: {
        username: request.username,
        domain: request.domain,
        display_name: request.displayName,
        client_id: request.clientId,
      },
    });
  }

  async listInboxes(
    ctx: { runAction: any },
    args: { limit?: number; pageToken?: string; ascending?: boolean } = {},
  ) {
    return await ctx.runAction(this.component.lib.listInboxes, {
      config: await this.runtimeConfig(),
      limit: args.limit,
      page_token: args.pageToken,
      ascending: args.ascending,
    });
  }

  async getInbox(ctx: { runAction: any }, inboxId: string) {
    return await ctx.runAction(this.component.lib.getInboxRemote, {
      config: await this.runtimeConfig(),
      inboxId,
    });
  }

  async deleteInbox(ctx: { runAction: any }, inboxId: string) {
    return await ctx.runAction(this.component.lib.deleteInbox, {
      config: await this.runtimeConfig(),
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
    this.assertConfigured();
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
    this.assertConfigured();
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
    this.assertConfigured();
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
    ctx: { runAction: any },
    inboxId: string,
    args: { limit?: number; pageToken?: string; labels?: string[] } = {},
  ) {
    return await ctx.runAction(this.component.lib.listThreads, {
      config: await this.runtimeConfig(),
      inboxId,
      limit: args.limit,
      page_token: args.pageToken,
      labels: args.labels,
    });
  }

  async getThread(
    ctx: { runAction: any },
    inboxId: string,
    threadId: string,
  ) {
    return await ctx.runAction(this.component.lib.getThread, {
      config: await this.runtimeConfig(),
      inboxId,
      threadId,
    });
  }

  async getMessage(
    ctx: { runAction: any },
    inboxId: string,
    messageId: string,
  ) {
    return await ctx.runAction(this.component.lib.getMessage, {
      config: await this.runtimeConfig(),
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
    if (!this.config.webhookSecret) {
      throw new Error(
        "AGENTMAIL_WEBHOOK_SECRET is not set; cannot verify webhook",
      );
    }
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
      apiKey: this.config.apiKey,
      baseUrl: this.config.baseUrl,
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

  private assertConfigured() {
    if (!this.config.apiKey) {
      throw new Error(
        "AGENTMAIL_API_KEY is not set. Pass apiKey to the AgentMail constructor or set the env var.",
      );
    }
  }
}
