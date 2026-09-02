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
      { inboxId: string },
      any,
      Name
    >;
    deleteInbox: FunctionReference<
      "action",
      "internal",
      { inboxId: string },
      null,
      Name
    >;
    listCachedInboxes: FunctionReference<"query", "internal", {}, any, Name>;
    getCachedInbox: FunctionReference<
      "query",
      "internal",
      { inboxId: string },
      any,
      Name
    >;

    // ---- Sending lifecycle ---------------------------------------------
    enqueueSend: FunctionReference<
      "mutation",
      "internal",
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
      "internal",
      { outboundId: GenericId<"outboundMessages"> },
      null,
      Name
    >;
    getOutboundStatus: FunctionReference<
      "query",
      "internal",
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
      { inboxId: string; threadId: string },
      any,
      Name
    >;
    getMessage: FunctionReference<
      "action",
      "internal",
      { inboxId: string; messageId: string },
      any,
      Name
    >;
    listInboundMessages: FunctionReference<
      "query",
      "internal",
      { inboxId?: string; threadId?: string },
      Array<any>,
      Name
    >;

    // ---- Webhook ingestion ---------------------------------------------
    handleEvent: FunctionReference<
      "mutation",
      "internal",
      { config: RuntimeConfig; event: AgentMailEvent },
      null,
      Name
    >;

    // ---- Maintenance ---------------------------------------------------
    cleanupFinalizedOutbound: FunctionReference<
      "mutation",
      "internal",
      { olderThan?: number },
      null,
      Name
    >;
  };
};
