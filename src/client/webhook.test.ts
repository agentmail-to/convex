import { describe, expect, it } from "vitest";
import { Webhook } from "svix";
import {
  verifyAgentMailWebhook,
  WebhookVerificationError,
} from "./webhook.js";

const SECRET = "whsec_" + Buffer.from("super-secret-key-1234567890").toString("base64");

function signedFixture(
  payload: object = sampleEvent(),
  overrides: Partial<{ secret: string; messageId: string; timestamp: number }> = {},
) {
  const wh = new Webhook(overrides.secret ?? SECRET);
  const messageId = overrides.messageId ?? `msg_${Math.random().toString(36).slice(2)}`;
  const timestamp = overrides.timestamp ?? Math.floor(Date.now() / 1000);
  const raw = JSON.stringify(payload);
  const signature = wh.sign(messageId, new Date(timestamp * 1000), raw);
  return {
    raw,
    headers: {
      "svix-id": messageId,
      "svix-timestamp": String(timestamp),
      "svix-signature": signature,
    },
    payload,
  };
}

function sampleEvent() {
  return {
    type: "event",
    event_type: "message.received",
    event_id: "evt_abc123",
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
    thread: {
      inbox_id: "inb_1",
      thread_id: "thr_1",
      labels: [],
      timestamp: "2026-04-30T00:00:00.000Z",
      senders: ["alice@example.com"],
      recipients: ["agent@agentmail.to"],
      last_message_id: "msg_1",
      message_count: 1,
      size: 100,
      updated_at: "2026-04-30T00:00:00.000Z",
      created_at: "2026-04-30T00:00:00.000Z",
    },
  };
}

describe("verifyAgentMailWebhook", () => {
  it("verifies a correctly signed payload and returns the parsed event", () => {
    const { raw, headers, payload } = signedFixture();
    const event = verifyAgentMailWebhook(SECRET, raw, headers);
    expect(event).toEqual(payload);
    expect(event.event_type).toBe("message.received");
  });

  it("throws WebhookVerificationError on a tampered payload", () => {
    const { headers } = signedFixture();
    const tampered = JSON.stringify({
      type: "event",
      event_type: "message.received",
      event_id: "evt_INJECTED",
    });
    expect(() => verifyAgentMailWebhook(SECRET, tampered, headers)).toThrow(
      WebhookVerificationError,
    );
  });

  it("throws WebhookVerificationError on a wrong secret", () => {
    const { raw, headers } = signedFixture();
    const otherSecret =
      "whsec_" + Buffer.from("another-secret-different-key-789").toString("base64");
    expect(() => verifyAgentMailWebhook(otherSecret, raw, headers)).toThrow(
      WebhookVerificationError,
    );
  });

  it("throws WebhookVerificationError when secret is empty", () => {
    const { raw, headers } = signedFixture();
    expect(() => verifyAgentMailWebhook("", raw, headers)).toThrow(
      /Webhook secret is empty/,
    );
  });

  it("throws WebhookVerificationError when svix-id header is missing", () => {
    const { raw, headers } = signedFixture();
    expect(() =>
      verifyAgentMailWebhook(SECRET, raw, { ...headers, "svix-id": "" }),
    ).toThrow(/Missing required svix headers/);
  });

  it("throws WebhookVerificationError when svix-signature is missing", () => {
    const { raw, headers } = signedFixture();
    expect(() =>
      verifyAgentMailWebhook(SECRET, raw, { ...headers, "svix-signature": "" }),
    ).toThrow(/Missing required svix headers/);
  });

  it("throws WebhookVerificationError when svix-timestamp is missing", () => {
    const { raw, headers } = signedFixture();
    expect(() =>
      verifyAgentMailWebhook(SECRET, raw, { ...headers, "svix-timestamp": "" }),
    ).toThrow(/Missing required svix headers/);
  });

  it("rejects timestamps outside the svix tolerance window", () => {
    const { raw, headers } = signedFixture(sampleEvent(), {
      timestamp: Math.floor(Date.now() / 1000) - 60 * 60, // 1 hour old
    });
    expect(() => verifyAgentMailWebhook(SECRET, raw, headers)).toThrow(
      WebhookVerificationError,
    );
  });

  it("accepts message.sent / message.delivered / message.bounced events", () => {
    for (const event_type of [
      "message.sent",
      "message.delivered",
      "message.bounced",
    ]) {
      const { raw, headers } = signedFixture({
        type: "event",
        event_type,
        event_id: `evt_${event_type}`,
      });
      const event = verifyAgentMailWebhook(SECRET, raw, headers);
      expect(event.event_type).toBe(event_type);
    }
  });

  it("treats null/undefined headers as missing", () => {
    const { raw } = signedFixture();
    expect(() =>
      verifyAgentMailWebhook(SECRET, raw, {
        "svix-id": null,
        "svix-timestamp": undefined,
        "svix-signature": "sig",
      }),
    ).toThrow(/Missing required svix headers/);
  });
});
