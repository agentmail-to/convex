#!/usr/bin/env -S npx tsx
// Smoke test: verifies the AgentMail HTTP layer end-to-end against the live API.
//
// Required env:
//   AGENTMAIL_API_KEY - real API key
//
// Optional env:
//   AGENTMAIL_BASE_URL  - default https://api.agentmail.to/v0
//   AGENTMAIL_TEST_TO   - recipient email; required for --send
//
// Usage:
//   npx tsx scripts/smoke.ts                    # readonly: list inboxes, basic auth check
//   AGENTMAIL_TEST_TO=you@x.com \
//     npx tsx scripts/smoke.ts --send           # creates an inbox, sends one email, deletes inbox
//
// The smoke does NOT depend on Convex — it exercises the same HTTP surface
// the component uses, so success here means the component's API calls will work.

import { agentmailFetch, AgentMailApiError } from "../src/component/utils.js";

const apiKey = process.env.AGENTMAIL_API_KEY;
const sendTo = process.env.AGENTMAIL_TEST_TO;
const wantSend = process.argv.includes("--send");

if (!apiKey) {
  console.error("AGENTMAIL_API_KEY is required");
  process.exit(2);
}

function step(name: string) {
  return (msg = "ok") => console.log(`✓ ${name}: ${msg}`);
}
function fail(name: string, err: unknown): never {
  console.error(`✗ ${name}: ${err instanceof Error ? err.message : err}`);
  if (err instanceof AgentMailApiError) {
    console.error(`  status=${err.status} permanent=${err.permanent}`);
    console.error(`  body=${err.body}`);
  }
  process.exit(1);
}

async function main() {
  // 1. list inboxes — verifies auth + base url + JSON parse
  let listOk = step("list inboxes");
  let inboxesResp: { count: number; inboxes: { inbox_id: string; email: string }[] };
  try {
    inboxesResp = (await agentmailFetch("/inboxes", {
      method: "GET",
      query: { limit: 5 },
    })) as typeof inboxesResp;
    listOk(`${inboxesResp.count} total inboxes`);
  } catch (err) {
    fail("list inboxes", err);
  }

  if (!wantSend) {
    console.log("\nSkipping send test. Pass --send AGENTMAIL_TEST_TO=you@x.com to send a real message.");
    return;
  }

  if (!sendTo) {
    console.error("AGENTMAIL_TEST_TO is required for --send");
    process.exit(2);
  }

  // 2. create a temporary inbox
  const createOk = step("create inbox");
  const inbox = (await agentmailFetch("/inboxes", {
    method: "POST",
    body: { display_name: "Convex Component Smoke" },
  })) as { inbox_id: string; email: string };
  createOk(inbox.email);

  try {
    // 3. send a message
    const sendOk = step("send message");
    const send = (await agentmailFetch(
      config,
      `/inboxes/${inbox.inbox_id}/messages/send`,
      {
        method: "POST",
        body: {
          to: sendTo,
          subject: "AgentMail Convex component smoke test",
          text: `Sent at ${new Date().toISOString()} from the smoke script.`,
        },
      },
    )) as { message_id: string; thread_id: string };
    sendOk(`message_id=${send.message_id} thread_id=${send.thread_id}`);

    // 4. fetch the message to confirm it was stored
    const getOk = step("get message");
    const fetched = (await agentmailFetch(
      config,
      `/inboxes/${inbox.inbox_id}/messages/${send.message_id}`,
      { method: "GET" },
    )) as { message_id: string; from: string; subject?: string };
    getOk(`from=${fetched.from} subject=${fetched.subject}`);
  } finally {
    // 5. cleanup
    const delOk = step("delete inbox");
    await agentmailFetch(`/inboxes/${inbox.inbox_id}`, {
      method: "DELETE",
    });
    delOk();
  }

  console.log("\nSmoke test passed.");
}

main().catch((err) => {
  fail("smoke", err);
});
