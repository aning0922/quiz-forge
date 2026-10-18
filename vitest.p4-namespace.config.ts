import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Fresh marker-verified test/CI instance only; never reuse the ordinary suite's audit rows. */
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
    include: ["tests/db/p4-namespace.test.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
