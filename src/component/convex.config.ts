import { defineComponent } from "convex/server";
import workpool from "@convex-dev/workpool/convex.config";

const component = defineComponent("agentmail");
component.use(workpool, { name: "sendPool" });
component.use(workpool, { name: "callbackPool" });

export default component;
