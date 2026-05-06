import type { TestConvex } from "convex-test";
import schema from "./component/schema.js";

const modules = import.meta.glob("./component/**/!(*.*.*)*.ts");

export default {
  register(t: TestConvex<typeof schema>, name = "agentmail") {
    t.registerComponent(name, schema, modules);
  },
  schema,
  modules,
};
