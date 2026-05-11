import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentMailApiError,
  agentmailFetch,
  parseTimestamp,
  stripUndefined,
} from "./utils.js";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("stripUndefined", () => {
  it("removes top-level undefined fields", () => {
    expect(stripUndefined({ a: 1, b: undefined, c: "x" })).toEqual({
      a: 1,
      c: "x",
    });
  });

  it("recurses into nested objects", () => {
    const input = { a: { b: undefined, c: 2, d: { e: undefined, f: 3 } } };
    expect(stripUndefined(input)).toEqual({ a: { c: 2, d: { f: 3 } } });
  });

  it("preserves explicit nulls", () => {
    expect(stripUndefined({ a: null, b: undefined })).toEqual({ a: null });
  });

  it("recurses into arrays", () => {
    expect(
      stripUndefined({ arr: [{ x: 1, y: undefined }, { z: 2 }] }),
    ).toEqual({ arr: [{ x: 1 }, { z: 2 }] });
  });

  it("returns primitives unchanged", () => {
    expect(stripUndefined(5)).toBe(5);
    expect(stripUndefined("hi")).toBe("hi");
    expect(stripUndefined(null)).toBe(null);
  });

  it("does not mutate the input", () => {
    const input = { a: 1, b: undefined };
    const out = stripUndefined(input);
    expect(input).toEqual({ a: 1, b: undefined });
    expect(out).not.toBe(input);
  });
});

describe("AgentMailApiError", () => {
  it("flags 4xx codes as permanent", () => {
    const err = new AgentMailApiError(404, "not found", true);
    expect(err.permanent).toBe(true);
    expect(err.status).toBe(404);
    expect(err.body).toBe("not found");
    expect(err.name).toBe("AgentMailApiError");
  });

  it("can be a transient error", () => {
    const err = new AgentMailApiError(503, "unavailable", false);
    expect(err.permanent).toBe(false);
  });
});

describe("parseTimestamp", () => {
  it("returns the parsed ms for valid ISO timestamps", () => {
    expect(parseTimestamp("2026-04-30T00:00:00.000Z")).toBe(
      Date.parse("2026-04-30T00:00:00.000Z"),
    );
  });

  it("falls back to Date.now() on malformed input", () => {
    const before = Date.now();
    const got = parseTimestamp("not a date");
    const after = Date.now();
    expect(got).toBeGreaterThanOrEqual(before);
    expect(got).toBeLessThanOrEqual(after);
  });
});

describe("agentmailFetch", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let originalFetch: typeof globalThis.fetch;
  let originalApiKey: string | undefined;
  let originalBaseUrl: string | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchSpy = vi.fn();
    // @ts-expect-error -- replacing global for tests
    globalThis.fetch = fetchSpy;
    originalApiKey = process.env.AGENTMAIL_API_KEY;
    originalBaseUrl = process.env.AGENTMAIL_BASE_URL;
    process.env.AGENTMAIL_API_KEY = "test-key";
    delete process.env.AGENTMAIL_BASE_URL;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.AGENTMAIL_API_KEY;
    else process.env.AGENTMAIL_API_KEY = originalApiKey;
    if (originalBaseUrl === undefined) delete process.env.AGENTMAIL_BASE_URL;
    else process.env.AGENTMAIL_BASE_URL = originalBaseUrl;
  });

  it("throws when api key is missing", async () => {
    delete process.env.AGENTMAIL_API_KEY;
    await expect(
      agentmailFetch("/inboxes", { method: "GET" }),
    ).rejects.toThrow(/AGENTMAIL_API_KEY is not set/);
  });

  it("sends Bearer auth and JSON content-type for body requests", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ message_id: "m1", thread_id: "t1" }));

    const result = await agentmailFetch("/inboxes/inb_1/messages/send", {
      method: "POST",
      body: { to: "x@example.com", subject: "hi", text: "hello" },
    });

    expect(result).toEqual({ message_id: "m1", thread_id: "t1" });
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe(
      "https://api.agentmail.to/v0/inboxes/inb_1/messages/send",
    );
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer test-key");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({
      to: "x@example.com",
      subject: "hi",
      text: "hello",
    });
  });

  it("strips undefined fields from request body", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({}));
    await agentmailFetch("/x", {
      method: "POST",
      body: { a: 1, b: undefined, c: { d: undefined, e: "y" } },
    });
    const [, init] = fetchSpy.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ a: 1, c: { e: "y" } });
  });

  it("does not send Content-Type or body on GET", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ count: 0, inboxes: [] }));
    await agentmailFetch("/inboxes", { method: "GET" });
    const [, init] = fetchSpy.mock.calls[0];
    expect(init.body).toBeUndefined();
    expect(init.headers["Content-Type"]).toBeUndefined();
    expect(init.headers.Authorization).toBe("Bearer test-key");
  });

  it("appends query parameters and skips undefined/null values", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ count: 0, threads: [] }));
    await agentmailFetch("/inboxes/inb/threads", {
      method: "GET",
      query: {
        limit: 50,
        page_token: undefined,
        ascending: true,
        labels: null,
      },
    });
    const [url] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe(
      "https://api.agentmail.to/v0/inboxes/inb/threads?limit=50&ascending=true",
    );
  });

  it("trims trailing slash on AGENTMAIL_BASE_URL", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({}));
    process.env.AGENTMAIL_BASE_URL = "https://api.agentmail.to/v0/";
    await agentmailFetch("/inboxes", { method: "GET" });
    const [url] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("https://api.agentmail.to/v0/inboxes");
  });

  it("returns null on 204 No Content", async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 204 }));
    const result = await agentmailFetch("/inboxes/inb", { method: "DELETE" });
    expect(result).toBeNull();
  });

  it("returns null when content-type is not JSON", async () => {
    fetchSpy.mockResolvedValue(
      new Response("hello", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    );
    const result = await agentmailFetch("/x", { method: "GET" });
    expect(result).toBeNull();
  });

  it("throws AgentMailApiError with permanent=true on 4xx", async () => {
    fetchSpy.mockResolvedValue(
      new Response("validation failed", { status: 422 }),
    );
    await expect(
      agentmailFetch("/inboxes", { method: "POST", body: {} }),
    ).rejects.toMatchObject({
      name: "AgentMailApiError",
      status: 422,
      permanent: true,
      body: "validation failed",
    });
  });

  it("throws AgentMailApiError with permanent=false on 5xx", async () => {
    fetchSpy.mockResolvedValue(
      new Response("upstream timeout", { status: 503 }),
    );
    await expect(
      agentmailFetch("/inboxes", { method: "GET" }),
    ).rejects.toMatchObject({
      name: "AgentMailApiError",
      status: 503,
      permanent: false,
    });
  });

  it("treats 401 as permanent (bad credentials)", async () => {
    fetchSpy.mockResolvedValue(new Response("unauthorized", { status: 401 }));
    await expect(
      agentmailFetch("/inboxes", { method: "GET" }),
    ).rejects.toMatchObject({ status: 401, permanent: true });
  });

  it("treats 429 as transient (retryable)", async () => {
    fetchSpy.mockResolvedValue(
      new Response("rate limited", { status: 429 }),
    );
    await expect(
      agentmailFetch("/inboxes", { method: "GET" }),
    ).rejects.toMatchObject({ status: 429, permanent: false });
  });

  it("uses AGENTMAIL_BASE_URL override (e.g. EU region)", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({}));
    process.env.AGENTMAIL_BASE_URL = "https://api.agentmail.eu/v0";
    await agentmailFetch("/inboxes", { method: "GET" });
    const [url] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("https://api.agentmail.eu/v0/inboxes");
  });

  it("truncates oversized error bodies to ~4kB", async () => {
    const huge = "x".repeat(8000);
    fetchSpy.mockResolvedValue(
      new Response(huge, { status: 502 }),
    );
    try {
      await agentmailFetch("/x", { method: "GET" });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AgentMailApiError);
      const apiErr = err as AgentMailApiError;
      expect(apiErr.body.length).toBeLessThanOrEqual(4096 + 20);
      expect(apiErr.body).toMatch(/\.\.\. \[truncated\]$/);
    }
  });
});
