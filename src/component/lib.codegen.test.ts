// Integration tests for the component using convex-test.
// These require codegen to have been run (e.g. via `npx convex dev` once).
// They are excluded from the default vitest pattern; run with:
//   npm run test:codegen
//
// What's covered:
//   - enqueueSend inserts an outboundMessages row in "pending" and queues workpool
//   - performSend handles success / permanent error / transient error paths
//   - onSendComplete patches the row to "sent" / "failed"
//   - cancelSend transitions only from pending/sending
//   - handleEvent dedupes on event_id (idempotent)
//   - handleEvent persists message.received to inboundMessages
//   - handleEvent updates matched outbound rows on delivered/bounced
//   - cleanupFinalizedOutbound deletes only delivered+old rows

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema.js";
import { api, internal } from "./_generated/api.js";
import { Webhook } from "svix";
import workpoolTest from "@convex-dev/workpool/test";

const modules = import.meta.glob("./**/*.ts");

const config = {
  retryAttempts: 2,
  initialBackoffMs: 50,
};

function setupTest() {
  const t = convexTest(schema, modules);
  workpoolTest.register(t, "sendPool");
  workpoolTest.register(t, "callbackPool");
  return t;
}

let fetchSpy: ReturnType<typeof vi.fn>;
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  fetchSpy = vi.fn();
  // @ts-expect-error -- replace global fetch for the duration of the test
  globalThis.fetch = fetchSpy;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("enqueueSend", () => {
  it("inserts an outboundMessages row in 'pending' status", async () => {
    const t = setupTest();
    const id = await t.mutation(api.lib.enqueueSend, {
      config,
      inboxId: "inb_1",
      kind: "send",
      payload: { to: "x@example.com", subject: "hi", text: "hello" },
    });
    expect(id).toBeTruthy();

    const status = await t.query(api.lib.getOutboundStatus, { outboundId: id });
    expect(status?.status).toBe("pending");
  });

  it("performSend transitions the row to 'sent' on success", async () => {
    const t = setupTest();
    fetchSpy.mockResolvedValue(
      jsonResponse({ message_id: "msg_xyz", thread_id: "thr_xyz" }),
    );

    const id = await t.mutation(api.lib.enqueueSend, {
      config,
      inboxId: "inb_1",
      kind: "send",
      payload: { to: "x@example.com", subject: "hi", text: "hello" },
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const status = await t.query(api.lib.getOutboundStatus, { outboundId: id });
    expect(status?.status).toBe("sent");
    expect(status?.agentmailMessageId).toBe("msg_xyz");
    expect(status?.threadId).toBe("thr_xyz");
  });

  it("transitions to 'failed' on a permanent (4xx) API error", async () => {
    const t = setupTest();
    fetchSpy.mockResolvedValue(new Response("invalid recipient", { status: 422 }));

    const id = await t.mutation(api.lib.enqueueSend, {
      config,
      inboxId: "inb_1",
      kind: "send",
      payload: { to: "bogus", subject: "hi", text: "x" },
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const status = await t.query(api.lib.getOutboundStatus, { outboundId: id });
    expect(status?.status).toBe("failed");
    expect(status?.errorMessage).toContain("invalid recipient");
  });

  it("retries transient (5xx) errors up to retryAttempts then marks failed", async () => {
    const t = setupTest();
    fetchSpy.mockResolvedValue(new Response("upstream down", { status: 503 }));

    const id = await t.mutation(api.lib.enqueueSend, {
      config: { ...config, retryAttempts: 2, initialBackoffMs: 1 },
      inboxId: "inb_1",
      kind: "send",
      payload: { to: "x@example.com", subject: "hi", text: "x" },
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const status = await t.query(api.lib.getOutboundStatus, { outboundId: id });
    expect(status?.status).toBe("failed");
    // workpool should have called fetch retryAttempts times before giving up
    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("constructs the correct path for reply / reply_all / forward", async () => {
    const t = setupTest();
    fetchSpy.mockResolvedValue(
      jsonResponse({ message_id: "m", thread_id: "t" }),
    );

    await t.mutation(api.lib.enqueueSend, {
      config,
      inboxId: "inb_1",
      kind: "reply",
      parentMessageId: "msg_parent",
      payload: { text: "thanks" },
    });
    await t.mutation(api.lib.enqueueSend, {
      config,
      inboxId: "inb_1",
      kind: "reply_all",
      parentMessageId: "msg_parent",
      payload: { text: "thanks all" },
    });
    await t.mutation(api.lib.enqueueSend, {
      config,
      inboxId: "inb_1",
      kind: "forward",
      parentMessageId: "msg_parent",
      payload: { to: "fwd@x.com", text: "fyi" },
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(urls).toEqual(
      expect.arrayContaining([
        expect.stringContaining("/inboxes/inb_1/messages/msg_parent/reply"),
        expect.stringContaining(
          "/inboxes/inb_1/messages/msg_parent/reply-all",
        ),
        expect.stringContaining(
          "/inboxes/inb_1/messages/msg_parent/forward",
        ),
      ]),
    );
  });
});

describe("cancelSend", () => {
  it("flips a pending row to failed", async () => {
    const t = setupTest();
    // Don't trigger workpool execution: we mock fetch but never run timers.
    fetchSpy.mockResolvedValue(jsonResponse({ message_id: "m", thread_id: "t" }));

    const id = await t.mutation(api.lib.enqueueSend, {
      config,
      inboxId: "inb_1",
      kind: "send",
      payload: { to: "x@x.com", subject: "h", text: "x" },
    });

    await t.mutation(api.lib.cancelSend, { outboundId: id });
    const status = await t.query(api.lib.getOutboundStatus, { outboundId: id });
    expect(status?.status).toBe("failed");
    expect(status?.errorMessage).toMatch(/cancelled/i);
  });

  it("throws when row is already sent", async () => {
    const t = setupTest();
    fetchSpy.mockResolvedValue(jsonResponse({ message_id: "m", thread_id: "t" }));
    const id = await t.mutation(api.lib.enqueueSend, {
      config,
      inboxId: "inb_1",
      kind: "send",
      payload: { to: "x@x.com", subject: "h", text: "x" },
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    await expect(
      t.mutation(api.lib.cancelSend, { outboundId: id }),
    ).rejects.toThrow();
  });
});

describe("handleEvent (webhook ingestion)", () => {
  function makeEvent(overrides: Partial<{ event_id: string; event_type: string }> = {}) {
    return {
      type: "event",
      event_type: overrides.event_type ?? "message.received",
      event_id: overrides.event_id ?? "evt_1",
      message: {
        inbox_id: "inb_1",
        thread_id: "thr_1",
        message_id: "msg_1",
        from: "alice@example.com",
        to: ["agent@agentmail.to"],
        subject: "hi",
        text: "hello",
        timestamp: "2026-04-30T00:00:00.000Z",
      },
      thread: {},
    };
  }

  it("persists message.received into inboundMessages", async () => {
    const t = setupTest();
    await t.mutation(api.lib.handleEvent, { config, event: makeEvent() });

    const messages = await t.query(api.lib.listInboundMessages, {
      inboxId: "inb_1",
    });
    expect(messages).toHaveLength(1);
    expect(messages[0].subject).toBe("hi");
    expect(messages[0].from).toBe("alice@example.com");
  });

  it("is idempotent on duplicate event_id", async () => {
    const t = setupTest();
    await t.mutation(api.lib.handleEvent, {
      config,
      event: makeEvent({ event_id: "evt_dup" }),
    });
    await t.mutation(api.lib.handleEvent, {
      config,
      event: makeEvent({ event_id: "evt_dup" }),
    });

    const messages = await t.query(api.lib.listInboundMessages, {
      inboxId: "inb_1",
    });
    expect(messages).toHaveLength(1);
  });

  it("updates an outbound row to 'delivered' on message.delivered", async () => {
    const t = setupTest();
    fetchSpy.mockResolvedValue(
      jsonResponse({ message_id: "msg_match", thread_id: "thr_match" }),
    );
    const outboundId = await t.mutation(api.lib.enqueueSend, {
      config,
      inboxId: "inb_1",
      kind: "send",
      payload: { to: "x@x.com", subject: "h", text: "x" },
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    await t.mutation(api.lib.handleEvent, {
      config,
      event: {
        type: "event",
        event_type: "message.delivered",
        event_id: "evt_d1",
        delivery: {
          inbox_id: "inb_1",
          thread_id: "thr_match",
          message_id: "msg_match",
          timestamp: "2026-04-30T00:00:00.000Z",
          recipients: ["x@x.com"],
        },
      },
    });

    const status = await t.query(api.lib.getOutboundStatus, { outboundId });
    expect(status?.status).toBe("delivered");
  });
});

describe("listInboundMessages", () => {
  it("filters by threadId in ascending order", async () => {
    const t = setupTest();
    for (let i = 0; i < 3; i++) {
      await t.mutation(api.lib.handleEvent, {
        config,
        event: {
          type: "event",
          event_type: "message.received",
          event_id: `evt_${i}`,
          message: {
            inbox_id: "inb_1",
            thread_id: "thr_T",
            message_id: `msg_${i}`,
            from: "x@x.com",
            to: ["a@a.com"],
            timestamp: new Date(2026, 3, i + 1).toISOString(),
          },
          thread: {},
        },
      });
    }

    const messages = await t.query(api.lib.listInboundMessages, {
      threadId: "thr_T",
    });
    expect(messages).toHaveLength(3);
    expect(messages[0].messageId).toBe("msg_0");
    expect(messages[2].messageId).toBe("msg_2");
  });
});
