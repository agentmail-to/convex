/* eslint-disable */
/**
 * `ComponentApi` for @agentmail/convex.
 *
 * Hand-authored to mirror the public surface of src/component/lib.ts.
 *
 * Convex's `convex codegen --component-dir` does not reliably produce this
 * file in 1.37+ (esbuild can't resolve the virtual convex.config.js path),
 * so we ship it ourselves alongside the auto-generated api/server/dataModel
 * declarations. Keep this declaration in sync with lib.ts when adding or
 * changing exposed functions.
 * @module
 */
import type { FunctionReference } from "convex/server";
import type { GenericId } from "convex/values";
import type {
  AgentMailEvent,
  OutboundStatus,
  RuntimeConfig,
  SendKind,
  SendPayload,
} from "../shared.js";

export type ComponentApi<
  Name extends string | undefined = string | undefined,
> = {
  lib: {
    // ---- Inboxes (remote actions; cache locally as a side-effect) -----
    createInbox: FunctionReference<
      "action",
      "internal",
      {
        config: RuntimeConfig;
        request: {
          username?: string;
          domain?: string;
          display_name?: string;
          client_id?: string;
        };
      },
      any,
      Name
    >;
    listInboxes: FunctionReference<
      "action",
      "internal",
      {
        config: RuntimeConfig;
        limit?: number;
        page_token?: string;
        ascending?: boolean;
      },
      any,
      Name
    >;
    getInboxRemote: FunctionReference<
      "action",
      "internal",
      { config: RuntimeConfig; inboxId: string },
      any,
      Name
    >;
    deleteInbox: FunctionReference<
      "action",
      "internal",
      { config: RuntimeConfig; inboxId: string },
      null,
      Name
    >;
    listCachedInboxes: FunctionReference<"query", "public", {}, any, Name>;
    getCachedInbox: FunctionReference<
      "query",
      "public",
      { inboxId: string },
      any,
      Name
    >;

    // ---- Sending lifecycle ---------------------------------------------
    enqueueSend: FunctionReference<
      "mutation",
      "public",
      {
        config: RuntimeConfig;
        inboxId: string;
        kind: SendKind;
        parentMessageId?: string;
        payload: SendPayload;
      },
      GenericId<"outboundMessages">,
      Name
    >;
    cancelSend: FunctionReference<
      "mutation",
      "public",
      { outboundId: GenericId<"outboundMessages"> },
      null,
      Name
    >;
    getOutboundStatus: FunctionReference<
      "query",
      "public",
      { outboundId: GenericId<"outboundMessages"> },
      {
        status: OutboundStatus;
        agentmailMessageId: string | null;
        threadId: string | null;
        errorMessage: string | null;
      } | null,
      Name
    >;

    // ---- Threads / messages (remote reads + local mirror) --------------
    listThreads: FunctionReference<
      "action",
      "internal",
      {
        config: RuntimeConfig;
        inboxId: string;
        limit?: number;
        page_token?: string;
        labels?: string[];
        before?: string;
        after?: string;
      },
      any,
      Name
    >;
    getThread: FunctionReference<
      "action",
      "internal",
      { config: RuntimeConfig; inboxId: string; threadId: string },
      any,
      Name
    >;
    getMessage: FunctionReference<
      "action",
      "internal",
      { config: RuntimeConfig; inboxId: string; messageId: string },
      any,
      Name
    >;
    listInboundMessages: FunctionReference<
      "query",
      "public",
      { inboxId?: string; threadId?: string },
      Array<any>,
      Name
    >;

    // ---- Webhook ingestion ---------------------------------------------
    handleEvent: FunctionReference<
      "mutation",
      "public",
      { config: RuntimeConfig; event: AgentMailEvent },
      null,
      Name
    >;

    // ---- Maintenance ---------------------------------------------------
    cleanupFinalizedOutbound: FunctionReference<
      "mutation",
      "public",
      { olderThan?: number },
      null,
      Name
    >;
  };
};
