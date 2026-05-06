import { describe, expect, it } from "vitest";
import schema from "./schema.js";

describe("component schema", () => {
  it("declares all expected tables", () => {
    expect(Object.keys(schema.tables).sort()).toEqual([
      "events",
      "inboundMessages",
      "inboxes",
      "outboundMessages",
    ]);
  });

  it("outboundMessages indexes by status and by agentmailMessageId", () => {
    const t = schema.tables.outboundMessages;
    const indexNames = t.indexes.map((i: { indexDescriptor: string }) => i.indexDescriptor);
    expect(indexNames).toContain("by_status");
    expect(indexNames).toContain("by_agentmailMessageId");
  });

  it("inboundMessages indexes for fast inbox + thread lookups", () => {
    const t = schema.tables.inboundMessages;
    const indexNames = t.indexes.map((i: { indexDescriptor: string }) => i.indexDescriptor);
    expect(indexNames).toContain("by_inbox");
    expect(indexNames).toContain("by_thread");
    expect(indexNames).toContain("by_messageId");
  });

  it("events indexes by eventId for idempotency", () => {
    const t = schema.tables.events;
    const indexNames = t.indexes.map((i: { indexDescriptor: string }) => i.indexDescriptor);
    expect(indexNames).toContain("by_eventId");
  });

  it("inboxes index by remote inboxId for cache lookups", () => {
    const t = schema.tables.inboxes;
    const indexNames = t.indexes.map((i: { indexDescriptor: string }) => i.indexDescriptor);
    expect(indexNames).toContain("by_inboxId");
  });
});
