import { seedVersionFixtureAccount } from "./version-account-fixture";
import { constants } from "node:fs";
import { open, unlink } from "node:fs/promises";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { openTestDatabase, resetTestDatabase } from "./p2a-fixture";

import { readPrivateJson } from "@/lib/db/runtime";

// Run only as a separate react-server helper process, never import into Playwright.
async function run() {
  const mode = process.argv[2];
  const runId = process.argv[3];
  if (mode !== "prepare" && mode !== "cleanup") throw new Error();
  if (!runId || !/^[a-f0-9-]{36}$/.test(runId)) throw new Error();
  const fixture = await openTestDatabase();
  let created = false;
  const file = path.join(
    process.cwd(),
    ".cache",
    "p2a",
    fixture.config.instanceId,
    "auth-e2e-fixture.json",
  );
  try {
    if (fixture.config.purpose !== "test" && fixture.config.purpose !== "ci")
      throw new Error();
    if (mode === "cleanup") {
      const stored = await readPrivateJson(file);
      if (
        !stored ||
        typeof stored !== "object" ||
        !("runId" in stored) ||
        stored.runId !== runId
      )
        throw new Error();
      await resetTestDatabase(fixture);
      await unlink(file).catch((error) => {
        if (!(
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ENOENT"
        ))
          throw new Error();
      });
      return;
    }
    const operator = randomBytes(32).toString("base64url");
    const readOnly = randomBytes(32).toString("base64url");
    const handle = await open(
      file,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    created = true;
    try {
      await handle.writeFile(
        JSON.stringify({
          version: 1,
          runId,
          operator: operator,
          readOnly: readOnly,
        }),
      );
    } finally {
      await handle.close();
    }
    await resetTestDatabase(fixture);
    await seedVersionFixtureAccount(
      fixture,
      { identifier: randomUUID(), secret: operator },
      "Synthetic e2e operator",
      "operator",
      "e2e-operator",
    );
    await seedVersionFixtureAccount(
      fixture,
      { identifier: randomUUID(), secret: readOnly },
      "Synthetic e2e reader",
      "read-only",
      "e2e-read-only",
    );
  } catch {
    if (created) await unlink(file).catch(() => undefined);
    throw new Error();
  } finally {
    await fixture.close();
  }
}

run()
  .then(() => {
    process.stdout.write("AUTH_E2E_FIXTURE_READY\n");
  })
  .catch(() => {
    process.stderr.write("AUTH_E2E_FIXTURE_FAILED\n");
    process.exitCode = 1;
  });
