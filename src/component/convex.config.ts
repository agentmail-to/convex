import { defineComponent } from "convex/server";
import { v } from "convex/values";
import workpool from "@convex-dev/workpool/convex.config";

const component = defineComponent("agentmail", {
  env: {
    AGENTMAIL_API_KEY: v.string(),
    AGENTMAIL_BASE_URL: v.optional(v.string()),
  },
});
component.use(workpool, { name: "sendPool" });
component.use(workpool, { name: "callbackPool" });

export default component;
