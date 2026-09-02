import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as lib from "../component/lib.js";
import type { ComponentApi } from "../component/_generated/component.js";
import type {
  RunActionCtx,
  RunMutationCtx,
  RunQueryCtx,
} from "../component/shared.js";
import { AgentMail } from "./index.js";

// The client hands component function references to ctx.run*, and the
// mounting app can only resolve the ones registered public: an internal one
// fails at the consumer's deployment with "Couldn't resolve
// agentmail.lib.<fn>", and neither tsc nor convex-test notices. The type-level
// guard at the end of component/lib.ts covers the build; this pins the same
// rule, plus the method-to-function wiring, on the path `npm test` runs.

type Ctx = RunActionCtx & RunMutationCtx & RunQueryCtx;
type Registered = { isPublic?: boolean };

function recordingCtx() {
  const refs: unknown[] = [];
  const record = async (ref: unknown) => {
    refs.push(ref);
    return "outbound_1";
  };
  const ctx = {
    runAction: record,
    runMutation: record,
    runQuery: record,
  } as unknown as Ctx;
  return { ctx, refs };
}

const agentmail = new AgentMail({ lib } as unknown as ComponentApi);
const outboundId = "outbound_1" as Parameters<typeof agentmail.cancel>[1];
const send = { to: ["someone@example.com"], subject: "hi", text: "hello" };

const calls: Array<[string, (ctx: Ctx) => Promise<unknown>, keyof typeof lib]> = [
  ["createInbox", (ctx) => agentmail.createInbox(ctx), "createInbox"],
  ["listInboxes", (ctx) => agentmail.listInboxes(ctx), "listInboxes"],
  ["getInbox", (ctx) => agentmail.getInbox(ctx, "inbox_1"), "getInboxRemote"],
  ["deleteInbox", (ctx) => agentmail.deleteInbox(ctx, "inbox_1"), "deleteInbox"],
  ["sendMessage", (ctx) => agentmail.sendMessage(ctx, "inbox_1", send), "enqueueSend"],
  ["replyToMessage", (ctx) => agentmail.replyToMessage(ctx, "inbox_1", "msg_1", send), "enqueueSend"],
  ["forwardMessage", (ctx) => agentmail.forwardMessage(ctx, "inbox_1", "msg_1", send), "enqueueSend"],
  ["cancel", (ctx) => agentmail.cancel(ctx, outboundId), "cancelSend"],
  ["status", (ctx) => agentmail.status(ctx, outboundId), "getOutboundStatus"],
  ["listThreads", (ctx) => agentmail.listThreads(ctx, "inbox_1"), "listThreads"],
  ["getThread", (ctx) => agentmail.getThread(ctx, "inbox_1", "thr_1"), "getThread"],
  ["getMessage", (ctx) => agentmail.getMessage(ctx, "inbox_1", "msg_1"), "getMessage"],
];

describe("AgentMail client -> component calls", () => {
  let originalApiKey: string | undefined;
  beforeEach(() => {
    originalApiKey = process.env.AGENTMAIL_API_KEY;
    process.env.AGENTMAIL_API_KEY = "test-key";
  });
  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.AGENTMAIL_API_KEY;
    else process.env.AGENTMAIL_API_KEY = originalApiKey;
  });

  it.each(calls)("%s runs a public component function", async (_name, call, fn) => {
    const { ctx, refs } = recordingCtx();
    await call(ctx);
    expect(refs).toHaveLength(1);
    expect(refs[0], `wired to lib.${fn}`).toBe(lib[fn]);
    expect((refs[0] as Registered).isPublic, `lib.${fn} is internal; the app cannot call it`).toBe(true);
  });
});
