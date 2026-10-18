import { defineConfig } from "vitest/config";
import database from "./vitest.db.config";

/** Fresh test/CI instance only: intentionally exhausted exchange budget is preserved. */
export default defineConfig({
  ...database,
  test: {
    ...database.test,
    include: ["tests/db/p4-consumer-faults.test.ts"],
    exclude: [],
  },
});
