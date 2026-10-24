import { defineConfig } from "vitest/config";
import database from "./vitest.db.config";

// Explicit fresh A2a instance only; never included in the ordinary reset suite.
export default defineConfig({
  ...database,
  test: {
    ...database.test,
    include: ["tests/operations-db/operations.test.ts"],
    exclude: [],
    hookTimeout: 60_000,
  },
});
