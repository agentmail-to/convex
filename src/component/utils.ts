import type { RuntimeConfig } from "./shared.js";

const PERMANENT_STATUSES = new Set([
  400, 401, 404, 405, 410, 413, 414, 415, 422,
]);

// Cap stored error bodies so a CDN's HTML 502 page can't balloon a
// Convex document.
const ERROR_BODY_LIMIT = 4096;

/**
 * Parse an ISO timestamp into ms-since-epoch. Returns `Date.now()` on
 * malformed input — `Date.parse` returns `NaN` for bad strings, and `NaN`
 * passes `v.number()` validation, so unguarded calls would silently store
 * `NaN` in the database.
 */
export function parseTimestamp(input: string): number {
  const parsed = Date.parse(input);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

export class AgentMailApiError extends Error {
  constructor(
    public status: number,
    public body: string,
    public permanent: boolean,
  ) {
    super(`AgentMail API error ${status}`);
    this.name = "AgentMailApiError";
  }
}

type FetchOptions = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
};

export async function agentmailFetch(
  config: RuntimeConfig,
  path: string,
  opts: FetchOptions,
): Promise<unknown> {
  if (!config.apiKey) {
    throw new Error(
      "AGENTMAIL_API_KEY is not set; pass apiKey to AgentMail() or set the env var.",
    );
  }
  const url = new URL(config.baseUrl.replace(/\/$/, "") + path);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
  };
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(stripUndefined(opts.body));
  }

  const response = await fetch(url, {
    method: opts.method,
    headers,
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    const body =
      text.length > ERROR_BODY_LIMIT
        ? text.slice(0, ERROR_BODY_LIMIT) + "... [truncated]"
        : text;
    const permanent = PERMANENT_STATUSES.has(response.status);
    throw new AgentMailApiError(response.status, body, permanent);
  }

  if (response.status === 204) return null;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return null;
  return await response.json();
}

export function stripUndefined<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map(stripUndefined) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined) continue;
    out[k] = stripUndefined(v);
  }
  return out as T;
}
