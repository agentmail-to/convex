# @agentmail/convex

A [Convex](https://convex.dev) component for [AgentMail](https://agentmail.to).

AgentMail is a **stateful email inbox for AI agents** — every message your agent sends or receives is persisted as part of a thread, with labels, full bodies, and history. This component brings that inbox state into your Convex database so your agents and your UI both see it live.

It's the difference between "I built on Resend and rebuilt my own thread/label/draft store on top" and "the inbox already exists; I just `useQuery` it."

## What you get

- **Threads as first-class state.** Every inbound message persists with its `thread_id`, `in_reply_to`, and `references` in your Convex DB. Subscribe to `listInboundMessages({ threadId })` and watch the thread update reactively.
- **Full message bodies.** Text, HTML, extracted text/HTML, attachments metadata — not just headers or previews.
- **Labels.** Tag conversations on send (`labels: ["urgent", "support-agent"]`) and query threads by label via `listThreads({ labels })`.
- **Durable sending.** `sendMessage`/`replyToMessage`/`forwardMessage` enqueue from a mutation; a workpool action talks to AgentMail with bounded retries. Lifecycle (`pending → sent → delivered/bounced/...`) is itself a reactive query.
- **Idempotent webhook ingest.** Svix-verified, deduped by `event_id`, callbacks dispatched via a separate workpool so a slow user handler can't block inbound mail.
- **Reactive UI.** `useQuery` over inbox state — new mail, status changes, thread updates — without polling.
- **Isolated component.** Its own tables (`inboxes`, `inboundMessages`, `outboundMessages`, `events`), sandboxed from your app's data.

## Install

```bash
npm install @agentmail/convex
```

Wire it into your Convex app:

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import agentmail from "@agentmail/convex/convex.config";

const app = defineApp();
app.use(agentmail);
export default app;
```

Set credentials on your Convex deployment (kept out of mutation args so they don't appear in function logs):

```bash
npx convex env set AGENTMAIL_API_KEY your_api_key
npx convex env set AGENTMAIL_WEBHOOK_SECRET whsec_...
# Optional: EU residency
npx convex env set AGENTMAIL_BASE_URL https://api.agentmail.eu/v0
```

## Query threads and messages

The most reactive part of the API. Subscribe from React; new mail appears the instant AgentMail's webhook fires.

```ts
// convex/email.ts
import { query } from "./_generated/server";
import { components } from "./_generated/api";
import { v } from "convex/values";

export const listThread = query({
  args: { threadId: v.string() },
  handler: (ctx, { threadId }) =>
    ctx.runQuery(components.agentmail.lib.listInboundMessages, { threadId }),
});

export const listInbox = query({
  args: { inboxId: v.string() },
  handler: (ctx, { inboxId }) =>
    ctx.runQuery(components.agentmail.lib.listInboundMessages, { inboxId }),
});
```

```tsx
// React
const messages = useQuery(api.email.listThread, { threadId });
```

For thread metadata (last message, participants, label set) from AgentMail's remote API:

```ts
import { AgentMail } from "@agentmail/convex";
const agentmail = new AgentMail(components.agentmail);

await agentmail.listThreads(ctx, inboxId, { labels: ["urgent"] });
await agentmail.getThread(ctx, inboxId, threadId);
await agentmail.getMessage(ctx, inboxId, messageId);
```

## Send mail (with labels)

```ts
import { mutation } from "./_generated/server";
import { components } from "./_generated/api";
import { AgentMail } from "@agentmail/convex";
import { v } from "convex/values";

const agentmail = new AgentMail(components.agentmail);

export const sendHello = mutation({
  args: { inboxId: v.string(), to: v.string() },
  handler: async (ctx, args) => {
    return await agentmail.sendMessage(ctx, args.inboxId, {
      to: args.to,
      subject: "Hello from my Convex agent",
      text: "Hi! This was sent from a Convex mutation.",
      labels: ["support-agent", "auto-reply"],
    });
  },
});
```

The return value is an `OutboundId`. Subscribe to it for live delivery status:

```ts
const status = useQuery(api.email.sendStatus, { outboundId });
// → { status: "sent" | "delivered" | "bounced" | ..., agentmailMessageId, threadId, errorMessage }
```

## Receive mail

Mount the webhook handler in `convex/http.ts`:

```ts
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { components } from "./_generated/api";
import { AgentMail } from "@agentmail/convex";

const agentmail = new AgentMail(components.agentmail);
const http = httpRouter();

http.route({
  path: "/agentmail/webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => agentmail.handleWebhook(ctx, req)),
});

export default http;
```

Register the webhook URL with AgentMail (`https://your-deployment.convex.site/agentmail/webhook`) and copy the secret into `AGENTMAIL_WEBHOOK_SECRET`.

## React to inbound mail (your agent runs here)

```ts
import { internalMutation } from "./_generated/server";
import { components, internal } from "./_generated/api";
import { AgentMail } from "@agentmail/convex";
import { v } from "convex/values";

const agentmail = new AgentMail(components.agentmail, {
  onMessageReceived: internal.email.onMessageReceived,
});

export const onMessageReceived = internalMutation({
  args: { message: v.any(), thread: v.any(), eventId: v.string() },
  handler: async (ctx, args) => {
    // Your LLM agent runs here.
    await ctx.scheduler.runAfter(0, internal.email.autoReply, {
      inboxId: args.message.inbox_id,
      messageId: args.message.message_id,
      threadId: args.message.thread_id,
      text: args.message.text ?? "",
    });
  },
});
```

The `thread` argument carries everything AgentMail knows about the thread at the moment the message landed — labels, participants, message count — so your agent can decide what to do without a follow-up round-trip.

## Configuration

`new AgentMail(component, options?)` accepts an options object. Credentials are read from the Convex deployment's env vars and **not** accepted here, so they never appear in function logs.

| Option              | Env var (component-side)   | Default                          |
| ------------------- | -------------------------- | -------------------------------- |
| —                   | `AGENTMAIL_API_KEY`        | _required_                       |
| —                   | `AGENTMAIL_BASE_URL`       | `https://api.agentmail.to/v0`    |
| `webhookSecret`     | `AGENTMAIL_WEBHOOK_SECRET` | _required for webhook handler_   |
| `retryAttempts`     | —                          | `5`                              |
| `initialBackoffMs`  | —                          | `30000`                          |
| `onMessageReceived` | —                          | none                             |
| `onEvent`           | —                          | none (fires on every event type) |

For EU residency, set `AGENTMAIL_BASE_URL=https://api.agentmail.eu/v0`.

## License

Apache-2.0
