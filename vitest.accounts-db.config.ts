import { defineConfig } from "vitest/config";
import database from "./vitest.db.config";

const suite = process.env.QUIZFORGE_ACCOUNTS_DB_SUITE;
if (suite !== "accounts" && suite !== "retention")
  throw new Error("EXPLICIT_ACCOUNTS_DATABASE_SUITE_REQUIRED");

// Account suites retain UNKNOWN attempts and receipts. Run with an explicitly
// owned test database; never include them in the shared reset suite.
export default defineConfig({
  ...database,
  test: {
    ...database.test,
    include: [
      suite === "accounts"
        ? "tests/accounts-db/studio-accounts.test.ts"
        : "tests/accounts-db/studio-accounts-retention.test.ts",
    ],
    exclude: [],
  },
});
