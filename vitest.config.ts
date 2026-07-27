import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // Vite does not resolve dot-leading bare specifiers (".prisma/...") the
      // way Node/webpack do; map the generated PG client to its real location.
      ".prisma/client-postgresql": path.resolve(
        import.meta.dirname,
        "node_modules/.prisma/client-postgresql",
      ),
    },
  },
});
