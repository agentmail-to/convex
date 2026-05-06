import { describe, expect, it } from "vitest";
import { toSendPayload, type ForwardArgs } from "./payload.js";

describe("toSendPayload", () => {
  it("converts camelCase to snake_case for reply_to", () => {
    const out = toSendPayload({
      to: "x@example.com",
      subject: "hi",
      text: "hello",
      replyTo: "noreply@x.com",
    });
    expect(out.reply_to).toBe("noreply@x.com");
    expect(out).not.toHaveProperty("replyTo");
  });

  it("preserves arrays for to/cc/bcc", () => {
    const out = toSendPayload({
      to: ["a@x.com", "b@x.com"],
      cc: ["c@x.com"],
      bcc: ["d@x.com"],
      subject: "hi",
      text: "x",
    });
    expect(out.to).toEqual(["a@x.com", "b@x.com"]);
    expect(out.cc).toEqual(["c@x.com"]);
    expect(out.bcc).toEqual(["d@x.com"]);
  });

  it("forwards labels, headers, and attachments and maps contentType to content_type", () => {
    const out = toSendPayload({
      to: "x@example.com",
      subject: "hi",
      text: "x",
      labels: ["urgent", "agent"],
      headers: { "X-Trace-Id": "abc" },
      attachments: [
        { filename: "doc.pdf", content: "base64data", contentType: "application/pdf" },
      ],
    });
    expect(out.labels).toEqual(["urgent", "agent"]);
    expect(out.headers).toEqual({ "X-Trace-Id": "abc" });
    expect(out.attachments).toHaveLength(1);
    expect(out.attachments![0]).toMatchObject({
      filename: "doc.pdf",
      content_type: "application/pdf",
    });
    // ensure the camelCase key did not leak through
    expect(out.attachments![0]).not.toHaveProperty("contentType");
  });

  it("emits reply_all=true when replyAll is true", () => {
    const out = toSendPayload({
      replyAll: true,
      text: "thanks",
    });
    expect(out.reply_all).toBe(true);
  });

  it("emits reply_all=false when explicitly false (not undefined)", () => {
    const out = toSendPayload({
      replyAll: false,
      text: "thanks",
    });
    expect(out.reply_all).toBe(false);
  });

  it("omits reply_all when replyAll is not specified", () => {
    const out = toSendPayload({
      to: "x@example.com",
      subject: "hi",
      text: "x",
    });
    expect(out.reply_all).toBeUndefined();
  });

  it("treats explicit replyAll=undefined the same as omission", () => {
    const out = toSendPayload({
      replyAll: undefined,
      text: "thanks",
    });
    expect(out.reply_all).toBeUndefined();
  });

  it("never leaks camelCase keys (replyTo/replyAll) through to the payload", () => {
    const out = toSendPayload({
      to: "x@example.com",
      subject: "hi",
      text: "x",
      replyTo: "rt@x.com",
      replyAll: true,
    } as ForwardArgs & { replyAll: boolean });
    expect(out).not.toHaveProperty("replyTo");
    expect(out).not.toHaveProperty("replyAll");
  });

  it("supports html-only sends without text", () => {
    const out = toSendPayload({
      to: "x@example.com",
      subject: "hi",
      html: "<p>hello</p>",
    });
    expect(out.html).toBe("<p>hello</p>");
    expect(out.text).toBeUndefined();
  });

  it("preserves both text and html when provided", () => {
    const out = toSendPayload({
      to: "x@example.com",
      subject: "hi",
      text: "plain",
      html: "<p>rich</p>",
    });
    expect(out.text).toBe("plain");
    expect(out.html).toBe("<p>rich</p>");
  });

  it("accepts ForwardArgs (alias of SendArgs) without losing fields", () => {
    const args: ForwardArgs = {
      to: ["forward@x.com"],
      subject: "Fwd: hi",
      text: "see below",
    };
    const out = toSendPayload(args);
    expect(out.to).toEqual(["forward@x.com"]);
    expect(out.subject).toBe("Fwd: hi");
    expect(out.text).toBe("see below");
  });
});
