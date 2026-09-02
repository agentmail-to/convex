import { cronJobs } from "convex/server";
import { api } from "./_generated/api.js";

// Finalized outbound rows are only useful for status polling for a while;
// without a sweeper they accumulate forever. The mutation stays public so an
// app can sweep sooner with its own `olderThan`.
const crons = cronJobs();

crons.interval(
  "cleanup finalized outbound",
  { hours: 1 },
  api.lib.cleanupFinalizedOutbound,
  {},
);

export default crons;
