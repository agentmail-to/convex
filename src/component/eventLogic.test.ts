import { describe, expect, it } from "vitest";
import {
  extractIndexFields,
  isTerminalStatus,
  mapEventToOutboundStatus,
  sendPath,
} from "./eventLogic.js";
import type { AgentMailEvent } from "./shared.js";

describe("sendPath", () => {
  it("builds the send path", () => {
    expect(sendPath("inb_1", "send")).toBe("/inboxes/inb_1/messages/send");
  });

  it("builds reply / reply_all / forward paths with parentMessageId", () => {
    expect(sendPath("inb_1", "reply", "msg_p")).toBe(
      "/inboxes/inb_1/messages/msg_p/reply",
    );
    expect(sendPath("inb_1", "reply_all", "msg_p")).toBe(
      "/inboxes/inb_1/messages/msg_p/reply-all",
    );
    expect(sendPath("inb_1", "forward", "msg_p")).toBe(
      "/inboxes/inb_1/messages/msg_p/forward",
    );
  });

  it("throws when reply/reply_all/forward miss a parent message id", () => {
    expect(() => sendPath("inb_1", "reply")).toThrow(/parentMessageId/);
    expect(() => sendPath("inb_1", "reply_all")).toThrow(/parentMessageId/);
    expect(() => sendPath("inb_1", "forward")).toThrow(/parentMessageId/);
  });

  it("does not require parentMessageId for plain send", () => {
    expect(() => sendPath("inb_1", "send")).not.toThrow();
  });
});

describe("extractIndexFields", () => {
  function event(partial: Partial<AgentMailEvent>): AgentMailEvent {
    return {
      type: "event",
      event_type: "message.received",
      event_id: "evt_x",
      ...partial,
    } as AgentMailEvent;
  }

  it("pulls fields from message.received payload", () => {
    expect(
      extractIndexFields(
        event({
          event_type: "message.received",
          message: {
            inbox_id: "inb_1",
            thread_id: "thr_1",
            message_id: "msg_1",
          },
        }),
      ),
    ).toEqual({ inboxId: "inb_1", threadId: "thr_1", messageId: "msg_1" });
  });

  it("falls through to send for message.sent events", () => {
    expect(
      extractIndexFields(
        event({
          event_type: "message.sent",
          send: {
            inbox_id: "inb_2",
            thread_id: "thr_2",
            message_id: "msg_2",
          },
        }),
      ),
    ).toEqual({ inboxId: "inb_2", threadId: "thr_2", messageId: "msg_2" });
  });

  it("uses delivery payload for message.delivered", () => {
    expect(
      extractIndexFields(
        event({
          event_type: "message.delivered",
          delivery: {
            inbox_id: "inb_3",
            thread_id: "thr_3",
            message_id: "msg_3",
          },
        }),
      ),
    ).toEqual({ inboxId: "inb_3", threadId: "thr_3", messageId: "msg_3" });
  });

  it("uses bounce payload for message.bounced", () => {
    expect(
      extractIndexFields(
        event({
          event_type: "message.bounced",
          bounce: {
            inbox_id: "inb_b",
            thread_id: "thr_b",
            message_id: "msg_b",
          },
        }),
      ),
    ).toEqual({ inboxId: "inb_b", threadId: "thr_b", messageId: "msg_b" });
  });

  it("returns all-undefined when event has no payload sub-object", () => {
    expect(extractIndexFields(event({ event_type: "domain.verified" }))).toEqual(
      { inboxId: undefined, threadId: undefined, messageId: undefined },
    );
  });

  it("prefers message over send (message.received with both fields)", () => {
    expect(
      extractIndexFields(
        event({
          event_type: "message.received",
          message: { inbox_id: "from_msg", thread_id: "x", message_id: "x" },
          send: { inbox_id: "from_send", thread_id: "x", message_id: "x" },
        }),
      ).inboxId,
    ).toBe("from_msg");
  });
});

describe("mapEventToOutboundStatus", () => {
  it("maps each lifecycle event to its outbound status", () => {
    expect(mapEventToOutboundStatus("message.sent")).toBe("sent");
    expect(mapEventToOutboundStatus("message.delivered")).toBe("delivered");
    expect(mapEventToOutboundStatus("message.bounced")).toBe("bounced");
    expect(mapEventToOutboundStatus("message.complained")).toBe("complained");
    expect(mapEventToOutboundStatus("message.rejected")).toBe("rejected");
  });

  it("returns undefined for events that do not update outbound state", () => {
    expect(mapEventToOutboundStatus("message.received")).toBeUndefined();
    expect(mapEventToOutboundStatus("domain.verified")).toBeUndefined();
  });
});

describe("isTerminalStatus", () => {
  it.each([
    "delivered",
    "bounced",
    "complained",
    "rejected",
    "failed",
  ] as const)("treats %s as terminal", (status) => {
    expect(isTerminalStatus(status)).toBe(true);
  });

  it.each(["pending", "sent"] as const)(
    "treats %s as non-terminal",
    (status) => {
      expect(isTerminalStatus(status)).toBe(false);
    },
  );
});
