import type { SendPayload } from "../component/shared.js";

export type SendArgs = {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string | string[];
  labels?: string[];
  headers?: Record<string, string>;
  attachments?: { filename: string; content: string; contentType?: string }[];
};

export type ReplyArgs = Omit<SendArgs, "to" | "subject"> & {
  to?: string | string[];
  subject?: string;
  replyAll?: boolean;
};

// Forward args have the same shape as a plain send today (a forward needs a
// recipient and may inherit the subject the caller provides). Aliased on
// purpose; if AgentMail later distinguishes forward semantics, split this.
export type ForwardArgs = SendArgs;

/**
 * Convert the user-facing camelCase send args into the AgentMail snake_case
 * payload sent over the wire. Pure function — also re-exported from the
 * client entry point and verified directly by unit tests.
 */
export function toSendPayload(
  args: SendArgs | ReplyArgs | ForwardArgs,
): SendPayload {
  return {
    to: args.to,
    cc: args.cc,
    bcc: args.bcc,
    reply_to: args.replyTo,
    subject: args.subject,
    text: args.text,
    html: args.html,
    labels: args.labels,
    headers: args.headers,
    attachments: args.attachments?.map((a) => ({
      filename: a.filename,
      content: a.content,
      content_type: a.contentType,
    })),
    reply_all: (args as ReplyArgs).replyAll,
  };
}
