import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**"],
    typecheck: { enabled: false },
  },
});
