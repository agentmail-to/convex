# @agentmail/convex

A [Convex](https://convex.dev) component for [AgentMail](https://agentmail.to). Give your Convex app a fully-managed email agent: send mail, receive mail via webhooks, and stream new messages into your UI reactively, with no glue code.

## What you get

- **Durable sending** — `sendMessage`, `replyToMessage`, `forwardMessage` enqueue from a mutation and a scheduled action talks to AgentMail. Status lifecycle (`pending → sending → sent → delivered/bounced/...`) is reactive.
- **Inbound mail in your DB** — every `message.received` webhook is verified (Svix), persisted to `inboundMessages`, and your `onMessageReceived` mutation fires.
- **Reactive queries** — subscribe to `listInboundMessages` from your frontend and watch new mail land without polling.
- **Idempotent webhook handling** — events are deduped by `event_id`.
- **Isolated component** — its own tables, sandboxed from your app's data.

## Install

```bash
npm install @agentmail/convex
```

Then wire it into your Convex app:

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import agentmail from "@agentmail/convex/convex.config";

const app = defineApp();
app.use(agentmail);
export default app;
```

Set environment variables on your Convex deployment:

```bash
npx convex env set AGENTMAIL_API_KEY your_api_key
npx convex env set AGENTMAIL_WEBHOOK_SECRET whsec_...
```

## Send mail

```ts
// convex/email.ts
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
    });
  },
});
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

## React to inbound mail

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
      text: args.message.text ?? "",
    });
  },
});
```

## Reactive UI

```ts
// React component
const messages = useQuery(api.email.listMessages, { inboxId });
```

Backed by:

```ts
export const listMessages = query({
  args: { inboxId: v.string() },
  handler: (ctx, { inboxId }) =>
    ctx.runQuery(components.agentmail.lib.listInboundMessages, { inboxId }),
});
```

New mail appears the moment AgentMail's webhook lands. No polling.

## Configuration

`AgentMail` accepts an options object that overrides env-var defaults:

| Option              | Env var                    | Default                          |
| ------------------- | -------------------------- | -------------------------------- |
| `apiKey`            | `AGENTMAIL_API_KEY`        | —                                |
| `baseUrl`           | `AGENTMAIL_BASE_URL`       | `https://api.agentmail.to/v0`    |
| `webhookSecret`     | `AGENTMAIL_WEBHOOK_SECRET` | —                                |
| `retryAttempts`     | —                          | `5`                              |
| `initialBackoffMs`  | —                          | `30000`                          |
| `onMessageReceived` | —                          | none                             |
| `onEvent`           | —                          | none (fires on every event type) |

For EU residency, set `baseUrl` to `https://api.agentmail.eu/v0`.

## License

Apache-2.0
