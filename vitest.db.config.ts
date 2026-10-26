import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./tests/support/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/db/**/*.test.ts"],
    // These suites deliberately retain unresolved attempts and require fresh
    // instances. Run each through vitest.service-db.config.ts, never this reset suite.
    exclude: [
      "tests/db/p2b2b-service*.test.ts",
      "tests/db/p4-namespace.test.ts",
      "tests/db/p4-consumer-faults.test.ts",
      // Archived pre-account application-at-partial-schema upgrade scenarios.
      // The current demo supports the complete schema; do not add legacy auth
      // adapters to execute today's app against schema 10/16/17. Bodies remain
      // unchanged at these paths; historical evidence is scoped in STUDIO_ACCOUNTS_V1.
      "tests/db/p2b2b-domain-upgrade.test.ts",
      "tests/db/p3e-upgrade.test.ts",
      "tests/db/p4-upgrade.test.ts",
    ],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
