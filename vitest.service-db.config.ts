import { defineConfig } from "vitest/config";
import database from "./vitest.db.config";

const suite = process.env.QUIZFORGE_DB_SERVICE_SUITE;
if (suite !== "validation" && suite !== "media-unknown")
  throw new Error("FRESH_SERVICE_DATABASE_SUITE_REQUIRED");

// Each explicit suite requires a separate fresh test/ci instance. Its UNKNOWN
// rows are retained; ordinary reset/cleanup must never be run against that instance.
export default defineConfig({
  ...database,
  test: {
    ...database.test,
    include: [
      suite === "validation"
        ? "tests/db/p2b2b-service.test.ts"
        : "tests/db/p2b2b-service-media-unknown.test.ts",
    ],
    exclude: [],
  },
});
