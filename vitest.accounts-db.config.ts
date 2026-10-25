import { defineConfig } from "vitest/config";
import database from "./vitest.db.config";

const suite = process.env.QUIZFORGE_ACCOUNTS_DB_SUITE;
if (
  suite !== "accounts" &&
  suite !== "retention" &&
  suite !== "authority" &&
  suite !== "projection" &&
  suite !== "directory"
)
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
        : suite === "retention"
          ? "tests/accounts-db/studio-accounts-retention.test.ts"
          : suite === "authority"
            ? "tests/accounts-db/studio-accounts-authority.test.ts"
            : suite === "projection"
              ? "tests/accounts-db/studio-accounts-projection.test.ts"
              : "tests/accounts-db/studio-account-directory.test.ts",
    ],
    exclude: [],
  },
});
