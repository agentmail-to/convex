import { Webhook } from "svix";
import type { AgentMailEvent } from "../component/shared.js";

export type WebhookHeaders = {
  "svix-id": string;
  "svix-timestamp": string;
  "svix-signature": string;
};

export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookVerificationError";
  }
}

/**
 * Verify a Svix-signed AgentMail webhook payload.
 * Throws {@link WebhookVerificationError} on bad signature or missing headers.
 */
export function verifyAgentMailWebhook(
  secret: string,
  rawBody: string,
  headers: WebhookHeaders | Record<string, string | null | undefined>,
): AgentMailEvent {
  if (!secret) {
    throw new WebhookVerificationError(
      "Webhook secret is empty; cannot verify",
    );
  }
  const normalized: WebhookHeaders = {
    "svix-id": readHeader(headers, "svix-id"),
    "svix-timestamp": readHeader(headers, "svix-timestamp"),
    "svix-signature": readHeader(headers, "svix-signature"),
  };
  if (
    !normalized["svix-id"] ||
    !normalized["svix-timestamp"] ||
    !normalized["svix-signature"]
  ) {
    throw new WebhookVerificationError("Missing required svix headers");
  }
  const wh = new Webhook(secret);
  try {
    return wh.verify(rawBody, normalized) as AgentMailEvent;
  } catch (err) {
    throw new WebhookVerificationError(
      err instanceof Error ? err.message : String(err),
    );
  }
}

function readHeader(
  headers: Record<string, string | null | undefined> | WebhookHeaders,
  name: string,
): string {
  const direct = (headers as Record<string, string | undefined | null>)[name];
  if (typeof direct === "string") return direct;
  return "";
}
