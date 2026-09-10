/// <reference types="vite/client" />
import type { TestConvex } from "convex-test";
import schema from "./component/schema.js";

const modules = import.meta.glob("./component/**/!(*.*.*)*.ts");

const component: {
  register(t: TestConvex<typeof schema>, name?: string): void;
  schema: typeof schema;
  modules: typeof modules;
} = {
  register(t: TestConvex<typeof schema>, name = "agentmail") {
    t.registerComponent(name, schema, modules);
  },
  schema,
  modules,
};

export default component;
